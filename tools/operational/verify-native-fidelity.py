"""Compare actual native Master/filled PDF geometry and immutable image content, without normalizing either PDF."""
import collections
import hashlib
import json
from pathlib import Path

import fitz
from PIL import Image

root = Path('.local/workbook-binding-fidelity')
evidence, thumbnails = [], []
for sheet in range(1, 7):
    master = fitz.open(root / f'master-sheet-{sheet}.pdf')
    filled = fitz.open(root / f'filled-sheet-{sheet}.pdf')
    assert len(master) == len(filled)
    for index, (a, b) in enumerate(zip(master, filled)):
        assert a.rect == b.rect, (sheet, index, 'media box changed')
        # Compare table borders separately: Excel coalesces adjacent background fills differently after text changes.
        def geometry(page):
            # Text insertion changes PDF operator sequence numbers, without moving a path.
            return [{k: v for k, v in draw.items() if k != 'seqno'} for draw in page.get_drawings() if draw['type'] != 'f']
        assert geometry(a) == geometry(b), (sheet, index, 'table border geometry changed')
        def images(doc, page):
            return sorted((hashlib.sha256(doc.extract_image(x[0])['image']).hexdigest(),
                           tuple(tuple(r) for r in page.get_image_rects(x[0]))) for x in page.get_images())
        assert images(master, a) == images(filled, b), (sheet, index, 'raster content/anchor changed')
        def text(page):
            return collections.Counter((span['text'], span['font'], round(span['size'], 3),
                                        tuple(round(n, 2) for n in span['bbox']))
                                       for block in page.get_text('dict')['blocks'] if 'lines' in block
                                       for line in block['lines'] for span in line['spans'])
        shared = sum((text(a) & text(b)).values())
        assert shared > 0, (sheet, index, 'static text anchors missing')
        evidence.append(dict(sheet=sheet, page=index+1, width=a.rect.width, height=a.rect.height,
                             tableBorderPathsIdentical=True, imagesAndAnchorsIdentical=True,
                             fillGrouping='Excel may coalesce adjacent fill rectangles; source styles verified separately',
                             unchangedTextSpansWithSameFontSizePosition=shared))
        for label, page in [('master', a), ('filled', b)]:
            pix = page.get_pixmap(matrix=fitz.Matrix(.7, .7), alpha=False)
            image = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
            image.thumbnail((350, 495))
            thumbnails.append(image)
            pix.save(root / f'{label}-{sheet}-page-{index+1}.png')
    master.close()
    filled.close()
canvas = Image.new('RGB', (1400, ((len(thumbnails)+3)//4)*500), '#cccccc')
for i, thumb in enumerate(thumbnails):
    canvas.paste(thumb, ((i % 4)*350, (i//4)*500))
canvas.save(root / 'native-master-filled-contact.png')
(root / 'native-fidelity-evidence.json').write_text(json.dumps(dict(
    pages=evidence, method='Unscaled native PDF geometry, image and common-text comparison',
    ownerVisualAcceptance='NOT_RUN'), indent=2), encoding='utf8')
print(json.dumps(dict(pages=len(evidence), tableBordersAndImages='PASS', output=str(root))))
