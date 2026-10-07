from pathlib import Path
import re
base=Path(r'C:\Users\sigeryang\Documents\ChatGPT\天气项目\output\geology-research-vertical\rules')
for filename, pageset in [('固体矿产勘查原始地质编录规程.txt',set(range(42,46))|{53,54,55,68,76,78,79,86,88,89}),('最新、最好图例Gb958-99.txt',{18,19,20,24,97,100,101,102,143})]:
 text=(base/filename).read_text(encoding='utf-8'); parts=re.split(r'===== PDF page (\d+) =====',text)
 out=[]
 for n,t in zip(parts[1::2],parts[2::2]):
  if int(n) in pageset: out.append(f'\n--- PAGE {n} ---\n{t[:4000]}')
 (base/(filename.replace('.txt','-selected-pages.txt'))).write_text('\n'.join(out),encoding='utf-8')
 print(filename,'selected written',len(out))
