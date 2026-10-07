from pathlib import Path
from pypdf import PdfReader
import pdfplumber, json, re
sources = [
 Path(r'D:\天气地图\地质资料\固体矿产勘查原始地质编录规程.pdf'),
 Path(r'D:\天气地图\地质资料\最新、最好图例Gb958-99.pdf')
]
out = Path(r'C:\Users\sigeryang\Documents\ChatGPT\天气项目\output\geology-research-vertical\rules')
terms = ['钻孔', '柱状图', '岩心', '采取率', '采收率', '倾角', '方位', '测斜', '真厚', '样品', '终孔', '回次', '孔深', '分层', '化验', '分析']
for src in sources:
    reader = PdfReader(str(src))
    pages = []
    chars = 0
    with pdfplumber.open(str(src)) as pdf:
        for i, page in enumerate(pdf.pages, 1):
            txt = page.extract_text() or ''
            chars += len(txt)
            pages.append({'page':i,'text':txt})
    stem = src.stem
    txtpath = out / (stem + '.txt')
    with txtpath.open('w',encoding='utf-8') as f:
        for p in pages:
            f.write(f"\n\n===== PDF page {p['page']} =====\n")
            f.write(p['text'])
    hits = {term:[p['page'] for p in pages if term in p['text']] for term in terms}
    metadata = {'source':str(src),'page_count':len(reader.pages),'encrypted':reader.is_encrypted,'extracted_chars':chars,'pages_with_text':sum(bool(p['text'].strip()) for p in pages),'keywords':hits,'text_file':str(txtpath)}
    (out/(stem+'-metadata.json')).write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(metadata,ensure_ascii=False))
