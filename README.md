# mmpz 滑块拼图（Cocos Creator 版）

Unity 版滑块拼图游戏的 Cocos Creator 3.8.8 移植版。

> **忘了进度？先看 [docs/WORKLOG.md](docs/WORKLOG.md)**（当前状态 + 开发日志），
> 改代码前扫一眼 [docs/PITFALLS.md](docs/PITFALLS.md)（踩坑速查）。

## 已实现

- 4 行 × 3 列 = 12 块滑块拼图，最后一块为空格
- 点击与空格同行/同列的块，整排/整列一起滑动（与 Unity 版一致）
- 打乱时逆序数校验，保证每次开局必可解
- 计时器；30 秒内完成显示 `finish` 结算图，超过 30 秒显示 `full` 整图
- 按关卡保存最佳纪录（`sys.localStorage`，对应 Unity 的 PlayerPrefs）
- 开始页（进入选关 / 随机一关）→ 选关页 → 游戏
- 关卡数自动检测：`assets/resources/` 下有几个 `sourceN` 目录（有 `full` 或 `1` 图就算一关）就显示几张卡片，卡片带整图缩略图预览
- 完成拼图后结算图直接盖在拼图上（不弹单独的弹窗）
- 无美术资源时自动用「色块 + 编号」占位，逻辑可先跑通

## 编辑器接入步骤（只需做一次）

场景文件已生成在 `assets/scenes/main.scene`（Canvas + Camera，PuzzleGame 脚本已挂好）：

1. 用 Cocos Creator 3.8.8 打开本项目
2. 双击打开 `assets/scenes/main.scene`，点预览即可游玩
3. 构建发布时，把 `main.scene` 加入「参与构建的场景列表」（或点「添加所有场景」）

> 设计分辨率已在代码里设为 1080×1920（FIXED_HEIGHT 竖屏适配）；
> 也可在 `项目设置 -> 项目数据` 里同步配置。

## 放入美术资源（替换占位色块）

**方式 A（推荐）：一张整图，运行时自动切块**

把一张图片放到 `assets/resources/source1/full.png`（jpg 也可以）。
任意尺寸都行，会自动居中裁剪成 3:4 再切成 12 块，同时该图自动作为背景提示图、选关卡片缩略图和完成结算图。

新增关卡 = 新建一个 `assets/resources/sourceN/` 目录放图（N 递增），选关页会自动多出一张卡片，无需改代码。

**方式 B：单独的拼图块图片**

```
assets/resources/source1/1.jpg ~ 12.jpg   拼图块（按从左上到右下的顺序编号）
assets/resources/source1/finish.jpg       可选：30 秒内完成的结算图
assets/resources/source2/...              第 2 关
assets/resources/source3/...              第 3 关
```

两种方式可共存：优先用 `full` 整图，没有 `full` 才按单图加载。
图片可缺省：缺哪块就用哪块的占位色块，不影响运行。

## 后续可扩展

- 更多关卡（改 `PuzzleGame.ts` 顶部的 `LEVELS` 常量即可）
- 音效、步数统计、排行榜

## 常见问题

**预览报 `Can not find class 'xxx'` / 组件 corrupted、或白屏**
多半是脚本 TypeScript 编译失败导致类没注册。可本地检查编译：
```
node "C:\ProgramData\cocos\editors\Creator\3.8.8\resources\app.asar.unpacked\node_modules\typescript\bin\tsc" -p tsconfig.check.json
```
注意项目编译目标是 ES2015，不要用 `padStart` 等 ES2016+ 的 API。
