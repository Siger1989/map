$ErrorActionPreference='Stop'
$src='D:\天气地图\地质资料\测试\ZK2303-1回次表+分层+采样(1).xls'
$out='C:\Users\sigeryang\Documents\ChatGPT\天气项目\output\geology-research-vertical\data\source-xls-extract.json'
$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false; $excel.DisplayAlerts=$false
$wb=$excel.Workbooks.Open($src,0,$true)
try {
 $sheets=@()
 foreach($ws in $wb.Worksheets){
  $ur=$ws.UsedRange; $vals=$ur.Value2; $forms=$ur.Formula; $texts=$ur.Text; $cells=@()
  for($r=1;$r -le $ur.Rows.Count;$r++){for($c=1;$c -le $ur.Columns.Count;$c++){
   $v=$vals[$r,$c]; $f=$forms[$r,$c]; $t=$texts[$r,$c]
   if(($null -ne $v -and "$v" -ne '') -or ($null -ne $f -and "$f" -ne '')){
    $cell=$ur.Cells.Item($r,$c); $cells += [ordered]@{cell=$cell.Address($false,$false);value=$v;formula=$f;display=$t}
   }
  }}
  $sheets += [ordered]@{name=$ws.Name;usedRange=$ur.Address($false,$false);rows=$ur.Rows.Count;columns=$ur.Columns.Count;cells=$cells}
 }
 [ordered]@{source=$src;worksheets=$sheets} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $out -Encoding utf8
} finally { $wb.Close($false); $excel.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
