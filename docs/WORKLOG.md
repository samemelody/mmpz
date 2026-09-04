# 开发日志（Worklog）

> 每次开发完往这里追加一节。忘了进度先看最上面的「当前状态」，再看最下面的日期倒序日志。

## 当前状态（2026-09-02）

**代码仓库与发布**

- GitHub：https://github.com/samemelody/mmpz（`main` = 源码，`gh-pages` = 网页版产物）
- 发布流程（每次更新后）：①编辑器命令行构建 `"C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe" --project <项目路径> --build "platform=web-mobile;debug=false"`（约 2 分钟）→ ②在 `build/web-mobile` 里 `touch .nojekyll`，该目录已 `git init` 且远端指向同一仓库，`git add -A && git commit && git push -f origin gh-pages` → ③GitHub 仓库 Settings → Pages → 分支选 `gh-pages`
- 在线地址：https://samemelody.github.io/mmpz/
- 注意：GitHub 直连时通时断，推送失败就等几分钟重试；`build/web-mobile` 是嵌套 git 仓库（父仓库已 ignore build/），别把它当源码仓库用

游戏已可完整游玩：开始页 → 选关页 → 拼图 → 结算，全流程无报错。

- 美术资源：`source1`~`source8` 共 8 关，每关都有 `full` + `finish`（source6 是 `full.jpg`，加载路径不带扩展名，jpg 自动适配）
- 关卡图来源：source1/2 早期已有；source3~5、7、8 来自用户的 AI 生图，按「人物重叠对齐」裁成 3:4（脸部相对位置对齐、避开 AI 生成水印），统一输出 900×1200
- 新增关卡流程：用户把图丢 `D:\workspace\littilegame\mmpz\TMP`（`full.png`/`finish.png`），PIL 裁 3:4 按人物对齐后入库 `sourceN`，选关页自动多出卡片，无需改代码
- 选关页：**3 列 + 纵向滚动容器**（ScrollView + Mask），关卡再多也不超屏；卡片 340 宽、缩略图 312×416、字号 32；返回按钮移到 y=-890
- **轮播背景**：开始页/选关页底下加 `bgLayer`（两个 cover Sprite 交叉淡入淡出，每 4 秒随机换一张关卡整图），上层盖 185 透明度白纱保证文字可读；页面本体改透明；进游戏时 bgLayer 隐藏（游戏层自带深色底）。想调浓淡改 `buildBgLayer` 里白纱的 alpha 185
- **开始页改版（二轮）**：背景固定用 source1 整图（不再用随机轮播，轮播只留给选关页）+ 淡白纱（alpha 100）；标题「MM Puzzle」粉色花体放页面底部（不挡人脸，黑色字和衣服重合看不清）；删掉中文玩法提示；**全部 UI 文案改英文**（Start/Random/Back/Retry/Levels/Select Level/N Levels/Level N/Best/Time/New Record）。标题字体还是 `resources/fonts/GreatVibes.ttf`（OFL 可商用）
- **选关页**：背景保留随机轮播（bgLayer）

### 已知待办

- [ ] 没有音效
- [ ] 拼图块白描边如果还嫌大：`updatePieceVisual` 里的 `lineWidth = 2` 和图片层 `TILE - 2` 还能再调
- [ ] 构建发布时记得把 `main.scene` 加进「参与构建的场景列表」

---

## 2026-09-02（晚）

**8 关适配：选关页 3 列 + 滚动**

- 用户一口气补到 source8（source6 用 `full.jpg`，验证了 jpg 自动适配，无需统一格式）
- 选关页从 2 列静态改为 3 列 + ScrollView 滚动容器：卡片 420→340 宽、缩略图 312×416、字号 40→32（否则「第 N 关 + 纪录」超出窄卡片）、返回按钮 -800→-890（给滚动视窗让位）
- content 节点顶部锚点 (0.5,1) 放视窗上沿，卡片按行向下堆叠；行数 = ceil(关卡数/3)，内容不足一屏时 content 高度取一屏（不出现回弹空白）
- tsc 编译通过

