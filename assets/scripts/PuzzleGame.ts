import {
    _decorator, Component, Node, Label, Sprite, SpriteFrame, Graphics, Color,
    resources, sys, Vec3, UITransform, Layers, view, ResolutionPolicy, Rect, Size, tween, Tween, Mask,
    ScrollView, UIOpacity, Font, assetManager, Asset,
} from 'cc';
import { GameData } from './GameData';

const { ccclass, property } = _decorator;

// ---------- 棋盘常量（对应 Unity 版 4 行 3 列） ----------
const ROWS = 4;
const COLS = 3;
const COUNT = ROWS * COLS;          // 12 块
const EMPTY = COUNT - 1;            // 最后一块为空白块
const TILE = 300;                   // 单块尺寸（设计分辨率 1080x1920）
const GAP = 10;
const GRID_W = COLS * TILE + (COLS - 1) * GAP;
const GRID_H = ROWS * TILE + (ROWS - 1) * GAP;
const LEVELS = 3;                   // 兜底关卡数（实际以 resources 里 sourceN 是否存在为准）
// 微信小游戏主包限 4MB，关卡图拆两个 bundle：source1~4 在 resources，source5+ 在 levels2
// （levels2 在微信构建时由后处理脚本配置为分包）
const LEVELS2_START = 5;
const MOVE_DURATION = 0.07;         // 滑动动画时长（秒）
const FAST_TIME = 30;               // 30 秒内完成用 finish2 结算图（对应 Unity 版 elapsedTime < 30f）

// 主题配色
const THEME_BG = new Color(243, 245, 250, 255);        // 开始页/选关页浅色底
const THEME_CARD = new Color(255, 255, 255, 255);      // 卡片白
const THEME_TEXT = new Color(50, 55, 70, 255);         // 深色文字
const THEME_SUB = new Color(130, 138, 155, 255);       // 次要文字
const THEME_BLUE = new Color(64, 128, 235, 255);
const THEME_GREEN = new Color(38, 166, 118, 255);
const THEME_PINK = new Color(255, 110, 150, 255);       // 标题粉色（深色文字在深色衣服上看不清）

// 占位配色（没有美术资源时按块编号着色）
const PALETTE = [
    new Color(231, 76, 60), new Color(46, 204, 113), new Color(52, 152, 219),
    new Color(241, 196, 15), new Color(155, 89, 182), new Color(26, 188, 156),
    new Color(230, 126, 34), new Color(149, 165, 166), new Color(192, 57, 43),
    new Color(41, 128, 185), new Color(39, 174, 96), new Color(142, 68, 173),
];

/**
 * 滑块拼图主逻辑（移植自 Unity 版 PuzzleGame.cs）
 * 把本脚本挂到场景中的 Canvas 节点上即可，所有 UI 均由代码动态生成。
 *
 * 页面结构：开始页（进入选关 / 随机一关）-> 选关页（卡片数量按资源自动检测）-> 游戏
 * 美术资源放在 assets/resources/source{关卡号}/ 下，两种方式二选一：
 *   方式 A（推荐）：一张整图 full.png，运行时自动切成 12 块（居中裁剪为 3:4）
 *   方式 B：1.png ~ 12.png 单独的拼图块图片（按左上到右下顺序）
 * 可选：finish1.png 完成结算图 / finish2.png 30 秒内完成的结算图
 * 都没有时用「色块 + 编号」占位。
 */
@ccclass('PuzzleGame')
export class PuzzleGame extends Component {

    @property({ tooltip: '默认关卡（仅在资源里一个关卡都检测不到时使用）' })
    currentLevel = 1;

    // ---------- 棋盘状态：slotPieces[槽位] = 拼图块编号（EMPTY 表示空白） ----------
    private slotPieces: number[] = [];
    private pieceFrames: (SpriteFrame | null)[] = new Array(COUNT).fill(null);
    private pieceNodes: (Node | null)[] = new Array(COUNT).fill(null);
    private pieceImgs: (Sprite | null)[] = new Array(COUNT).fill(null);
    private slicedFrames: SpriteFrame[] = [];   // 运行时切块生成的帧（重开时销毁；资源帧不销毁）
    private moving = false;                     // 滑动动画期间锁输入
    private loadToken = 0;                      // 防止切关卡时旧加载回调写脏数据

    // ---------- 关卡 ----------
    private levelCount = 0;                     // 检测到的关卡数
    private thumbFrames: (SpriteFrame | null)[] = []; // 每关的整图缩略图（选关卡片用）

