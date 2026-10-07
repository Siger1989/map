from pathlib import Path
import re
base=Path(r'C:\Users\sigeryang\Documents\ChatGPT\天气项目\output\geology-research-vertical\rules')
text=(base/'固体矿产勘查原始地质编录规程.txt').read_text(encoding='utf-8')
parts=re.split(r'===== PDF page (\d+) =====',text)
for n,t in zip(parts[1::2],parts[2::2]):
 if 38<=int(n)<=46 or 53<=int(n)<=55 or int(n) in (68,76,78,79,86,88,89):
  print(f'\n--- PAGE {n} ---\n{t[:3200]}')
