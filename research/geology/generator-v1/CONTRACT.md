# 实测剖面生成器 v1 实施契约

2026-10-06 修订：下方岩性区域现已按 `SLOPED_BOUNDARY_CONTRACT.txt` 改为共享视倾层界与近地表解释填充；本文件中原固定竖直编码带条款作为初版记录保留，不再是当前渲染实现。源数据精度、导入及匹配规则继续有效。

目标：仅由导入 Excel、明示设置和固定模板产生导线平面图、实测相对高程剖面及岩性编码带。禁止读取旧 section-data.json、旧 SVG、照片、图签坐标、图像估读结果。旧成果只保留，不改动。

## 文件接口与分工
- importer.py：`load_workbook_data(path, settings=None) -> dict`。settings 默认 axis_azimuth_deg=null（首末点连线方向），origin 为相对 0/0/0；不读取图纸。GeometryInputError 携带 issues；无效几何阻止绘制。
- renderer.py：`render(data, output_dir, config=None) -> dict`，输出 drawing.svg、preview.png（可由父级统一转换）、layout-audit.json；不得读源 Excel 或任何旧成果。返回文件路径。
- templates/materials.json：本版独立项目符号库，精确名称键，未知名称保留待配置；不得复制旧图图案。templates/drawing.json：版式和数值显示规则。
- make_template.mjs：用 bundled artifact-tool 生成规范导入 Excel 模板；必须遵守 spreadsheet skill。输出 outputs/geology-template-v1/实测剖面输入模板.xlsx。脚本可复用。
- 主代理：CLI/PC 本地入口、集成、独立验收、文档。

## JSON v1
根：schema_version='1.0', source={filename,sha256,adapter,sheet}, project={name,section_id}, settings={axis_azimuth_deg,axis_method,coordinate_system:'local_relative',vertical_exaggeration:1}, records,nodes,intervals,stations,attitudes,samples,issues,summary。
所有数量可变，禁止固定 PM01、43、20、26、83.500585 等本例值。
nodes：{index,east_m,north_m,z_m,x_m,offset_m,chainage_m,slant_chainage_m}；长度=记录数+1，初点为0。
records：{id,leg_id,layer_id,length_m,slope_deg,azimuth_deg,dip_direction_deg,dip_angle_deg,lithology_name,description,start_node,end_node,raw,source_cells,computed:{horizontal_m,vertical_m,east_delta_m,north_delta_m}}。
intervals：连续同层构成一层段；{id,layer_id,start_node,end_node,record_ids,lithology_name,description,source_cells}。同编号非连续再次出现不可自动合并。
stations：{id,node,source_cell}。由导线段首尾推导，段号必须可拆为起点-终点且相接；无法拆时用明确自动编号并发警告，不能丢节点。
attitudes：连续同层同产状去重；{id,record_id,layer_id,node,dip_direction_deg,dip_angle_deg,location_basis:'record_start_association'}。node 是行起点的关联位置，不能声称独立测得产状点坐标。
samples：{id,record_id,layer_id,position:null或{east_m,north_m,z_m,x_m,offset_m},location_status:'missing'或'explicit_offset',source_cells}。未提供距离绝不放到图上，只入样品清单。
issues：[{severity:'warning'或'error',code,message,cells:[]}]; summary 包含 records,intervals,stations,samples,located_samples,total_slant_m,total_horizontal_m,total_vertical_m,endpoint_east_m,endpoint_north_m,axis_azimuth_deg,projected_endpoint_m。

## 导入格式
1. 本例旧 XLS 适配器：验证首表表头特征，A:V 为已知登记表列，不可对其他表盲按位置。每有效记录必须有斜距、坡角、方位角、层号；B层号和A导线号在已识别连续测量行中可显式继承且记录来源。P岩性描述的首个“。”前完整词作为名称；空描述仅在相同层段内继承，未知保留。
2. 规范 XLSX：`项目` 表 A1=参数，B1=值；参数 `项目名称`、`剖面编号`、`剖面方位角_deg`（空=首末点连线）、`长度单位`（m）、`角度单位`（deg）。`测段` 表第1行固定名称映射，可换列序。
测段列：记录号,导线段号,层号,起读数_m,止读数_m,斜距_m,坡角_deg,方位角_deg,倾向_deg,倾角_deg,岩性名称,岩性描述,样品编号,样品距测段起点_m,原表平距_m,原表高差_m,原表累计高差_m,原表累计北_m,原表累计东_m,实测真厚度_m。
规范模板不预填虚构业务数据；单独说明页解释字段、角度约定、缺失处理和图案范围。各列为类型正确的输入，提供空白填写行。需要回归测试可另存 synthetic JSON/临时测试文件并标明测试数据。

