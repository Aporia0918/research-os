"""Rebuild the two sample PDFs the on-phone PDF tests read: python3 make_fixtures.py (needs reportlab and Pillow).

text.pdf: two pages with a text layer (Methods on page 1, Results on page 2).
scanned.pdf: one page that is only a picture, like a scan, so it has no text layer.
"""
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

HERE = Path(__file__).parent


def text_pdf() -> None:
    c = canvas.Canvas(str(HERE / "text.pdf"), pagesize=A4, invariant=1)
    for lines in (
        ["Methods", "We trained EEGNet with Adam at a learning rate of 0.001.", "Data were band-pass filtered."],
        ["Results", "Subject-wise cross-validation gave accuracy 0.82 on held-out subjects."],
    ):
        y = 780
        for line in lines:
            c.drawString(72, y, line)
            y -= 20
        c.showPage()
    c.save()


def scanned_pdf() -> None:
    img = Image.new("RGB", (600, 300), "white")
    ImageDraw.Draw(img).text((40, 140), "This page is a picture of text.", fill="black")
    buf = BytesIO()
    img.save(buf, "PNG")
    buf.seek(0)
    c = canvas.Canvas(str(HERE / "scanned.pdf"), pagesize=A4, invariant=1)
    c.drawImage(ImageReader(buf), 72, 500, width=450, height=225)
    c.showPage()
    c.save()


if __name__ == "__main__":
    text_pdf()
    scanned_pdf()
