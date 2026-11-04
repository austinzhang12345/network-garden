"""Normalise every plant sprite to one shared frame so a plant never jumps in size when its care state changes.

Every image is scaled so the lower rim of its soil mound matches the mound of daisies_healthy (the anchor),
then placed with the mound centred and its base on a common baseline. The lower rim is used because leaves and
fallen petals never cover it. Outputs WebP sprites plus bounds.json (opaque box of each sprite as fractions).

Usage: python3 tools/normalize_plants.py [path to the Codex task package]
"""
import sys, os, json
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', '..', 'Codex出图任务_2026-09-30')
LOOKS = ['sprout', 'bush', 'tulip', 'daisies', 'lavender', 'hydrangea', 'sunflower']
STATES = ['healthy', 'thirsty', 'wilted']
W, H, BASE = 340, 380, 14          # output frame in anchor pixels; mound base sits BASE px above the bottom edge
RIM = 22                            # rows above the mound base used for fitting (about 11% of the anchor mound width)
OUT = os.path.join(HERE, 'assets', 'plants')

def source(look, state):
    if state == 'healthy' and look in LOOKS[:4]:
        return os.path.join(HERE, 'assets', f'source-{look}.png')
    for r in ['round1-sample', 'round2-existing', 'round3-new-species']:
        f = os.path.join(PKG, 'output', r, f'{look}_{state}.png')
        if os.path.exists(f): return f
    raise FileNotFoundError(f'{look}_{state}')

def profile(im):
    al = np.asarray(im)[:, :, 3] > 128
    bot = np.where(al.any(1))[0].max()
    widths, centres = [], []
    for y in range(bot, max(bot - 500, 0), -1):
        xs = np.where(al[y])[0]
        widths.append(xs.max() - xs.min() + 1 if len(xs) else 0)
        centres.append((xs.max() + xs.min()) / 2 if len(xs) else np.nan)
    return bot, np.array(widths, float), np.array(centres)

def fit_scale(anchor, prof):
    ds = np.arange(1, RIM)
    best = (1e18, 1.0)
    for s in np.linspace(0.12, 1.8, 3000):
        idx = ds / s
        if idx.max() >= len(prof) - 1: continue
        err = np.mean((np.interp(idx, np.arange(len(prof)), prof) * s - anchor[ds]) ** 2)
        if err < best[0]: best = (err, s)
    return best[1], best[0] ** 0.5

def main():
    os.makedirs(OUT, exist_ok=True)
    anchor = profile(Image.open(source('daisies', 'healthy')).convert('RGBA'))[1]
    bounds, report = {}, []
    for look in LOOKS:
        for state in STATES:
            src = source(look, state)
            im = Image.open(src).convert('RGBA')
            bot, prof, cent = profile(im)
            s, rms = fit_scale(anchor, prof)
            cx = float(np.nanmean(cent[:max(2, int(RIM / s))]))
            t = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
            frame = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            ox, oy = round(W / 2 - cx * s), round(H - BASE - bot * s)
            frame.paste(t, (ox, oy), t)
            a = np.asarray(frame)[:, :, 3]
            ys, xs = np.where(a > 40)
            ta = np.asarray(t)[:, :, 3] > 40; tys, txs = np.where(ta)
            clipped = ox + txs.min() < 1 or oy + tys.min() < 1 or ox + txs.max() > W - 2 or oy + tys.max() > H - 2
            key = look if state == 'healthy' else f'{look}_{state}'
            frame.save(os.path.join(OUT, f'{key}.webp'), 'WEBP', quality=90, alpha_quality=100, method=6)
            bounds[key] = [round(xs.min() / W, 3), round(ys.min() / H, 3), round((xs.max() + 1) / W, 3), round((ys.max() + 1) / H, 3)]
            report.append(f'{key:20s} scale {s:.3f}  rim fit {rms:4.1f}px  opaque {xs.min()}-{xs.max()} x {ys.min()}-{ys.max()}' + ('  CLIPPED: plant cut off by the frame' if clipped else ''))
    json.dump({'frame': [W, H], 'base': BASE, 'bounds': bounds}, open(os.path.join(OUT, 'bounds.json'), 'w'), indent=1)
    print('\n'.join(report))
    print(f'Wrote {len(bounds)} sprites to {OUT}')

main()
