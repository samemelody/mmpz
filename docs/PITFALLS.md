# 技术坑速查（Cocos Creator 3.8.8 实踩）

> 改代码前扫一眼，能省掉大部分排查时间。每条都是这个项目里真实踩过的。

## 1. Sprite.sizeMode 默认 TRIMMED（最近踩的）

Sprite 按**图片原始像素尺寸**渲染，不看你节点的 contentSize。

- 动态切块帧 originalSize = 切块像素大小 → 图缩在节点中间，四周露底色（「白边大」的真凶）
- 单图 1~12.jpg 方式 → 按原图尺寸渲染，直接溢出棋盘（「整个都飞了」的真凶）

**规则：代码里动态赋 spriteFrame 的 Sprite，一律 `sizeMode = Sprite.SizeMode.CUSTOM`。**

## 2. 运行时切块（SpriteFrame）

- **不能用 `SpriteFrame.clone()`**：序列化拷贝会丢纹理引用 → uv 为 null → `Simple.updateUVs` 崩溃
- 正确姿势：`new SpriteFrame()` → **先设 `texture` 再设 `rect`**（顺序反了不触发 UV 计算）
- `sf.rect` 的原点是**贴图左上角**（不是左下角），已查引擎 `_calculateUV` 源码确认
- 切完记得 `sf.packable = false`，防止动态图集重排后 rect 失效

## 3. SpriteFrame 的销毁

- destroy 旧帧前，先把引用它的 Sprite 组件 `spriteFrame = null`，否则节点重新激活时读已销毁帧的 uv → 崩溃（症状：第一局正常，重玩/切关卡就炸）
- **`resources.load` 加载的帧绝不能 `destroy()`**（资产管理器还持有），只有运行时 `new` 出来的帧要手动销毁（项目里用 `slicedFrames` 数组跟踪）

## 4. 场景 / 脚本注册

- 项目 TS 编译目标是 **ES2015**：不能用 `padStart` 等 ES2016+ API，否则编译失败 → 类没注册 → 场景报 `Can not find class '压缩uuid'` / 组件 corrupted / 白屏
- .scene 里脚本组件的 `__type__` 是**压缩 UUID**，有两种格式：
  - 引擎 `decodeUuid`：22 字符
  - **编辑器/运行时类注册：23 字符（前 5 个 hex 保留 + 每 3 hex→2 base64）** ← 场景文件要用这个
  - 实际值从编译产物拿：`temp/programming/packer-driver/targets/editor/chunks/` 里 grep `_RF.push`
- 改了脚本跑不起来，先本地编译验证：
  ```
  node "C:\ProgramData\cocos\editors\Creator\3.8.8\resources\app.asar.unpacked\node_modules\typescript\bin\tsc" -p tsconfig.check.json
  ```

## 5. 其他

- 动态创建的节点必须设 `node.layer = Layers.Enum.UI_2D`，否则相机渲染不到
- npm/npx 装包走 npmmirror 会超时，一律用编辑器自带 tsc / 本地已有依赖
- 结算图/背景图是 4:3、棋盘是 3:4 时，只能「等比放大铺满 + Mask 裁剪」（`createCoverSprite`），不要直接拉伸