## 2026-09-02

**关卡图扩充（source3、source4）**

- 用户提供 AI 生图（ TMP 目录），PIL 按「人物重叠对齐」裁剪成 full/finish 对：两组图脸部相对位置对齐（~0.33），finish 是同角色换装版本，30 秒内通关 = 变身效果
- source3：樱花+白猫二次元图（2048² jpg 裁 1536×2048 / 1000×1770 png 裁 1000×1333）
- source4：9:16 自拍风（1440×2560 裁 y160~2080、1728×2304 内缩到 1508×2010），裁剪窗口特意避开了「AI生成」左上角和「星流AI」右下角水印
- 输出统一 900×1200；游戏侧零改动（关卡数运行时探测）
- 试过 OpenGameArt 淘免费插画：大多是小尺寸像素图/sprite sheet 不适合竖版拼图，放弃，改用 AI 生图

## 2026-09-01

**UI 打磨与修复**

- 白框问题根因：Sprite 的 `sizeMode` 默认 `TRIMMED`，按图片**原始像素尺寸**渲染而不是节点尺寸——切块帧比节点小（图缩中间露白边），单图方式则溢出棋盘。所有动态赋帧的 Sprite 必须设 `sizeMode = Sprite.SizeMode.CUSTOM`。图片层改为 `TILE-2`，描边 2px，白边基本消失
- 选关列表重做：3:4 竖版缩略图（384×512）、白卡片、标题在 y=800 / 副标题 y=700 / 第一行卡片 y=250（之前卡片压住标题、关卡文字超出卡片下边缘，都修了）
- 选关页改为**异步动态生成**：启动时探测 `source1、source2...` 有图就算一关；加了 `page` 状态（start/level/game），防止异步建页时盖错页面（之前进主页直接显示选关列表就是这个原因）
- 新增开始页：「开始游戏」→ 选关页、「随机一关」→ 随机进关
- 完成结算不弹窗：结算图直接盖在拼图棋盘上（Mask + 等比 cover），下方显示用时/新纪录
- 结算图命名改为（用户定）：≥30s 用 `full`，<30s 用 `finish`（与 Unity 原版 finish1/finish2 不同）
- 工具方法 `createCoverSprite / setCoverSprite`：保持宽高比铺满容器+Mask 裁剪（用于结算图、游戏背景）

## 2026-08-31

**玩法移植完成，可玩**

- 滑动动画（tween，0.07s，输入锁定）、滑动速度已调快
- 运行时切块跑通：`new SpriteFrame()` + **先设 texture 再设 rect**（rect 原点是图片左上角）
- 修复重开一局崩溃（Simple.updateUVs null）：①destroy 旧帧前先把 Sprite 组件的 spriteFrame 引用清 null；②resources.load 的帧**不能 destroy**（运行时切块的帧才需要手动销毁，用 `slicedFrames` 数组跟踪）
- 30 秒结算图逻辑从 Unity 原版确认（原版是 elapsedTime < 30f → finish2）

## 2026-08-30 之前

**从零搭起**

- Unity 版（github.com/samemelody/mmpupzzle）→ Cocos Creator 3.8.8 移植
- 决策：UI 纯代码动态生成（不手摆场景）、竖屏 1080×1920 FIXED_HEIGHT、占位色块+编号先跑通
- 手写生成 `assets/scenes/main.scene`（Canvas + Camera + 挂 PuzzleGame 脚本）
- 踩坑记录（详见 README「常见问题」）：
  - 场景报 `Can not find class 'xxx'`：TS 编译失败（ES2015 目标不能用 `padStart`）或场景里脚本组件 `__type__` 的压缩 UUID 格式不对（要用 23 字符格式，从 `temp/programming/packer-driver` 编译产物 grep `_RF.push` 可拿到）
  - 本地类型检查命令：`node "C:\ProgramData\cocos\editors\Creator\3.8.8\resources\app.asar.unpacked\node_modules\typescript\bin\tsc" -p tsconfig.check.json`（npm 走 npmmirror 会超时，用编辑器自带 tsc）
