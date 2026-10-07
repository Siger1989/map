import json
p=json.load(open(r'output\geology-research-vertical\data\all-workbooks-extract.json',encoding='utf-8-sig'))
for label, shn in [('回次分层采样','回次表'),('回次分层采样','分层-原始记录'),('柱状图模板','基本数据'),('柱状图模板','分层')]:
 s=next(x for x in p[label]['sheets'] if x['name']==shn)
 print('\n',label,shn)
 for c in s['cells']:
  if c['value'] is not None and isinstance(c['value'],str) and c['value'].startswith('='):
   print(c['cell'],c['value'],'CACHE',c['cached'])
