from pathlib import Path
import re
base=Path(r'C:\Users\sigeryang\Documents\ChatGPT\天气项目\output\geology-research-vertical\rules')
t=(base/'固体矿产勘查原始地质编录规程.txt').read_text(encoding='utf-8'); p=re.split(r'===== PDF page (\d+) =====',t)
sel={81,82,83,84,85,86,87,88,89}
out=[]
for n,x in zip(p[1::2],p[2::2]):
 if int(n) in sel: out.append(f'\n--- PDF PAGE {n} ---\n{x[:3500]}')
(base/'drill-forms.txt').write_text('\n'.join(out),encoding='utf-8')
print('written',len(out))
