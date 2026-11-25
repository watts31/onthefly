# Builds the app icon on GitHub's servers: two official team logos on a diagonally split dark tile.
# Saves data/icon-512.png, data/icon-192.png and data/icon-180.png (iPhone home screen).
import io, os, urllib.request
from PIL import Image, ImageDraw, ImageFilter
A = ('https://a.espncdn.com/i/teamlogos/nhl/500/phi.png', '#f74902')   # top-left team: logo URL (dark-background version first), tint colour
B = ('https://a.espncdn.com/i/teamlogos/mlb/500/phi.png', '#002d72')   # bottom-right team
S = 1024
def fetch(u):
    for url in (u.replace('/500/', '/500-dark/'), u):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read()
            return Image.open(io.BytesIO(data)).convert('RGBA')
        except Exception as e:
            print('skip', url, e)
    raise SystemExit('could not download ' + u)
def mix(hexc, amt, base=(11, 11, 13)):
    c = tuple(int(hexc[i:i + 2], 16) for i in (1, 3, 5))
    return tuple(round(base[k] * (1 - amt) + c[k] * amt) for k in range(3))
def grad(col, flip):
    # soft radial-ish glow toward the logo's corner
    g = Image.new('RGB', (S, S), mix(col, 0.16))
    glow = Image.new('L', (S, S), 0); d = ImageDraw.Draw(glow)
    cx, cy = (S * 0.30, S * 0.30) if not flip else (S * 0.70, S * 0.70)
    d.ellipse([cx - S * 0.55, cy - S * 0.55, cx + S * 0.55, cy + S * 0.55], fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.14))
    return Image.composite(Image.new('RGB', (S, S), mix(col, 0.42)), g, glow)
mask = Image.new('L', (S, S), 0); ImageDraw.Draw(mask).polygon([(0, 0), (S, 0), (0, S)], fill=255)
tile = Image.composite(grad(A[1], False), grad(B[1], True), mask).convert('RGBA')
line = Image.new('RGBA', (S, S), (0, 0, 0, 0)); ImageDraw.Draw(line).line([(S + 20, -20), (-20, S + 20)], fill=(255, 255, 255, 70), width=10)
tile = Image.alpha_composite(tile, line)
def place(img, cx, cy, box):
    img = img.crop(img.getbbox()); k = box / max(img.size)
    img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0)); a = img.split()[3].point(lambda v: v * 0.45)
    sh.paste((0, 0, 0, 255), (round(cx - img.width / 2), round(cy - img.height / 2) + 10), a)
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    out = Image.alpha_composite(tile, sh); out.alpha_composite(img, (round(cx - img.width / 2), round(cy - img.height / 2))); return out
tile = place(fetch(A[0]), S * 0.31, S * 0.31, S * 0.44)
tile = place(fetch(B[0]), S * 0.69, S * 0.69, S * 0.44)
os.makedirs('data', exist_ok=True)
final = tile.convert('RGB')
for n in (512, 192, 180): final.resize((n, n), Image.LANCZOS).save(f'data/icon-{n}.png', optimize=True)
print('icons saved')
