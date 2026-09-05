# 小游戏适配：关卡图 PNG -> JPG（质量递减直到目标大小），原 PNG 及 meta 删除
import os
from PIL import Image

RES = 'assets/resources'
TARGET = 400 * 1024  # 单张目标上限，质量从 85 往下试探
QUALITIES = [85, 80, 75, 70]

total_before = total_after = 0
for lv in range(1, 9):
    d = f'{RES}/source{lv}'
    for name in ('full', 'finish'):
        src = None
        for ext in ('.png', '.jpg'):
            p = os.path.join(d, name + ext)
            if os.path.exists(p):
                src = p
                break
        if src is None:
            print(f'MISSING {d}/{name}')
            continue
        total_before += os.path.getsize(src)
        img = Image.open(src).convert('RGB')
        out = os.path.join(d, name + '.jpg')
        for q in QUALITIES:
            img.save(out, 'JPEG', quality=q, optimize=True)
            if os.path.getsize(out) <= TARGET:
                break
        sz = os.path.getsize(out)
        total_after += sz
        if src != out:
            os.remove(src)
            meta = src + '.meta'
            if os.path.exists(meta):
                os.remove(meta)
        print(f'source{lv}/{name}: {sz//1024}KB (q{q}) {img.size}')

print(f'TOTAL: {total_before//1024}KB -> {total_after//1024}KB')
