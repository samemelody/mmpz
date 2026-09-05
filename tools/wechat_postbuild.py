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

# 1. 移动 bundle 目录
sub_dir = os.path.join(BUILD, 'subpackages')
os.makedirs(sub_dir, exist_ok=True)
for name in BUNDLES:
    src = os.path.join(BUILD, 'assets', name)
    dst = os.path.join(sub_dir, name)
    if os.path.exists(src):
        shutil.move(src, dst)
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
