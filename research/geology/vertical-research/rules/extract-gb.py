from pathlib import Path
from pypdf import PdfReader
src=Path(r'D:\天气地图\地质资料\最新、最好图例Gb958-99.pdf')
out=Path(r'C:\Users\sigeryang\Documents\ChatGPT\天气项目\output\geology-research-vertical\rules')
r=PdfReader(str(src)); hits={}; terms=['钻孔','柱状图','岩心','采取率','采收率','倾角','方位','测斜','真厚','样品','终孔','回次','孔深','分层','化验','分析']
txtpath=out/(src.stem+'.txt')
with txtpath.open('w',encoding='utf-8') as f:
 for i,page in enumerate(r.pages,1):
  t=page.extract_text() or ''
  f.write(f'\n\n===== PDF page {i} =====\n{t}')
  for term in terms:
   if term in t: hits.setdefault(term,[]).append(i)
meta={'source':str(src),'page_count':len(r.pages),'encrypted':r.is_encrypted,'extracted_chars':sum(len(p.extract_text() or '') for p in r.pages),'pages_with_text':sum(bool((p.extract_text() or '').strip()) for p in r.pages),'keywords':hits,'text_file':str(txtpath)}
(out/(src.stem+'-metadata.json')).write_text(__import__('json').dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
print(__import__('json').dumps(meta,ensure_ascii=False))
