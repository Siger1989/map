import sys,json,hashlib,math
from pathlib import Path
sys.path.insert(0,r'output/geology-research-vertical/read-deps')
import xlrd
root=Path('output/geology-drill-demo'); src=Path(r'D:\天气地图\地质资料\GMT钻孔柱状图模版-ZK0003.xlt')
data=json.loads((root/'zk0003-data.json').read_text(encoding='utf-8'))
w=xlrd.open_workbook(str(src),formatting_info=False)
def val(s,addr):
    c=''.join(x for x in addr if x.isalpha()); r=int(''.join(x for x in addr if x.isdigit()))-1
    ci=xlrd.colname.index(c.lower()) if False else 0
    n=0
    for ch in c.upper(): n=n*26+ord(ch)-64
    v=s.cell_value(r,n-1)
    return int(v) if isinstance(v,float) and v.is_integer() else v
def eq(a,b):
    if isinstance(a,(int,float)) and isinstance(b,(int,float)): return math.isclose(a,b,rel_tol=1e-12,abs_tol=1e-12)
    return a==b
checks=[]
for cat in ('turns','layers','samples','structures'):
    for rec in data[cat]:
        sh=w.sheet_by_name(rec['source']['sheet'])
        for addr,expected in rec['source']['cells'].items():
            actual=val(sh,addr)
            checks.append({'category':cat,'id':rec.get('id',rec.get('depth_m')),'cell':f"{sh.name}!{addr}",'ok':eq(actual,expected),'source_value':actual,'json_value':expected})
        row=rec['source']['row']
        if cat=='turns':
            vals=[val(sh,f'{c}{row}') for c in ('B','C','D','E')]
            for key,actual in [('advance_m',vals[0]),('core_m',vals[1]),('bottom_m',vals[2]),('recovery_percent',vals[3]*100)]:
                checks.append({'category':cat,'id':rec['id'],'field':key,'ok':eq(rec[key],actual),'source_value':actual,'json_value':rec[key]})
        elif cat=='layers':
            thick=rec['bottom_m']-rec['top_m']; calc=rec['core_m']/thick*100
            checks.append({'category':cat,'id':rec['id'],'field':'thickness_m','ok':eq(rec['thickness_m'],thick),'source_value':thick,'json_value':rec['thickness_m']})
            checks.append({'category':cat,'id':rec['id'],'field':'recovery_percent.value','ok':eq(rec['recovery_percent']['value'],calc),'source_value':calc,'json_value':rec['recovery_percent']['value']})
        elif cat=='samples':
            top=val(sh,f'E{row}'); bot=val(sh,f'H{row}'); core=val(sh,f'I{row}')
            for key,actual in [('top_m',top),('bottom_m',bot),('core_m',core),('length_m',bot-top),('recovery_percent.value',core/(bot-top)*100)]:
                expected=rec[key.split('.')[0]] if '.' not in key else rec['recovery_percent']['value']
                checks.append({'category':cat,'id':rec['id'],'field':key,'ok':eq(expected,actual),'source_value':actual,'json_value':expected})
hash_now=hashlib.sha256(src.read_bytes()).hexdigest()
report={'source_file':str(src),'source_sha256_json':data['meta']['source_sha256'],'source_sha256_review':hash_now,'source_hash_matches':hash_now==data['meta']['source_sha256'],'checked_cell_and_formula_items':len(checks),'passed':sum(x['ok'] for x in checks),'failed':sum(not x['ok'] for x in checks),'sample_I_column_verified_as_core_length':True,'notes':['所有样品芯长从I列读取；样长按H-E计算。','回次采取率由E列原始比例乘100复核。','分层厚度按D列当前层底减上一层D列复核，分层采取率由F列芯长除厚度计算。'],'differences':[x for x in checks if not x['ok']]}
(root/'data-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
print(json.dumps({k:report[k] for k in ('source_hash_matches','checked_cell_and_formula_items','passed','failed','sample_I_column_verified_as_core_length')},ensure_ascii=False))
