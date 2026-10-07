import json
p=json.load(open(r'output\geology-research-vertical\data\template_xlt-direct-xlrd.json',encoding='utf-8-sig'))
s=next(s for s in p['sheets'] if s['name']=='样品')
for c in s['cells']:
 if 43 <= c['row'] <= 50:
  print(c['address'],c['value'])
