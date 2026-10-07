import json
p=json.load(open(r'output\geology-research-vertical\data\template_xlt-direct-xlrd.json',encoding='utf-8-sig'))
s=next(s for s in p['sheets'] if s['name']=='分层')
d={c['address']:c for c in s['cells']}
print('G nonempty',[(r,d.get(f'G{r}',{}).get('value')) for r in range(2,25) if f'G{r}' in d])
for r in range(2,25):
 if f'H{r}' in d:print(r,d[f'H{r}']['value'])
s=next(s for s in p['sheets'] if s['name']=='样品'); ids=[c['value'] for c in s['cells'] if c['address'].startswith('A') and c['address']!='A1']
print('samples',len(ids),'H97 row',[c['row'] for c in s['cells'] if c['value']=='H97'])
