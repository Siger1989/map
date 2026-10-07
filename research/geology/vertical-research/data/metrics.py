import json,re,math
p=json.load(open(r'output\geology-research-vertical\data\all-workbooks-extract.json',encoding='utf-8-sig'))
def sh(book,name): return next(s for s in p[book]['sheets'] if s['name']==name)
def v(book,sheet,cell):
 c=next((c for c in sh(book,sheet)['cells'] if c['cell']==cell),None)
 if not c:return None
 return c['cached'] if c['cached'] is not None else c['value']
# rounds
s=sh('回次分层采样','回次表'); rec=[]
for r in range(4,51): rec.append({k:v('回次分层采样','回次表',f'{k}{r}') for k in ['A','B','C','D','E','F','G','H','I','J','N','O','P']})
num=lambda key:[x[key] for x in rec if isinstance(x[key],(int,float))]
print('round count',len(rec),'first,last',rec[0],rec[-1])
print('totals advance,core length,calc recovery',sum(num('C')),sum(num('G')),sum(num('G'))/sum(num('C'))*100)
print('recorded E sum',sum(num('E')),'round recovery range',min(num('H')),max(num('H')),'below0orabove100',[(x['A'],x['H']) for x in rec if isinstance(x['H'],(int,float)) and not(0<=x['H']<=100)])
print('B cumulative mismatch',[(rec[i]['A'],rec[i]['B'],rec[i-1]['B']+rec[i]['C']) for i in range(1,len(rec)) if abs(rec[i]['B']-(rec[i-1]['B']+rec[i]['C']))>1e-8])
print('N vs G mismatches',[(x['A'],x['N'],x['G'],x['P']) for x in rec if isinstance(x['N'],(int,float)) and isinstance(x['G'],(int,float)) and x['N']>x['G']])
print('correction entries',[(x['A'],x['I'],x['J']) for x in rec if x['I'] is not None or x['J'] is not None])
# raw strata
s=sh('回次分层采样','分层-原始记录'); rows=[]
for r in range(3,30): rows.append({k:v('回次分层采样','分层-原始记录',f'{k}{r}') for k in ['A','B','C','D','E','F','G','H','I','J','K','L']})
print('strata count',len(rows),'first',rows[0],'last',rows[-1])
print('strata numeric G sum',sum(x['G'] for x in rows if isinstance(x['G'],(int,float))),'ends',[(x['A'],x['F'],x['G'],x['H'],x['I'],x['L']) for x in rows[:5]])
# template sample and round
for r in [2,3,4,6,7,8,9,10,132]: print('template round',r,[v('柱状图模板','回次',f'{c}{r}') for c in 'ABCDEF'])
for r in [2,3,4,24]: print('template layer',r,[v('柱状图模板','分层',f'{c}{r}') for c in 'ABCDEFGH'])
for r in [3,4]: print('template sample',r,[v('柱状图模板','样品',f'{c}{r}') for c in 'ABCDEFGHI'])
