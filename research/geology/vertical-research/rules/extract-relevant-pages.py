from pathlib import Path
import re
base=Path(r'C:\Users\sigeryang\Documents\ChatGPT\天气项目\output\geology-research-vertical\rules')
for name, wanted in [('固体矿产勘查原始地质编录规程.txt',[4,17,18,19,39,40,41,42,43,44,45,53,54,55,69,74,86,88,89]),('最新、最好图例Gb958-99.txt',[18,19,20,24,97,100,101,102,143,154])]:
 text=(base/name).read_text(encoding='utf-8')
 parts=re.split(r'===== PDF page (\d+) =====',text)
 print('\n###',name)
 for n,t in zip(parts[1::2],parts[2::2]):
  if int(n) in wanted:
   print(f'\n--- PAGE {n} ---\n{t[:4500]}')