    // ---------- UI 引用 ----------
    private bgSprite: Sprite | null = null;
    private timerLabel: Label | null = null;
    private bestLabel: Label | null = null;
    private resultLabel: Label | null = null;
    private gameLayer: Node | null = null;
    private startPage: Node | null = null;
    private levelPage: Node | null = null;
    private completeOverlay: Sprite | null = null; // 完成后盖在拼图上的整图（保持宽高比铺满）
    private fullFrame: SpriteFrame | null = null;
    private levelCardLabels: Label[] = [];
    private page: 'start' | 'level' | 'game' = 'start'; // 当前所在页面（异步建页时防止盖错）

    // ---------- 首页/选关页轮播背景 ----------
    private bgLayer: Node | null = null;
    private bgShowA: Sprite | null = null;      // 底图
    private bgShowB: Sprite | null = null;      // 交叉淡入用的顶层图
    private bgShowLv = 0;                       // 当前显示的关卡图（避免连续重复）
    private startBg: Sprite | null = null;      // 开始页固定背景（source1 整图）
    private startLoadingLabel: Label | null = null; // 开始页「Loading...」（资源检测完隐藏）
    private levels2Bundle: any = null;              // source5+ 所在 bundle（微信小游戏分包）

    // ---------- 计时器 ----------
    private elapsed = 0;
    private timerRunning = false;

    onLoad() {
        // 竖屏设计分辨率（也可在 项目设置 -> 项目数据 中配置）
        view.setDesignResolutionSize(1080, 1920, ResolutionPolicy.FIXED_HEIGHT);
    }

    start() {
        this.buildUI();
        this.showStartPage();
        this.detectLevels();
    }

    update(dt: number) {
        if (this.timerRunning) {
            this.elapsed += dt;
            this.updateTimerText();
        }
    }

    // =====================================================================
    // 关卡检测：按 source1、source2... 是否存在资源来数关卡
    // =====================================================================

    /** 关卡资源统一入口：source1~4 在 resources，source5+ 在 levels2（微信分包） */
    private loadLevelAsset<T extends Asset>(lv: number, path: string, type: new (...args: any[]) => T,
                                            cb: (err: Error | null, asset: T | null) => void) {
        if (lv < LEVELS2_START) {
            resources.load(path, type, cb);
            return;
        }
        if (this.levels2Bundle) {
            this.levels2Bundle.load(path, type, cb);
            return;
        }
        assetManager.loadBundle('levels2', (err, bundle) => {
            if (err || !bundle) { cb(err ?? new Error('levels2 bundle missing'), null); return; }
            this.levels2Bundle = bundle;
            bundle.load(path, type, cb);
        });
    }

