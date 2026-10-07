import json
s=next(s for s in json.load(open(r'output\geology-research-vertical\data\template_xlt-direct-xlrd.json',encoding='utf-8-sig'))['sheets'] if s['name']=='样品')
for c in s['cells']:
 if c['value']=='H97' or c['address'] in ['A1','A2','A3','A99']:print(c)
ids=[x['value'] for x in s['cells'] if x['address'].startswith('A') and x['address']!='A1' and x['type_name']=='text']
print('len',len(ids),'last',ids[-3:],'containsH97','H97' in ids)
print('span',min(int(x[1:]) for x in ids if x.startswith('H')),max(int(x[1:]) for x in ids if x.startswith('H')))