## 数据与计算规则
D>0；坡角[-90,90]；方位/倾向[0,360)，倾角[0,90]；NaN、无穷和不完整产状拒绝/提示。必需几何字段缺失不能用0补。
G=D*cos(slope)，H=D*sin(slope)，dE=G*sin(az)，dN=G*cos(az)；逐条累加局部E/N/Z，首点相对0。
A=用户显式方位，或 atan2(Eend,Nend)；端点重合不能选默认方向，必须明确设置。X=E*sin(A)+N*cos(A)，O=N*sin(A)-E*cos(A)。轴向反向/回折不得排序、拉直或取绝对值；严重投影重叠阻止岩性投影带并输出明确错误或退化为逐段独立图，不静默改为累计距。
缓存 G/H/I/K/L 与独立计算比较，差异保留单元格原值和残差，不覆盖；容差数值可配置，默认1e-6 m。真实厚度无明确数据则null，不从画宽/纹理厚度/原Q列推断。
数值计算使用未舍入双精度，输出JSON全精度；画面坐标显示3位小数、角度至3位（必要时去尾零），源记录原值保留。

## 规范绘图与精度边界
平面与剖面共用 X；E/N在平面图中刚性旋转，等比例；剖面横纵同尺度，垂直夸大=1。轴名明确投影距离、横向偏距、相对高程。
实际测线用连续线、分层起点用精确节点。上图可画穿过分层起点的短走向符号，其方向由层首倾向±90°计算；图中说明“分层处走向符号按层首产状定向，线长为图式”，不声称已测得接触面延伸范围。
岩性编码带在剖面线下按原分段投影区间裁剪，固定屏幕宽度；必须标为“岩性编码带，带宽不表示厚度，分隔线不代表深部接触面”。避免地下形态推断。不移动/加宽薄层；过窄层引线到索引表显示名称与模板。
所有产状值通过编号/记录表准确保留，关联起点的引线可排版移动；不能把文字位置当实际地质点。样品无位置只列“定位缺失”。真实厚度空白显示未提供。
文字布局按通用包围盒避让；禁止层号特判、手工锚点数组。尺寸自适应数据范围。需实际查看全图及拥挤段 PNG。
每个模板有 id/name/固定SVG图案，不携带产状、厚度或品位。相似岩性绝不模糊合并。图例与填充共享一个定义。声明本版项目符号，未宣称国家标准批准。

## 验收
直接旧XLS导入；规范模板新数据导入；更改测段长度/产状后输出相应改变；未知岩性pending；坏单位、缺几何拒绝；缺样品位置不画假点；不同记录/层/站数量正常；全流程不读取旧成果/图像；同输入输出SVG一致；原XLS SHA不变。

## 本地执行入口
后续由空闲执行代理实现 pipeline.py、server.py、web/index.html、启动剖面工具.cmd、generate.cmd。
pipeline.py --input <xls/xlsx> --output <目录> [--axis <度>] 调用 importer 与 renderer，保存 normalized.json、drawing.svg、preview.png、report.html、manifest.json。不能导入旧 renderer 或复制旧图片。
PNG通过已安装Edge/Chrome headless把新SVG栅格化，临时浏览器profile仅放本工具目录的临时目录，不能触碰用户浏览器资料。PNG保留整个图，使用真实宽高；必要时另出detail.png。PNG是显示产物，SVG是矢量主文件。
manifest记录输入SHA、配置/代码SHA、所有输出清单、绘图范围和精度边界。运行时记录读取的业务文件；明确阻止打开旧section-reproduction、源图像/原图文件，不影响运行库读入。禁止在生成器中把审查baseline当输入。
server仅监听127.0.0.1，默认9187，如被占用给清晰提示；纯stdlib HTTP，上传大小有限，保存basename清洗后的工作簿到本工具uploads，结果存generated/<输入hash+设置hash>。不得执行任意shell或取任意文件路径，不对局域网暴露。
PC页只需文件选择、可选剖面方位、生成按钮、数据/警告摘要、生成的图预览、SVG/PNG/数据审查文件下载。支持XLS登记表与规范XLSX，明确未适配任意Excel。
可在页面加载最近成功生成结果，但不能把旧结果当本次成功；失败后清晰保留当前错误并标明上次结果。中文界面，不展示内部类名堆栈。内部日志到logs。
用户双击CMD启动本地工具/文件拖到generate.cmd均可。路径使用当前目录和明确bundled runtime探测；不得改系统或全局Python。