    private detectLevels() {
        // 并行探测 source1..MAX_PROBE（串行逐关下载在网络慢时要等几十秒，
        // 其间开始页没背景、点 Start 也没反应）。全部回调或超时后按「连续存在」的关数结算
        const MAX_PROBE = 24;
        let pending = MAX_PROBE;
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            let n = 0;
            while (this.thumbFrames[n + 1]) n++;
            this.levelCount = n > 0 ? n : LEVELS; // 一个资源都没有：用兜底关卡数 + 占位色块
            this.onDetectDone();
        };
        for (let lv = 1; lv <= MAX_PROBE; lv++) {
            this.loadLevelAsset(lv, `source${lv}/full/spriteFrame`, SpriteFrame, (err, sf) => {
                pending--;
                if (!err && sf) {
                    this.thumbFrames[lv] = sf;
                    // source1 一到就先铺开始页背景，不等其余图片
                    if (lv === 1 && this.startBg) this.setCoverSprite(this.startBg, sf);
                }
                if (pending <= 0) finish();
            });
        }
        // 网络慢/个别请求挂住时的兜底：超时后按已加载到的结算
        this.scheduleOnce(finish, 10);
    }

    private onDetectDone() {
        console.log('[PuzzleGame] 检测到关卡数:', this.levelCount);
        this.buildLevelPage();
        this.startBgSlideshow();
        // 开始页背景固定用 source1（并行加载下通常已提前铺好，这里兜底同步一次）
        if (this.startBg) this.setCoverSprite(this.startBg, this.thumbFrames[1]);
        if (this.startLoadingLabel) this.startLoadingLabel.node.active = false;
    }

    // =====================================================================
    // UI 构建
    // =====================================================================

    private buildUI() {
        this.buildBgLayer(this.node);   // 最底层：轮播背景（开始页/选关页透出）
        this.buildGameLayer(this.node); // 游戏层有实心底色，会盖住轮播背景
        this.buildStartPage(this.node);
        // 选关页等关卡数检测完再动态生成
    }

    // ---------- 轮播背景层 ----------

    /** 最底层全屏轮播：随机切换各关整图 + 交叉淡入淡出，上层盖白纱保证文字可读 */
    private buildBgLayer(root: Node) {
        const layer = this.createNode('bgLayer', root, 1080, 1920, new Vec3(0, 0, 0));
        this.bgLayer = layer;

        const imgNode = this.createNode('bgImage', layer, 1080, 1920, new Vec3(0, 0, 0));
        imgNode.addComponent(Mask);
        this.bgShowA = this.createCoverSprite(imgNode);
        this.bgShowB = this.createCoverSprite(imgNode);
        this.bgShowB.node.addComponent(UIOpacity).opacity = 0;

        // 白纱（压住背景图，让深色文字仍可读；开始页/选关页自身改为透明）
        const veil = layer.addComponent(Graphics);
        veil.fillColor = new Color(243, 245, 250, 185);
        veil.roundRect(-540, -960, 1080, 1920, 0);
        veil.fill();
    }

    /** 关卡检测完成后：显示第一张并启动轮播 */
    private startBgSlideshow() {
        if (!this.bgShowA || !this.bgShowB || this.levelCount <= 0) return;
        this.bgShowLv = 1 + Math.floor(Math.random() * this.levelCount);
        const sf = this.thumbFrames[this.bgShowLv];
        this.setCoverSprite(this.bgShowA, sf);
        this.setCoverSprite(this.bgShowB, sf);
        this.schedule(this.swapBgImage, 4);
    }

    /** 每隔几秒随机换一张（与当前不同）：顶层图 B 淡入盖住 A，完成后把新图同步给 A、B 归零 */
    private swapBgImage() {
        if (this.page === 'game') return; // 游戏中不轮播
        if (!this.bgShowA || !this.bgShowB || this.levelCount <= 1) return;
        let lv = this.bgShowLv;
        while (lv === this.bgShowLv) {
            lv = 1 + Math.floor(Math.random() * this.levelCount);
        }
        this.bgShowLv = lv;
        const sf = this.thumbFrames[lv];
        const a = this.bgShowA, b = this.bgShowB;
        const opB = b.node.getComponent(UIOpacity)!;
        this.setCoverSprite(b, sf);
        tween(opB)
            .to(0.8, { opacity: 255 })
            .call(() => {
                this.setCoverSprite(a, sf); // A、B 同图后 B 归零，视觉无跳变
                opB.opacity = 0;
            })
            .start();
    }

    // ---------- 游戏层 ----------

    private buildGameLayer(root: Node) {
        const layer = this.createNode('gameLayer', root, 1080, 1920, new Vec3(0, 0, 0));
        this.gameLayer = layer;

        // 背景（关卡原图，20% 不透明度，保持宽高比铺满；没图时深色底）
        const bg = this.createNode('background', layer, 1080, 1920, new Vec3(0, 0, 0));
        const bgG = bg.addComponent(Graphics);
        bgG.fillColor = new Color(35, 40, 55, 255);
        bgG.roundRect(-540, -960, 1080, 1920, 0);
        bgG.fill();
        const bgSpriteNode = this.createNode('bgImage', bg, 1080, 1920, new Vec3(0, 0, 0));
        bgSpriteNode.addComponent(Mask);
        this.bgSprite = this.createCoverSprite(bgSpriteNode);
        this.bgSprite.color = new Color(255, 255, 255, 51); // 对应 Unity 版 a = 0.2

        // 拼图棋盘：每个拼图块一个节点（块身份固定，位置随滑动变化）
        const grid = this.createNode('grid', layer, GRID_W, GRID_H, new Vec3(0, 0, 0));
        for (let piece = 0; piece < COUNT; piece++) {
            const tile = this.createNode(`piece_${piece}`, grid, TILE, TILE, new Vec3(0, 0, 0));
            const g = tile.addComponent(Graphics);
            g.roundRect(-TILE / 2, -TILE / 2, TILE, TILE, 16);
            g.fill();
            // 图片层（有美术资源时显示）；sizeMode 必须 CUSTOM，
            // 否则 Sprite 按帧的原始像素尺寸渲染（小图缩在中间、大图溢出棋盘）
            const img = this.createNode('img', tile, TILE - 2, TILE - 2, new Vec3(0, 0, 0));
            const imgSp = img.addComponent(Sprite);
            imgSp.sizeMode = Sprite.SizeMode.CUSTOM;
            this.pieceImgs[piece] = imgSp;
            // 编号层（占位时显示）
            this.createLabel(tile, `${piece + 1}`, 110, Color.WHITE, new Vec3(0, 0, 0));
            tile.on(Node.EventType.TOUCH_END, () => this.onPieceClick(piece), this);
            this.pieceNodes[piece] = tile;
        }

        // 完成结算图：直接盖在拼图上（不弹单独的框），保持宽高比铺满棋盘
        const overlay = this.createNode('completeOverlay', layer, GRID_W, GRID_H, new Vec3(0, 0, 0));
        overlay.active = false;
        overlay.addComponent(Mask);
        this.completeOverlay = this.createCoverSprite(overlay);

        // 计时器 + 最佳纪录
        this.timerLabel = this.createLabel(layer, '00:00', 84, Color.WHITE, new Vec3(0, GRID_H / 2 + 120, 0));
        this.bestLabel = this.createLabel(layer, 'Best --:--', 40, new Color(200, 200, 200, 255), new Vec3(0, GRID_H / 2 + 220, 0));

        // 完成提示文字（拼图下方、按钮上方）
        this.resultLabel = this.createLabel(layer, '', 44, Color.WHITE, new Vec3(0, -GRID_H / 2 - 75, 0));

        // 底部按钮
        this.createButton(layer, 'Retry', 320, 110, new Vec3(-200, -GRID_H / 2 - 170, 0),
            () => this.startGame(this.currentLevel));
        this.createButton(layer, 'Levels', 320, 110, new Vec3(200, -GRID_H / 2 - 170, 0),
            () => this.showLevelPage());
    }

    // ---------- 开始页 ----------

    private buildStartPage(root: Node) {
        const page = this.createNode('startPage', root, 1080, 1920, new Vec3(0, 0, 0));
        page.on(Node.EventType.TOUCH_END, (e: any) => e.propagationStopped = true, this);

        // 开始页背景：固定用 source1 整图 cover 铺满（不用随机轮播），上面盖淡白纱
        const bgNode = this.createNode('bg', page, 1080, 1920, new Vec3(0, 0, 0));
        bgNode.addComponent(Mask);
        this.startBg = this.createCoverSprite(bgNode);
        const veil = page.addComponent(Graphics);
        veil.fillColor = new Color(255, 255, 255, 100);
        veil.roundRect(-540, -960, 1080, 1920, 0);
        veil.fill();

        // 标题放按钮上方（背景人脸在画面中上部，标题在其下方不挡脸）
        // 游戏名《萌萌拼图》（微信小游戏备案要求纯中文）；Great Vibes 无中文字形，主标题用系统粗体
        const title = this.createLabel(page, '萌萌拼图', 150, THEME_PINK, new Vec3(0, 150, 0));
        title.isBold = true;
        // 英文花体保留作装饰副标题，延续 MM 品牌
        const subtitle = this.createLabel(page, 'MM Puzzle', 64, THEME_PINK, new Vec3(0, 280, 0));
        this.applyScriptFont(subtitle, 64);

        this.createButton(page, 'Start', 560, 160, new Vec3(0, -130, 0),
            () => this.showLevelPage(), 60, THEME_BLUE);
        this.createButton(page, 'Random', 560, 160, new Vec3(0, -330, 0),
            () => {
                const lv = 1 + Math.floor(Math.random() * (this.levelCount > 0 ? this.levelCount : LEVELS));
                this.startGame(lv);
            }, 60, THEME_GREEN);

        // 资源检测期间的提示（检测完隐藏）：网络慢时点 Start 没反应至少有个解释
        this.startLoadingLabel = this.createLabel(page, 'Loading...', 40, THEME_SUB, new Vec3(0, -520, 0));

        this.startPage = page;
    }

    // ---------- 选关页（关卡数 + 缩略图按资源动态生成） ----------

    private buildLevelPage() {
        if (this.levelPage) this.levelPage.destroy();
        this.levelCardLabels = [];

        const page = this.createNode('levelPage', this.node, 1080, 1920, new Vec3(0, 0, 0));
        // 页面本身透明，透出最底层的轮播背景（白纱已在 bgLayer 上）
        page.on(Node.EventType.TOUCH_END, (e: any) => e.propagationStopped = true, this);

        this.createLabel(page, 'Select Level', 90, THEME_TEXT, new Vec3(0, 800, 0));
        this.createLabel(page, `${this.levelCount} Levels`, 40, THEME_SUB, new Vec3(0, 700, 0));

        // 卡片三列排布 + 纵向滚动容器（关卡多也不超出屏幕）；缩略图直接用 3:4 竖图显示
        const cardW = 340, gapX = 20, gapY = 30;
        const thumbW = cardW - 28;
        const thumbH = Math.floor(thumbW * 4 / 3); // 3:4 竖图
        const cardH = thumbH + 92;
        const cols = 3;
        const rows = Math.ceil(this.levelCount / cols);
        const viewH = 1440;
        const contentH = Math.max(viewH, rows * (cardH + gapY) - gapY + 24);

        // 滚动视窗：Mask 裁剪 + ScrollView 拖动（content 顶部锚点，卡片向下堆叠）
        const view = this.createNode('scroll', page, 1080, viewH, new Vec3(0, -100, 0));
        view.addComponent(Mask);
        const sv = view.addComponent(ScrollView);
        const content = this.createNode('content', view, 1080, contentH, new Vec3(0, viewH / 2, 0));
        content.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
        sv.content = content;
        sv.vertical = true;
        sv.horizontal = false;

        for (let lv = 1; lv <= this.levelCount; lv++) {
            const idx = lv - 1;
            const row = Math.floor(idx / cols), col = idx % cols;
            const x = (col - 1) * (cardW + gapX);
            const y = -(row * (cardH + gapY) + cardH / 2 + 12);

            const card = this.createNode(`level_${lv}`, content, cardW, cardH, new Vec3(x, y, 0));
            const cg = card.addComponent(Graphics);
            cg.fillColor = this.thumbFrames[lv] ? THEME_CARD : PALETTE[(lv - 1) % PALETTE.length];
            cg.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 28);
            cg.fill();
            card.on(Node.EventType.TOUCH_START, () => card.setScale(0.95, 0.95, 1), this);
            card.on(Node.EventType.TOUCH_CANCEL, () => card.setScale(1, 1, 1), this);
            card.on(Node.EventType.TOUCH_END, () => {
                card.setScale(1, 1, 1);
                this.startGame(lv);
            }, this);

            // 有整图就放缩略图预览（4:3 原比例显示，不裁剪不拉伸）
            const thumb = this.thumbFrames[lv];
            if (thumb) {
                const thumbNode = this.createNode('thumb', card, thumbW, thumbH, new Vec3(0, 36, 0));
                const sp = thumbNode.addComponent(Sprite);
                sp.sizeMode = Sprite.SizeMode.CUSTOM;
                sp.spriteFrame = thumb;
            } else {
                this.createLabel(card, `${lv}`, 90, Color.WHITE, new Vec3(0, 60, 0));
            }

            // 文字放在卡片内、缩略图下方的剩余空间里（卡片底部留 40px 边距）
            const label = this.createLabel(card, '', 32, thumb ? THEME_TEXT : Color.WHITE, new Vec3(0, -cardH / 2 + 36, 0));
            this.levelCardLabels.push(label);
        }

        this.createButton(page, 'Back', 300, 100, new Vec3(0, -890, 0),
            () => this.showStartPage(), 46);

        this.levelPage = page;
        this.refreshLevelPage();
        // 建页是异步完成的：只有用户当前正想进选关页时才显示，否则藏在开始页下面
        if (this.page === 'level') {
            if (this.startPage) this.startPage.active = false;
            if (this.gameLayer) this.gameLayer.active = false;
            page.active = true;
        } else {
            page.active = false;
        }
    }

    private showStartPage() {
        this.timerRunning = false;
        this.page = 'start';
        if (this.gameLayer) this.gameLayer.active = false;
        if (this.levelPage) this.levelPage.active = false;
        if (this.startPage) this.startPage.active = true;
        if (this.bgLayer) this.bgLayer.active = false; // 开始页用自己的 source1 背景，轮播只给选关页
    }

    private showLevelPage() {
        this.timerRunning = false;
        if (this.gameLayer) this.gameLayer.active = false;
        if (this.levelPage) {
            this.page = 'level';
            if (this.startPage) this.startPage.active = false;
            this.refreshLevelPage();
            this.levelPage.active = true;
            if (this.bgLayer) this.bgLayer.active = true;
        } else {
            // 关卡还没检测完：先停在开始页，建好后自动切到选关页
            this.page = 'level';
            if (this.startPage) this.startPage.active = true;
        }
    }

    /** 刷新选关卡片上的最佳纪录文字 */
    private refreshLevelPage() {
        for (let lv = 1; lv <= this.levelCount; lv++) {
            const label = this.levelCardLabels[lv - 1];
            if (!label) continue;
            const best = this.getBestTime(lv);
            label.string = `Level ${lv}  ${best < Number.MAX_SAFE_INTEGER ? this.formatTime(best) : '--:--'}`;
        }
    }

    // =====================================================================
    // 游戏流程
    // =====================================================================

    private startGame(level: number) {
        this.currentLevel = level;
        GameData.SelectedLevel = level;
        this.elapsed = 0;
        this.timerRunning = false;
        this.moving = false;
        this.loadToken++;
        this.updateTimerText();

        // 停掉残留的滑动动画并复位
        for (const n of this.pieceNodes) {
            if (n) Tween.stopAllByTarget(n);
        }

        if (this.gameLayer) this.gameLayer.active = true;
        if (this.bgLayer) this.bgLayer.active = false; // 进游戏关掉轮播，保持棋盘干净
        if (this.startPage) this.startPage.active = false;
        if (this.levelPage) this.levelPage.active = false;
        if (this.completeOverlay) {
            this.setCoverSprite(this.completeOverlay, null);
            this.completeOverlay.node.active = false;
        }
        if (this.resultLabel) this.resultLabel.string = '';
        this.setCoverSprite(this.bgSprite, null);

        const best = this.getBestTime(level);
        this.bestLabel!.string = `Best ${best < Number.MAX_SAFE_INTEGER ? this.formatTime(best) : '--:--'}`;

        // 先清掉 Sprite 组件上残留的旧帧引用，再销毁旧帧
        // （否则重新激活时引擎会访问已销毁帧的 uv，导致 updateUVs 崩溃）
        for (const img of this.pieceImgs) {
            if (img) img.spriteFrame = null;
        }
        // 只销毁运行时切块生成的帧；resources 加载的帧由资产管理器管理，不能 destroy
        for (const f of this.slicedFrames) {
            f.destroy();
        }
        this.slicedFrames = [];
        this.pieceFrames = new Array(COUNT).fill(null);

        this.loadImages(level);
        this.shufflePuzzle();
    }

    /** 优先加载整图 source{level}/full 运行时切块；否则回退到单独的 1~12 图片 */
    private loadImages(level: number) {
        const token = this.loadToken;
        this.loadLevelAsset(level, `source${level}/full/spriteFrame`, SpriteFrame, (err, fullSf) => {
            if (token !== this.loadToken) return;
            if (!err && fullSf && fullSf.texture) {
                this.applyFullImage(fullSf);
                return;
            }
            // 回退：单独的拼图块图片，缺哪块就用占位色块
            for (let piece = 0; piece < COUNT; piece++) {
                this.loadLevelAsset(level, `source${level}/${piece + 1}/spriteFrame`, SpriteFrame, (e2, sf) => {
                    if (token !== this.loadToken || e2 || !sf) return;
                    this.pieceFrames[piece] = sf;
                    this.updatePieceVisual(piece);
                });
            }
        });
    }

    /** 把整图运行时切成 COLS x ROWS 块：居中裁剪为 3:4，每块一个 SpriteFrame 视图 */
    private applyFullImage(fullSf: SpriteFrame) {
        this.fullFrame = fullSf;
        fullSf.packable = false; // 防止动态图集重排导致 rect 失效
        const tex = fullSf.texture;
        const tw = tex.width, th = tex.height;

        // 居中裁剪为 COLS:ROWS (3:4)
        let cropW = tw, cropH = th;
        if (tw / th > COLS / ROWS) cropW = Math.floor(th * COLS / ROWS);
        else cropH = Math.floor(tw * ROWS / COLS);
        const cellW = Math.floor(cropW / COLS), cellH = Math.floor(cropH / ROWS);
        const offX = Math.floor((tw - cellW * COLS) / 2);
        const offY = Math.floor((th - cellH * ROWS) / 2);

        for (let piece = 0; piece < COUNT; piece++) {
            const row = Math.floor(piece / COLS), col = piece % COLS; // 第 1 块在左上角
            // SpriteFrame.rect 以贴图左上角为原点（引擎源码 _calculateUV 已验证）。
            // 注意：不能用 clone()（序列化拷贝会丢纹理引用导致 uv 为 null），须手动构建
            const sf = new SpriteFrame();
            sf.packable = false;
            sf.texture = fullSf.texture; // 必须先设 texture，再设 rect，才会触发 UV 计算
            sf.rect = new Rect(offX + col * cellW, offY + row * cellH, cellW, cellH);
            sf.originalSize = new Size(cellW, cellH);
            this.pieceFrames[piece] = sf;
            this.slicedFrames.push(sf);
            this.updatePieceVisual(piece);
        }

        this.setCoverSprite(this.bgSprite, fullSf); // 拼图提示背景
    }

    /** 打乱并保证可解（移植自 Unity 版 ShufflePuzzle / IsSolvable） */
    private shufflePuzzle() {
        const indices: number[] = [];
        for (let i = 0; i < COUNT; i++) indices.push(i);

        do {
            // Fisher-Yates 洗牌
            for (let n = COUNT - 1; n > 0; n--) {
                const k = Math.floor(Math.random() * (n + 1));
                [indices[k], indices[n]] = [indices[n], indices[k]];
            }
        } while (!this.isSolvable(indices));

        this.slotPieces = indices;
        // 无动画瞬间落位
        for (let piece = 0; piece < COUNT; piece++) {
            const node = this.pieceNodes[piece]!;
            node.setPosition(this.slotToPos(this.slotPieces.indexOf(piece)));
            node.setSiblingIndex(piece);
            this.updatePieceVisual(piece);
        }
    }

    /** 3 列为奇数列：只要逆序数为偶数即可解（对应 Unity 版 IsSolvable） */
    private isSolvable(indices: number[]): boolean {
        let inversions = 0;
        for (let i = 0; i < COUNT - 1; i++) {
            for (let j = i + 1; j < COUNT; j++) {
                if (indices[i] !== EMPTY && indices[j] !== EMPTY && indices[i] > indices[j]) {
                    inversions++;
                }
            }
        }
        return inversions % 2 === 0;
    }

    /**
     * 点击拼图块：与空白同行/同列时整排/整列一起滑动（移植自 Unity 版 OnPuzzleButtonClick）。
     * 数据立刻更新，节点位置用 tween 播放滑动动画。
     */
    private onPieceClick(piece: number) {
        if (this.moving) return;

        const slot = this.slotPieces.indexOf(piece);
        const emptySlot = this.slotPieces.indexOf(EMPTY);
        const clickRow = Math.floor(slot / COLS), clickCol = slot % COLS;
        const emptyRow = Math.floor(emptySlot / COLS), emptyCol = emptySlot % COLS;

        // 从紧邻空格的块开始，到被点击的块为止，依次向空格方向挪一格
        const moves: Array<[number, number]> = []; // [fromSlot, toSlot]
        if (clickRow === emptyRow && clickCol !== emptyCol) {
            const step = clickCol > emptyCol ? 1 : -1;
            for (let col = emptyCol + step; col !== clickCol + step; col += step) {
                const cur = clickRow * COLS + col;
                moves.push([cur, cur - step]);
            }
        } else if (clickCol === emptyCol && clickRow !== emptyRow) {
            const step = clickRow > emptyRow ? 1 : -1;
            for (let row = emptyRow + step; row !== clickRow + step; row += step) {
                const cur = row * COLS + clickCol;
                moves.push([cur, cur - step * COLS]);
            }
        }
        if (moves.length === 0) return;

        if (!this.timerRunning) this.timerRunning = true; // 首次点击开始计时
        this.moving = true;

        let done = 0;
        for (const [from, to] of moves) {
            const movePiece = this.slotPieces[from];
            this.slotPieces[to] = movePiece;
            this.slotPieces[from] = EMPTY;

            const node = this.pieceNodes[movePiece]!;
            node.setSiblingIndex(COUNT + 5); // 滑动时置于最上层
            tween(node)
                .to(MOVE_DURATION, { position: this.slotToPos(to) }, { easing: 'sineOut' })
                .call(() => {
                    done++;
                    if (done === moves.length) {
                        this.moving = false;
                        if (this.isPuzzleComplete()) this.onPuzzleComplete();
                    }
                })
                .start();
        }
    }

    private isPuzzleComplete(): boolean {
        for (let i = 0; i < COUNT; i++) {
            if (this.slotPieces[i] !== i) return false;
        }
        return true;
    }

    private onPuzzleComplete() {
        this.timerRunning = false;
        this.moving = false;
        console.log('恭喜你，完成拼图！');

        // 结算：不弹单独的框，直接把完成图盖在拼图上
        // 30 秒内用 finish 图，超过 30 秒用 full 整图；没有 finish 图时也用整图
        const showOverlay = (sf: SpriteFrame | null) => {
            const frame = sf || this.fullFrame;
            if (frame) {
                this.setCoverSprite(this.completeOverlay, frame);
                this.completeOverlay!.node.active = true;
            }
        };
        if (this.elapsed < FAST_TIME) {
            this.loadLevelAsset(this.currentLevel, `source${this.currentLevel}/finish/spriteFrame`, SpriteFrame, (err, sf) => {
                showOverlay(err || !sf ? null : sf);
            });
        } else {
            showOverlay(null);
        }

        // 保存最佳纪录（对应 Unity 版 PlayerPrefs）
        const key = `BestTime_Level${this.currentLevel}`;
        const best = this.getBestTime(this.currentLevel);
        const isNewRecord = this.elapsed < best;
        if (isNewRecord) {
            sys.localStorage.setItem(key, String(this.elapsed));
        }
        const best2 = this.getBestTime(this.currentLevel);
        this.bestLabel!.string = `Best ${this.formatTime(best2)}`;
        if (this.resultLabel) {
            this.resultLabel.string =
                `Time ${this.formatTime(this.elapsed)}${isNewRecord ? '  🎉New Record!' : ''}`;
        }
    }

    private getBestTime(level: number): number {
        const v = sys.localStorage.getItem(`BestTime_Level${level}`);
        return v ? parseFloat(v) : Number.MAX_SAFE_INTEGER;
    }

    // =====================================================================
    // 拼图块渲染：有图用图，没图用色块 + 编号；空白块半透明黑
    // =====================================================================

    private updatePieceVisual(piece: number) {
        const node = this.pieceNodes[piece];
        if (!node) return;
        const g = node.getComponent(Graphics)!;
        const img = this.pieceImgs[piece]!;
        const numLabel = node.getComponentInChildren(Label)!;
        const h = TILE / 2;

        if (piece === EMPTY) {
            // 空白块：黑色 20% 不透明度（对应 Unity 版逻辑）
            img.node.active = false;
            numLabel.node.active = false;
            g.fillColor = new Color(0, 0, 0, 51);
        } else {
            const sf = this.pieceFrames[piece];
            if (sf) {
                img.node.active = true;
                img.spriteFrame = sf;
                numLabel.node.active = false;
                g.fillColor = Color.WHITE;
            } else {
                img.node.active = false;
                numLabel.node.active = true;
                numLabel.string = `${piece + 1}`;
                g.fillColor = PALETTE[piece % PALETTE.length];
            }
        }
        g.clear();
        g.roundRect(-h, -h, TILE, TILE, 16);
        g.fill();
        // 细白描边（比之前更细更收敛）
        g.lineWidth = 2;
        g.strokeColor = new Color(255, 255, 255, 70);
        g.roundRect(-h + 1, -h + 1, TILE - 2, TILE - 2, 15);
        g.stroke();
    }

    // =====================================================================
    // 工具
    // =====================================================================

    /** 槽位 -> 局部坐标（行 0 在最上面） */
    private slotToPos(slot: number): Vec3 {
        const row = Math.floor(slot / COLS), col = slot % COLS;
        return new Vec3(
            (col - (COLS - 1) / 2) * (TILE + GAP),
            ((ROWS - 1) / 2 - row) * (TILE + GAP),
            0,
        );
    }

    private formatTime(t: number): string {
        const minutes = Math.floor(t / 60);
        const seconds = Math.floor(t % 60);
        const p = (n: number) => (n < 10 ? `0${n}` : String(n));
        return `${p(minutes)}:${p(seconds)}`;
    }

    private updateTimerText() {
        if (this.timerLabel) this.timerLabel.string = this.formatTime(this.elapsed);
    }

    // ---------- 节点/组件快捷创建 ----------

    private createNode(name: string, parent: Node, w: number, h: number, pos: Vec3): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(w, h);
        node.setPosition(pos);
        parent.addChild(node);
        return node;
    }

    /**
     * 在容器节点里创建一个保持图片宽高比「铺满并裁剪」（cover）的 Sprite 子节点。
     * 容器需配 Mask 组件裁掉超出部分。图片为 4:3 之类比例时不会被硬压变形。
     */
    private createCoverSprite(container: Node, sf: SpriteFrame | null = null): Sprite {
        const node = this.createNode('img', container, 10, 10, new Vec3(0, 0, 0));
        const sp = node.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        this.setCoverSprite(sp, sf);
        return sp;
    }

    /** 给 cover 型 Sprite 设置帧：按容器尺寸等比放大到铺满（多出的部分由 Mask 裁掉） */
    private setCoverSprite(sp: Sprite | null, sf: SpriteFrame | null) {
        if (!sp) return;
        sp.spriteFrame = sf;
        if (!sf) return;
        const r = sf.rect;
        if (r.width <= 0 || r.height <= 0) return;
        const parent = sp.node.parent;
        if (!parent) return;
        const pt = parent.getComponent(UITransform)!;
        const scale = Math.max(pt.width / r.width, pt.height / r.height);
        sp.node.getComponent(UITransform)!.setContentSize(r.width * scale, r.height * scale);
    }

    /** 英文花体：优先加载 resources/fonts 里的 GreatVibes.ttf（OFL 可商用），失败回退系统花体 */
    private applyScriptFont(label: Label, fontSize = 170) {
        label.fontFamily = 'Great Vibes, Segoe Script, Brush Script MT, cursive';
        resources.load('fonts/GreatVibes/font', Font, (err, font) => {
            if (font) {
                label.font = font;
                label.useSystemFont = false;
                label.fontSize = fontSize;
                return;
            }
            // 兼容不同导入路径：ttf 资产也可能注册为不带 /font 子路径
            resources.load('fonts/GreatVibes', Font, (e2, font2) => {
                if (font2) {
                    label.font = font2;
                    label.useSystemFont = false;
                    label.fontSize = fontSize;
                }
            });
        });
    }

    private createLabel(parent: Node, text: string, fontSize: number, color: Color, pos: Vec3): Label {
        const node = new Node('label');
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform);
        node.setPosition(pos);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = Math.floor(fontSize * 1.3);
        label.color = color;
        parent.addChild(node);
        return label;
    }

    private createButton(parent: Node, text: string, w: number, h: number, pos: Vec3,
        onClick: () => void, fontSize = 52, bgColor = new Color(70, 130, 220, 255)): Node {
        const node = this.createNode(`btn_${text}`, parent, w, h, pos);
        const g = node.addComponent(Graphics);
        g.fillColor = bgColor;
        g.roundRect(-w / 2, -h / 2, w, h, 14);
        g.fill();
        node.on(Node.EventType.TOUCH_START, () => node.setScale(0.94, 0.94, 1), this);
        node.on(Node.EventType.TOUCH_CANCEL, () => node.setScale(1, 1, 1), this);
        node.on(Node.EventType.TOUCH_END, () => {
            node.setScale(1, 1, 1);
            onClick();
        }, this);
        this.createLabel(node, text, fontSize, Color.WHITE, new Vec3(0, 0, 0));
        return node;
    }
}
