"""Verify native PDF fills and unchanged border/image/static-text geometry; render all changed views."""
import collections
import hashlib
import json
import sys
from pathlib import Path
import fitz
from PIL import Image

root=Path(sys.argv[1])
results=[]
thumbnails=[]
colors=[(255,199,206),(221,235,247),(231,230,230)]
for sheet,color in enumerate(colors,1):
    a=fitz.open(root/f'master-{sheet}.pdf')
    b=fitz.open(root/f'generated-{sheet}.pdf')
    assert len(a)==len(b)==2
    for index,(original,generated) in enumerate(zip(a,b)):
        assert original.rect==generated.rect
        borders=lambda p:[{k:v for k,v in d.items() if k!='seqno'} for d in p.get_drawings() if d['type']!='f']
        assert borders(original)==borders(generated),(sheet,index,'borders')
        images=lambda doc,p:sorted((hashlib.sha256(doc.extract_image(x[0])['image']).hexdigest(),tuple(tuple(r) for r in p.get_image_rects(x[0]))) for x in p.get_images())
        assert images(a,original)==images(b,generated),(sheet,index,'images')
        def text(p):
            return collections.Counter((s['text'],s['font'],round(s['size'],3),tuple(round(n,2) for n in s['bbox'])) for block in p.get_text('dict')['blocks'] if 'lines' in block for line in block['lines'] for s in line['spans'])
        assert not text(original)-text(generated),(sheet,index,'original text changed')
        fills=[d for d in generated.get_drawings() if d['fill'] and all(abs(d['fill'][i]-color[i]/255)<.002 for i in range(3))]
        assert bool(fills)==(index==0),(sheet,index,'control fill missing or wrong page')
        pix=generated.get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False)
        pix.save(root/f'generated-{sheet}-page-{index+1}.png')
        if index==0:
            image=Image.frombytes('RGB',(pix.width,pix.height),pix.samples);image.thumbnail((595,842));thumbnails.append(image)
        results.append(dict(sheet=sheet,page=index+1,bordersImagesAndStaticTextUnchanged=True,controlFillRectangles=len(fills),rgb=color))
canvas=Image.new('RGB',(595*3,842),'white')
for i,image in enumerate(thumbnails):canvas.paste(image,(595*i,0))
canvas.save(root/'controls-contact.png')
(root/'visual-evidence.json').write_text(json.dumps(results,indent=2))
print(json.dumps(dict(nativePages=6,controlColors='PASS',geometry='PASS',output=str(root))))
