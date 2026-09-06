# 微信小游戏构建后处理（每次构建 wechatgame 后必须跑一遍）
#
# 用法：
#   python tools/wechat_postbuild.py             # 开发模式（默认）：不分包，主包 8.5MB 靠
#                                                # bigPackageSizeSupport 放宽，模拟器/预览最稳
#   python tools/wechat_postbuild.py --release   # 发布模式：bundle 拆成 subpackages/（主包 <4MB），
#                                                # 仅上传前使用；模拟器对这种手动分包兼容性差
#
# 两种模式都会做：
#   - 写入 AppID（tools/wx_appid.txt，无则用测试号 touristappid）
#   - useIsolateContext=false + libVersion=3.8.12（隔离沙箱/灰度库会导致 web-adapter 崩溃黑屏）
#   - game.js 注入 window 垫片（新开发者工具 WAGameSubContext 无 window 全局）
import json
import os
import shutil
import sys

BUILD = 'build/wechatgame'
BUNDLES = ['resources', 'levels2']  # source1~4 + 字体 / source5~8
RELEASE = '--release' in sys.argv

# ---------- AppID / project.config.json ----------
appid_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wx_appid.txt')
appid = open(appid_file, encoding='utf-8').read().strip() if os.path.exists(appid_file) else ''
if not appid.startswith('wx'):
    appid = 'touristappid'
pc = os.path.join(BUILD, 'project.config.json')
cfg = json.load(open(pc, encoding='utf-8'))
# 隔离沙箱(WAGameSubContext)里 web-adapter 建 window 会崩
# (Object.defineProperty called on non-object → 黑屏)，必须关掉；
# widelyUsed 会解析到灰度基础库(如 3.17.2)，固定到稳定版；
# bigPackageSizeSupport 允许开发模式下主包超 4MB
always = {'useIsolateContext': False, 'bigPackageSizeSupport': True}
# 基础库：dev 固定 3.8.12（模拟器避开灰度库）；release 保持 widelyUsed——
# 手机预览会用到该字段，3.8.12 在真机上会黑屏（2026-09-06 实测），widelyUsed 正常
lib_target = 'widelyUsed' if RELEASE else '3.8.12'
need_write = (cfg.get('appid') != appid
              or any(cfg['setting'].get(k) != v for k, v in always.items())
              or cfg.get('libVersion') != lib_target)
cfg['appid'] = appid
cfg['setting'].update(always)
cfg['libVersion'] = lib_target
if need_write:
    json.dump(cfg, open(pc, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('project.config.json: appid =', appid, '| useIsolateContext=false | libVersion=3.8.12 | bigPackageSizeSupport=true')

# ---------- game.js 注入 window 兼容垫片 ----------
#    新版开发者工具把游戏跑在 WAGameSubContext("mp")里，没有预置 window 全局，
#    web-adapter 的 devtools 分支 Object.defineProperty(window,...) 直接
#    TypeError "called on non-object" → 黑屏。预置 window=GameGlobal 恢复旧语义；
#    旧环境/真机本身有 window 或走 else 分支，此垫片为空操作。
gjs = os.path.join(BUILD, 'game.js')
src = open(gjs, encoding='utf-8').read()
if '// PATCH(window-compat)' not in src:
    shim = (
        "// PATCH(window-compat): new devtools WAGameSubContext has no predefined `window` global;\n"
        "    // web-adapter devtools branch does Object.defineProperty(window,...) -> TypeError (black screen).\n"
        "    if (typeof window === 'undefined' && typeof GameGlobal !== 'undefined') { GameGlobal.window = GameGlobal; }\n"
        "    require('./web-adapter');")
    src = src.replace("require('./web-adapter');", shim, 1)
    open(gjs, 'w', encoding='utf-8').write(src)
    print('game.js: window shim injected')


def du(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    return total


if not RELEASE:
    # ---------- 开发模式：Cocos 默认结构，bundle 留在 assets/，不分包 ----------
    sp = os.path.join(BUILD, 'src', 'settings.json')
    s = json.load(open(sp, encoding='utf-8'))
    s.get('assets', {}).pop('subpackages', None)
    json.dump(s, open(sp, 'w', encoding='utf-8'), ensure_ascii=False)

    gj = os.path.join(BUILD, 'game.json')
    g = json.load(open(gj, encoding='utf-8'))
    g.pop('subpackages', None)
    json.dump(g, open(gj, 'w', encoding='utf-8'), indent=4, ensure_ascii=False)

    total = du(BUILD)
    print(f'[dev] 无分包  整包: {total/1024/1024:.2f}MB（预览/真机调试放宽上限；上传须用 --release）')
    if not os.path.isdir(os.path.join(BUILD, 'assets', 'resources')):
        print('!! build/wechatgame/assets/resources 不存在——上次是 --release 产物，请先重新构建再跑本脚本')
    sys.exit(0)

# ---------- 发布模式：bundle 拆成 subpackages/ ----------
sub_dir = os.path.join(BUILD, 'subpackages')
os.makedirs(sub_dir, exist_ok=True)
for name in BUNDLES:
    src_dir = os.path.join(BUILD, 'assets', name)
    dst = os.path.join(sub_dir, name)
    if os.path.exists(src_dir):
        shutil.move(src_dir, dst)
    # 微信要求分包根目录必须有 game.js 入口；加载分包时会执行它。
    # 必须 require index.js——引擎 init bundle 时会 System.import
    # 'virtual:///prerequisite-imports/<bundle>'，该虚拟模块由 index.js 注册，
    # 不 require 的话引擎启动直接报 "Unable to instantiate virtual:///prerequisite-imports/xxx" → 黑屏
    gj_path = os.path.join(dst, 'game.js')
    open(gj_path, 'w', encoding='utf-8').write(
        '// subpackage entry required by WeChat; registers bundle chunk imports\n'
        "require('./index.js');\n")
    print('subpackage:', dst, os.path.isdir(dst))

# settings.json：引擎据此把 bundle 路径映射到 subpackages/<name>/ 下
sp = os.path.join(BUILD, 'src', 'settings.json')
s = json.load(open(sp, encoding='utf-8'))
s.setdefault('assets', {})['subpackages'] = BUNDLES
json.dump(s, open(sp, 'w', encoding='utf-8'), ensure_ascii=False)
print('settings.assets.subpackages =', s['assets']['subpackages'])

# game.json：微信打包规则
gj = os.path.join(BUILD, 'game.json')
g = json.load(open(gj, encoding='utf-8'))
g['subpackages'] = [{'root': f'subpackages/{n}/', 'name': n} for n in BUNDLES]
json.dump(g, open(gj, 'w', encoding='utf-8'), indent=4, ensure_ascii=False)
print('game.json subpackages =', g['subpackages'])

total = du(BUILD)
main = total - du(sub_dir)
print(f'[release] 主包: {main/1024/1024:.2f}MB (<4MB)  分包合计: {du(sub_dir)/1024/1024:.2f}MB  整包: {total/1024/1024:.2f}MB (<30MB)')
