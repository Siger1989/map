import json
from pathlib import Path
p=Path(r'output\geology-research-vertical\data\all-workbooks-extract.json')
d=json.loads(p.read_text(encoding='utf-8-sig'))
out=[]
for label,book in d.items():
 out += [f'### {label}']
 for sh in book['sheets']:
  out += [f'## {sh["name"]} {sh["max_row"]}x{sh["max_column"]} merged={sh["merged"]}']
  rows={}
  for c in sh['cells']:
   import re
   m=re.fullmatch(r'([A-Z]+)(\d+)',c['cell']); col,row=m.group(1),int(m.group(2))
   rows.setdefault(row,[]).append((col,c.get('value'),c.get('type')))
  def ci(s):
   n=0
   for x in s:n=n*26+ord(x)-64
   return n
  for r,cs in sorted(rows.items()):
   items=' | '.join(f'{col}={str(v).replace(chr(10)," ")[:100]}' for col,v,t in sorted(cs,key=lambda x:ci(x[0])))
   out.append(f'{r}: {items}')
  if sh.get('row_heights'):out.append('row_heights='+str(sh['row_heights']))
  if sh.get('column_widths'):out.append('column_widths='+str(sh['column_widths']))
  out.append('')
Path(r'output\geology-research-vertical\data\row-dumps.txt').write_text('\n'.join(out),encoding='utf-8')
