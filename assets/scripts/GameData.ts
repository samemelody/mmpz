/**
 * 跨场景共享的游戏数据（对应 Unity 版的 GameData）
 */
export class GameData {
    /** 关卡选择界面写入，PuzzleGame 场景读取；0 表示未选择 */
    static SelectedLevel = 0;
}
