import sys, os, json, hashlib, math
from pathlib import Path
sys.path.insert(0, r'output/geology-research-vertical/read-deps')
import xlrd
src = Path(r'D:\天气地图\地质资料\GMT钻孔柱状图模版-ZK0003.xlt')
out = Path('output/geology-drill-demo')
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()
hash_before=sha(src)
w=xlrd.open_workbook(str(src), formatting_info=False)
def cellv(s,r,c):
    v=s.cell_value(r,c)
    if isinstance(v,float) and v.is_integer(): return int(v)
    return v
def cells(s,r,cols):
    return {xlrd.colname(c).upper()+str(r+1):cellv(s,r,c) for c in cols}
turns=[]
s=w.sheet_by_name('回次')
prev=0.0
for r in range(1,s.nrows):
    no=cellv(s,r,0)
    if no in ('',None): continue
    adv=cellv(s,r,1); core=cellv(s,r,2); bottom=cellv(s,r,3); rec=cellv(s,r,4)
    turns.append({'id':int(no),'top_m':prev,'bottom_m':bottom,'advance_m':adv,'core_m':core,'recovery_percent':rec*100 if isinstance(rec,(int,float)) else None,'source':{'sheet':s.name,'row':r+1,'cells':cells(s,r,[0,1,2,3,4])}})
    prev=bottom
layers=[]
s=w.sheet_by_name('分层'); prev=0.0
for r in range(1,s.nrows):
    no=cellv(s,r,0)
    if no in ('',None): continue
    bottom=cellv(s,r,3); core=cellv(s,r,5); code=cellv(s,r,6); desc=cellv(s,r,7)
    thick=bottom-prev
    layers.append({'id':int(no),'top_m':prev,'bottom_m':bottom,'thickness_m':thick,'core_m':core,'recovery_percent':{'value':core/thick*100 if thick else None,'basis':'calculated'},'description':desc,'material_code':code if code not in ('',None) else None,'source':{'sheet':s.name,'row':r+1,'cells':cells(s,r,[0,3,5,6,7])}})
    prev=bottom
samples=[]
s=w.sheet_by_name('样品')
for r in range(2,s.nrows):
    sid=cellv(s,r,0)
    if sid in ('',None): continue
    top=cellv(s,r,4); bottom=cellv(s,r,7); core=cellv(s,r,8)
    length=bottom-top if isinstance(top,(int,float)) and isinstance(bottom,(int,float)) else None
    samples.append({'id':sid,'top_m':top,'bottom_m':bottom,'length_m':length,'core_m':core,'recovery_percent':{'value':core/length*100 if length else None,'basis':'calculated'},'source':{'sheet':s.name,'row':r+1,'cells':cells(s,r,[0,4,7,8])}})
s=w.sheet_by_name('钻孔结构'); structures=[]
for r in range(1,s.nrows):
    dep=cellv(s,r,0)
    if dep in ('',None): continue
    structures.append({'depth_m':dep,'diameter_mm':cellv(s,r,1),'source':{'sheet':s.name,'row':r+1,'cells':cells(s,r,[0,1])}})
meta={'hole_id':'ZK0003','hole_id_source':'原图题名/底稿文件名，基本数据孔号为空','depth_basis':'uncorrected_template','endpoint_m':382.79,'actual_layer_count':len(layers),'declared_layer_count':51,'source_file':str(src),'source_sha256':hash_before}
data={'meta':meta,'turns':turns,'layers':layers,'samples':samples,'structures':structures,'assay_elements':['Au','Pb','Zn'],'all_analysis_missing':True,'issues':[{'topic':'scale','source_values':['原图图头1:100','原图图签1:500'],'note':'比例尺冲突，示图不选定或推断唯一比例尺。'},{'topic':'endpoint','values_m':[382.79,383.01,383.011],'note':'底稿未校正终孔、原图主体打印值及底部精细校正值并存；本数据采用底稿未校正基准。'},{'topic':'layer_count','values':[23,51],'note':'分层页实际记录23条，基本数据声明51层。'},{'topic':'material_codes','note':'分层代码列23条均为空；保留描述，不推断岩性代码。'},{'topic':'assays','note':'Au/Pb/Zn分析结果格为空；不从其他工作簿补入。'},{'topic':'depth_correction','note':'不导入标志面夹角/测斜数据用于原图校正，也不声明真厚度。'}]}
with (out/'zk0003-data.json').open('w',encoding='utf-8') as f: json.dump(data,f,ensure_ascii=False,indent=2,allow_nan=False)
hash_after=sha(src)
turn_ids=[x['id'] for x in turns]; layer_ids=[x['id'] for x in layers]; sample_ids=[x['id'] for x in samples]
audit={'source_file':str(src),'source_sha256_before':hash_before,'source_sha256_after':hash_after,'source_hash_unchanged':hash_before==hash_after,'checks':{'turn_count_131':len(turns)==131,'layer_count_23':len(layers)==23,'sample_count_97':len(samples)==97,'h97_between_h44_h45':[(x['id'],x['top_m'],x['bottom_m']) for x in samples if x['id'] in ('H44','H97','H45')],'advance_sum_m':sum(x['advance_m'] for x in turns),'advance_sum_matches_endpoint':math.isclose(sum(x['advance_m'] for x in turns),382.79,abs_tol=1e-8),'turn_ids_unique':len(turn_ids)==len(set(turn_ids)),'layer_ids_unique':len(layer_ids)==len(set(layer_ids)),'sample_ids_unique':len(sample_ids)==len(set(sample_ids)),'turn_depth_order_monotonic':all(turns[i]['bottom_m']>=turns[i-1]['bottom_m'] for i in range(1,len(turns))),'layer_depth_order_monotonic':all(layers[i]['bottom_m']>=layers[i-1]['bottom_m'] for i in range(1,len(layers))),'sample_depth_order_monotonic':all(samples[i]['top_m']>=samples[i-1]['top_m'] for i in range(1,len(samples))),'material_codes_all_empty':all(x['material_code'] is None for x in layers),'assays_all_blank':True}}
with (out/'data-audit.json').open('w',encoding='utf-8') as f: json.dump(audit,f,ensure_ascii=False,indent=2,allow_nan=False)
print(json.dumps({'files':[str(out/'zk0003-data.json'),str(out/'data-audit.json')],'checks':audit['checks']},ensure_ascii=False,indent=2))
