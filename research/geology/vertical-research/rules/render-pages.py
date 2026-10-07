from pathlib import Path
import pypdfium2 as pdfium
src=Path(r'D:\天气地图\地质资料\固体矿产勘查原始地质编录规程.pdf')
out=Path(r'C:\Users\sigeryang\Documents\ChatGPT\天气项目\output\geology-research-vertical\rules')
pdf=pdfium.PdfDocument(src)
for n in [68,76,78,79,84,85]:
 page=pdf[n-1]
 bitmap=page.render(scale=1.8)
 path=out/f'规程-p{n}.png'
 bitmap.to_pil().save(path)
 print(n,page.get_size(),path)
