import json
from pathlib import Path
for file in ['source_xls-direct-xlrd.json','template_xlt-direct-xlrd.json']:
 obj=json.loads((Path(r'output\geology-research-vertical\data')/file).read_text(encoding='utf-8-sig'))
 print('\n',file,'sha',obj['sha256'])
 for s in obj['sheets']:
  d={x['address']:x for x in s['cells']}
  print('sheet',s['name'])
  if file.startswith('source'):
   bysheet={'回次表':['A1','C52','G52','H52','B4','B50','C4','C50','I47','J47','N4','G4','P4','P13'], '分层-原始记录':['A27','D29','E29','F29','G29','I29','L29'], '分层-地质综合':['A18','F18','G18','K18'], '采样':['A3','N3']}
  else:
   bysheet={'回次':['A2','B2','C2','D2','E2','A7','D7','A132','B132','C132','D132','E132'], '分层':['A2','D2','F2','G2','H2','A24','D24','H24','A25'], '样品':['A3','C3','D3','E3','F3','G3','H3','I3','A4','E4','H4','I4','A99','H99'], '基本数据':['B1','C3','D3','E3','F3','C4','F4','G4']}
  for c in bysheet.get(s['name'],[]):
   x=d.get(c); print(c, x and f"type={x['type_name']} value={x['value']!r}")
  if s['name']=='回次表': print('title/formatted target',[(c['address'],c['value'],c['type_name']) for c in s['cells'] if c['address'] in ('A1','K1')])
  if s['name']=='样品' and file.startswith('template'):
   ids=[x['value'] for x in s['cells'] if x['address'].startswith('A') and x['address']!='A1' and x['type_name']=='text']
   print('sample IDs count',len(ids),'firstlast',ids[:5],ids[-5:],'missing', sorted(set(f'H{i}' for i in range(1,98))-set(ids)))
