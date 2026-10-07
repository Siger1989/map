from pathlib import Path
import pypdfium2 as pdfium
src=Path(r'D:\天气地图\地质资料\固体矿产勘查原始地质编录规程.pdf'); out=Path(r'C:\Users\sigeryang\Documents\ChatGPT\天气项目\output\geology-research-vertical\rules')
pdf=pdfium.PdfDocument(src)
for n in [74]:
 page=pdf[n-1]; page.render(scale=2.0).to_pil().save(out/f'规程-p{n}.png')
