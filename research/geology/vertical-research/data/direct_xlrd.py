import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(r'output\geology-research-vertical\read-deps').resolve()))
import xlrd
root=Path(r'D:\天气地图\地质资料')
paths={'source_xls':root/'测试'/'ZK2303-1回次表+分层+采样(1).xls','template_xlt':root/'GMT钻孔柱状图模版-ZK0003.xlt'}
out=Path(r'output\geology-research-vertical\data')
for label,path in paths.items():
 raw=path.read_bytes(); book=xlrd.open_workbook(file_contents=raw,formatting_info=True,on_demand=False)
 obj={'file':str(path),'sha256':hashlib.sha256(raw).hexdigest(),'sheet_names':book.sheet_names(),'sheets':[]}
 for sh in book.sheets():
  cells=[]
  for r in range(sh.nrows):
   for c in range(sh.ncols):
    cell=sh.cell(r,c)
    if cell.ctype != xlrd.XL_CELL_EMPTY and cell.ctype != xlrd.XL_CELL_BLANK:
     cells.append({'row':r+1,'col':c+1,'address':xlrd.formula.cellname(r,c),'ctype':cell.ctype,'type_name':{0:'empty',1:'text',2:'number',3:'date',4:'boolean',5:'error',6:'blank'}.get(cell.ctype,'unknown'),'value':cell.value})
  obj['sheets'].append({'name':sh.name,'nrows':sh.nrows,'ncols':sh.ncols,'cells':cells})
 (out/f'{label}-direct-xlrd.json').write_text(json.dumps(obj,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
 print(label, 'sheets',[(s['name'],s['nrows'],s['ncols'],len(s['cells'])) for s in obj['sheets']])
