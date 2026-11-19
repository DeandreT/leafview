"""Generate the synthetic client-preview corpus.

From the repository root (Python 3.12):
    python -m pip install --only-binary=:all: reportlab==4.4.3 pillow==11.3.0
    python bench/generate.py [OUTPUTDIR]

The default output is fixtures/. Each line reports the
file's byte size and SHA-256; repeat with the same interpreter, wheels and
platform for byte-identical PDFs. Reference Windows build: p25 = 423,298 bytes,
p250 = 662,637 bytes, m1..m10 = 423,324..423,395 bytes each. No input
documents, local fonts, or network are used during generation.

Repeating five-page cycle: invoice, scan, rotated landscape invoice, invoice,
scan. Each scan draws the same 1224x1584 grayscale JPEG XObject, plus a vector
packet/page label and registration patch. Reuse exercises page navigation and
renderer caching but understates file sizes, transfer, and decode cost versus
independent high-resolution scans. Simple synthetic forms and base-14 fonts
do not model arbitrary customer content. See markers.ts for pixel verification.
"""

import argparse
import hashlib
import io
import os
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas


LETTER = (612, 792)
DEFAULT_OUT = Path(__file__).resolve().parents[1] / "fixtures"
PACKETS = ("p25", "p250", *(f"m{i}" for i in range(1, 11)))
ITEMS = ("Tray dividers", "Map sleeves", "Dispatch slips", "Corner guards", "Bin labels")


def scan_image():
    """One seeded paper texture and one rasterized inspection form per corpus."""
    w, h = 1224, 1584
    noise = random.Random(612792).randbytes(w * h)
    paper = Image.frombytes("L", (w, h), noise).point([226 + n // 10 for n in range(256)])
    draw = ImageDraw.Draw(paper)
    heading = ImageFont.load_default(size=48)
    body = ImageFont.load_default(size=27)
    draw.text((96, 115), "Receiving inspection", font=heading, fill=45)
    draw.text((96, 240), "Synthetic scan / inventory worksheet", font=body, fill=60)
    for i in range(14):
        y = 340 + 72 * i
        draw.rectangle((97, y + 6, 118, y + 27), outline=55, width=2)
        if i % 4:
            draw.line(((99, y + 15), (105, y + 22), (121, y + 3)), fill=70, width=3)
        draw.text((150, y), f"{i + 1:02}    {ITEMS[i % len(ITEMS)]}", font=body, fill=55)
        draw.line((96, y + 47, 1110, y + 49), fill=125, width=2)
    jpg = io.BytesIO()
    paper.save(jpg, format="JPEG", quality=76)
    jpg.seek(0)
    return ImageReader(jpg)


def invoice(c, w, h, serial):
    c.setFont("Helvetica-Bold", 24)
    c.drawString(44, h - 68, "Itemized invoice")
    c.setFont("Helvetica", 11)
    c.drawString(44, h - 107, f"Orchard receiving desk    /    Order {30700 + serial}")
    top = h - 151
    c.setFont("Helvetica-Bold", 10)
    c.drawString(46, top + 6, "Line    /    Article")
    c.drawRightString(w - 160, top + 6, "Quantity")
    c.drawRightString(w - 46, top + 6, "Amount (USD)")
    c.setFont("Courier", 9)
    total = 0
    for i in range(17):
        y = top - i * 20
        c.setLineWidth(0.35)
        c.line(44, y, w - 44, y)
        qty = (serial + 3 * i) % 11 + 1
        cents = qty * (225 + 57 * i)
        total += cents
        c.drawString(46, y - 14, f"{i + 1:02}        {ITEMS[i % len(ITEMS)]}")
        c.drawRightString(w - 160, y - 14, str(qty))
        c.drawRightString(w - 46, y - 14, f"{cents / 100:.2f}")
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(w - 46, top - 371, f"Total: USD {total / 100:.2f}")


def generate(out):
    os.environ["SOURCE_DATE_EPOCH"] = "946684800"
    out.mkdir(parents=True, exist_ok=True)
    scan = scan_image()
    for code, packet in enumerate(PACKETS):
        pages = 250 if packet == "p250" else 25
        path = out / f"{packet}.pdf"
        c = Canvas(str(path), pagesize=LETTER, invariant=1, pageCompression=1)
        c.setTitle(f"Synthetic client preview / {packet}")
        for page in range(1, pages + 1):
            kind = (page - 1) % 5
            rotated = kind == 2
            w, h = LETTER[::-1] if rotated else LETTER
            c.setPageSize((w, h))
            c.setPageRotation(90 if rotated else 0)
            if rotated:
                # ReportLab writes a portrait MediaBox for our /Rotate 90.
                # Counter-rotate so all drawing uses displayed bottom-left axes.
                c.transform(0, 1, -1, 0, h, 0)
            if kind in (1, 4):
                c.drawImage(scan, 0, 0, w, h)
            else:
                invoice(c, w, h, code * 250 + page)
            c.setFont("Courier", 10)
            c.drawString(44, 38, f"SYNTHETIC   /   {packet}   /   Page {page} of {pages}")
            n = page - 1
            rgb = (16 + 20 * code, 16 + 15 * (n >> 4), 16 + 15 * (n & 15))
            c.setFillColorRGB(*(v / 255 for v in rgb))
            c.rect(w * 27 / 32, h * 27 / 32, w / 16, h / 16, stroke=0, fill=1)
            c.showPage()
        c.save()
        print(f"{path.name:8} {pages:3} pages  {path.stat().st_size:8} bytes  "
              f"{hashlib.sha256(path.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("outputdir", nargs="?", type=Path, default=DEFAULT_OUT)
    generate(parser.parse_args().outputdir)
