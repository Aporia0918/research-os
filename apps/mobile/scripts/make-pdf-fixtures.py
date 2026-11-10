"""Generate fixed sample PDFs for tests (synthetic content, no private data).
text.pdf: 2 pages with a text layer.  scanned.pdf: 1 page, image only, no text layer."""
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import io, zlib
d = 'tests/fixtures/pdf/'
c = canvas.Canvas(d + 'text.pdf', pageCompression=0, invariant=1)
c.drawString(72, 720, 'Methods: we trained EEGNet with Adam, learning rate 0.001.'); c.showPage()
c.drawString(72, 720, 'Results: accuracy 0.82 on page two.'); c.showPage(); c.save()
# 200x60 grayscale image with dark bars (looks like a scan; no text layer)
w, h = 200, 60
raw = bytes((0 if (x // 10) % 2 and 20 < y < 40 else 255) for y in range(h) for x in range(w))
import struct
def png(w, h, raw):
    rows = b''.join(b'\x00' + raw[y*w:(y+1)*w] for y in range(h))
    ch = lambda t, b: struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0)) + ch(b'IDAT', zlib.compress(rows)) + ch(b'IEND', b'')
c = canvas.Canvas(d + 'scanned.pdf', invariant=1)
c.drawImage(ImageReader(io.BytesIO(png(w, h, raw))), 72, 600, 400, 120); c.showPage(); c.save()
