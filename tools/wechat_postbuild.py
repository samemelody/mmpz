# 微信小游戏构建后处理（每次构建 wechatgame 后必须跑一遍）：
# 1. 把 assets/resources、assets/levels2 移到 subpackages/（配置为分包，主包才能 <=4MB）
# 2. settings.json 的 assets.subpackages 声明这两个 bundle（引擎据此把 bundle 路径映射到 subpackages/ 下）
# 3. game.json 声明 subpackages（微信打包规则）
# 4. 打印主包/分包体积供核对（主包须 <4MB，整包 <30MB）
import json
import os
import shutil

BUILD = 'build/wechatgame'
BUNDLES = ['resources', 'levels2']  # source1~4 + 字体 / source5~8

# 正式 AppID：把 wx 开头的 AppID 写进 tools/wx_appid.txt（仅一行），
# 每次构建后自动替换 Cocos 占位的 wx6ac3f5090a6b99c5；没有该文件则保持占位（测试号导入时手动选）
appid_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wx_appid.txt')
if os.path.exists(appid_file):
    appid = open(appid_file, encoding='utf-8').read().strip()
    if appid.startswith('wx'):
        pc = os.path.join(BUILD, 'project.config.json')
        cfg = json.load(open(pc, encoding='utf-8'))
        if cfg.get('appid') != appid:
            cfg['appid'] = appid
            json.dump(cfg, open(pc, 'w', encoding='utf-8'), ensure_ascii=False)
        print('appid =', appid)

# 1. 移动 bundle 目录
sub_dir = os.path.join(BUILD, 'subpackages')
os.makedirs(sub_dir, exist_ok=True)
for name in BUNDLES:
    src = os.path.join(BUILD, 'assets', name)
    dst = os.path.join(sub_dir, name)
    if os.path.exists(src):
        shutil.move(src, dst)
    # 微信要求分包根目录必须有 game.js 入口；加载分包时会执行它。
    # 必须 require index.js——引擎 init bundle 时会 System.import
    # 'virtual:///prerequisite-imports/<bundle>'，该虚拟模块由 index.js 注册，
    # 不 require 的话引擎启动直接报 "Unable to instantiate virtual:///prerequisite-imports/xxx" → 黑屏
    gj_path = os.path.join(dst, 'game.js')
    open(gj_path, 'w', encoding='utf-8').write(
        '// subpackage entry required by WeChat; registers bundle chunk imports\n'
        "require('./index.js');\n")
    print('subpackage:', dst, os.path.isdir(dst))

# 2. settings.json
sp = os.path.join(BUILD, 'src', 'settings.json')
s = json.load(open(sp, encoding='utf-8'))
s.setdefault('assets', {})['subpackages'] = BUNDLES
json.dump(s, open(sp, 'w', encoding='utf-8'), ensure_ascii=False)
print('settings.assets.subpackages =', s['assets']['subpackages'])

# 3. game.json
gj = os.path.join(BUILD, 'game.json')
g = json.load(open(gj, encoding='utf-8'))
g['subpackages'] = [{'root': f'subpackages/{n}/', 'name': n} for n in BUNDLES]
json.dump(g, open(gj, 'w', encoding='utf-8'), indent=4, ensure_ascii=False)
print('game.json subpackages =', g['subpackages'])

# 4. 体积核对
def du(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    return total

main_kb = du(BUILD) - du(sub_dir) // 1  # subpackages 在 BUILD 内，先算总再扣
total = du(BUILD)
main = total - du(sub_dir)
print(f'主包: {main/1024/1024:.2f}MB (<4MB)  分包合计: {du(sub_dir)/1024/1024:.2f}MB  整包: {total/1024/1024:.2f}MB (<30MB)')
