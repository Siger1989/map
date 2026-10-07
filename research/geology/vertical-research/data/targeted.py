import json,re
from pathlib import Path
p=json.load(open(r'output\geology-research-vertical\data\all-workbooks-extract.json',encoding='utf-8-sig'))
for label in ['回次分层采样','分析结果','柱状图模板']:
 print('\n###',label)
 for sh in p[label]['sheets']:
  print('##',sh['name'], 'range',sh['max_row'],sh['max_column'],'merged',sh['merged'])
  d={c['cell']:c['value'] for c in sh['cells']}
  def colnum(col):
   n=0
   for x in col:n=n*26+ord(x)-64
   return n
  rows={}
  for coord,val in d.items():
   m=re.fullmatch(r'([A-Z]+)(\d+)',coord); rows.setdefault(int(m.group(2)),[]).append((colnum(m.group(1)),coord,val))
  for r,vs in sorted(rows.items()):
   if r <= 10 or r >= max(1,sh['max_row']-5) or (label=='柱状图模板' and r<=4):
    print(r,' | '.join(f'{a}={str(v)[:75]}' for _,a,v in sorted(vs)))
