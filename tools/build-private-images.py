"""Build the PRIVATE Apps Script image file. Never commit or publish the output.

Usage: python tools/build-private-images.py [directory-containing-pngs]
Requires Pillow. The source PNG filenames must match the location cells.
"""

import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT
output = ROOT / '.private' / 'LocationImages.gs'
images = {}
for file in sorted(source.glob('*.png')):
    # Re-encode pixels to remove original filenames, EXIF, comments and PNG text.
    with Image.open(file) as original:
        image = ImageOps.exif_transpose(original).convert('RGB')
        image.thumbnail((1400, 1400), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format='WEBP', quality=90, method=6)
    images[file.stem.strip().lower()] = 'data:image/webp;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')

if not images:
    raise SystemExit('No PNG images found; refusing to create an empty image bundle.')
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(
    '// PRIVATE SERVER FILE. Add only to Apps Script, never GitHub Pages.\n'
    + 'const PRIVATE_LOCATION_IMAGES_ = Object.freeze(' + json.dumps(images, ensure_ascii=True) + ');\n'
    + 'function privateLocationImage_(name) {\n'
    + '  return PRIVATE_LOCATION_IMAGES_[normalize_(name)] || "";\n'
    + '}\n',
    encoding='utf-8',
)
combined = output.with_name('DeployCode.gs')
combined.write_text((ROOT / 'Code.gs').read_text(encoding='utf-8') + '\n' + output.read_text(encoding='utf-8'), encoding='utf-8')
print(f'Built {len(images)} private images ({output.stat().st_size:,} bytes). Output: {output}')
print(f'Combined backend for direct editor paste: {combined}')
