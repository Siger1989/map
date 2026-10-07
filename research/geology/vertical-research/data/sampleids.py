import json
x=json.load(open(r'output\geology-research-vertical\data\template_xlt-direct-xlrd.json',encoding='utf-8-sig'))
s=next(s for s in x['sheets'] if s['name']=='样品')
for c in s['cells']:
 if c['address'].startswith('A'): print(c['address'],repr(c['value']),c['type_name'])
