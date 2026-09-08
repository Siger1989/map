"""Build the reviewed September 8 release digest. Requires reportlab and a Chinese TTF.
Run from the repository root; --font permits another platform's Chinese font.
"""
from pathlib import Path
import argparse
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle

parser=argparse.ArgumentParser()
parser.add_argument('--font',default='C:/Windows/Fonts/simhei.ttf')
parser.add_argument('--output',default='output/pdf/山兔-2026-09-08-版本更新.pdf')
args=parser.parse_args()
pdfmetrics.registerFont(TTFont('CN',args.font))
out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
c=canvas.Canvas(str(out),pagesize=A4)
c.setTitle('山兔 | 2026年9月8日版本更新');c.setAuthor('山兔项目')
W,H=A4; ink=colors.HexColor('#203B42'); muted=colors.HexColor('#566D73'); accent=colors.HexColor('#177D79'); pale=colors.HexColor('#EAF3F0'); margin=38; y=0
body=ParagraphStyle('body',fontName='CN',fontSize=10.5,leading=17,textColor=ink,spaceAfter=7,wordWrap='CJK')
small=ParagraphStyle('small',parent=body,fontSize=9,leading=14,textColor=muted)
page_num=0
def para(text,style=body,x=margin,width=None,gap=8):
    global y
    p=Paragraph(text,style);w,h=p.wrap(width or W-2*margin,H)
    if y-h<49:raise ValueError(f'Page {page_num} overflow: {text[:50]}')
    p.drawOn(c,x,y-h);y-=h+gap
def start(title,kicker):
    global y,page_num
    page_num+=1;c.setFillColor(pale);c.rect(0,H-11,W,11,fill=1,stroke=0)
    c.setFillColor(accent);c.setFont('CN',9);c.drawString(margin,H-39,'山兔  /  2026.09.08')
    c.setFillColor(ink);c.setFont('CN',23);c.drawString(margin,H-77,title)
    y=H-101;para(kicker,small,gap=17)
def heading(text):
    global y
    c.setFillColor(accent);c.setFont('CN',14);c.drawString(margin,y-15,text);y-=27
def bullet(title,text):para(f'<b>{escape(title)}</b>　{escape(text)}')
def table(rows,widths):
    global y
    cells=[[Paragraph(escape(str(v)),small) for v in row] for row in rows]
    t=Table(cells,colWidths=widths,hAlign='LEFT');t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),pale),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LINEBELOW',(0,0),(-1,-1),.4,colors.HexColor('#CDDCD8'))]))
    _,h=t.wrap(W-2*margin,H)
    if y-h<49:raise ValueError('Table overflow')
    t.drawOn(c,margin,y-h);y-=h+16
def end():
    c.setStrokeColor(colors.HexColor('#D5E1DE'));c.line(margin,37,W-margin,37)
    c.setFillColor(muted);c.setFont('CN',8);c.drawString(margin,23,'逐版本变更 · 测试版 · 时间统一为北京时间');c.drawRightString(W-margin,23,f'{page_num:02d} / 07');c.showPage()

start('一天的版本，一份清晰记录','范围：0.2.6–0.2.11。按版本归纳具体功能、修复与安装差异；内部构建与公开发行分开记录。')
heading('版本时间线')
table([['版本','状态 / 当天时间','主要变化'],['0.2.6','公开 · 01:41','选中直接续画；自动存档；记录快照去重'],['0.2.7','公开 · 08:40','已保存轨迹、收藏路线直接进入导航'],['0.2.8','内部构建 → 合入0.2.9','室内网络定位；扫码取景与镜头选择；覆盖层去重'],['0.2.9','公开 · 13:19','气温、多剖面、起点接入、路线图/二维码分享'],['0.2.10','内部构建 → 合入0.2.11','属性标记、省市收藏、区域/轮廓模型、剖面地图导出'],['0.2.11','本次交付','照片路线ZIP、沿线标记、免费图源、紧凑批选、Excel与中文地名']], [66,151,W-2*margin-217])
heading('现在最值得尝试的三条流程')
bullet('标记与整理','中心准星 → 右侧标记 → 选择类型 → 图标、名称、位置与属性 → 收藏按省市管理。')
bullet('批量分享','右侧框选完整对象，或收藏多选/省市全选/滑动连选 → 导出 ZIP；Excel适合整理属性，JSON适合恢复数据。')
bullet('路线与照片','选择轨迹 → 点击线段出现绿点 → 添加行程标记；路线详情查看照片，整条路线打包地图、照片与GPS文件。')
para('0.2.8、0.2.10未单独公开。历史版本的操作入口以当时为准；后续版本已调整的行为在后文注明。',small)
end()

start('0.2.6 / 0.2.7','早间版本：把画线、续画、保存与导航连接起来。')
heading('0.2.6　画线流程与刷新修复')
bullet('继续当前轨迹','选中一条路线后，顶部“继续绘制”直接定位其末端；只有未选中时才展开选择列表。')
bullet('新建与完成','新建优先；完成自动保存。新建/切换前保留有效草稿，名称包含时间与起点附近位置。')
bullet('吸附绘制','固定逐点连线，道路与节点吸附默认开启；按距离匹配已显示道路，去掉12级缩放门槛。缺少道路数据时仍需放大。')
bullet('保护实走记录','实走或含时间的轨迹通过手绘副本修改，原始GPS点、时间与海拔不改。')
bullet('界面整合','独立画线入口、地点搜索、图源逐级返回；剖面收进工具，保留绿色视角控制器和对象旋转/归正。')
bullet('减少重复刷新','原生记录每1.5秒返回相同快照时，不再重复解析、提交轨迹与定位；有新点和状态变化仍及时更新。')
para('验证记录：类型、233项逻辑与网页/APK构建通过；静止场景未复现用户手机闪烁，因此没有“彻底修复”的结论。',small)
heading('0.2.7　保存的线路可以导航')
bullet('轨迹导航入口','手绘列表和已选轨迹增加导航按钮；沿保存线形指引，不擅自改成另一条道路。')
bullet('收藏也能导航','规划路线保留出行方式、途经点和转向步骤；切换路线后使用新选中的线路。')
bullet('没有转向数据时','提供沿线进度和剩余距离，不虚构路口转向。要求线路连续、长度至少20米。')
para('当时手绘轨迹默认步行；0.2.9起改为导航前选择驾车、骑行或步行。0.2.7记录236项逻辑、360/390布局与路线切换验证通过。',small)
end()

start('0.2.8 / 0.2.9','中午版本：补定位、气温、路线接入与可扫码的完整分享图。')
heading('0.2.8　内部构建，随后并入0.2.9')
bullet('室内网络定位','调用Android系统基站/Wi-Fi定位，显示来源和估计误差；与实走记录服务分开，不降低录制门槛。')
bullet('扫码取景','完整显示相机画面，增加镜头选择与重试；在设备支持时复位缩放、连续对焦，处理权限与后台返回。')
bullet('地图刷新','重复覆盖数据不提交，避免反复调层序；位置小幅漂移不持续推动镜头。电脑静止验证不能替代手机验收。')
bullet('录制前选样式','实走开始前可以选择线色和宽度；旧轨迹与备份格式保持兼容。')
heading('0.2.9　公开版本')
bullet('气温颜色图层','显示当前区域2米气温预报、时间与℃色标；图例缩为约60px高，颜色加深。空白区域表示无数据。')
bullet('多个剖面','可新建、独立命名、移动、显隐、删除/撤销；地图同时显示，保存测点按剖面隔离。')
bullet('规划按钮','只有起终点文字、未确定坐标时给出明确反馈，解决灰色按钮无说明。')
bullet('接到路线起点','先选择驾车/骑行/步行；人在起点之外时，以相同模式规划接入段，再继续主体线路。')
bullet('完整路线图','导出全线地图、地名、起终点名称与坐标、里程统计及真实DEM海拔变化图。')
bullet('分享方式','图片、GPX、KML和常规导航链接均可用；分享图上有离线二维码，相机或相册均能识别。')
bullet('二维码容量','过长线形可逐级把曲线概括为直线，保留起终点、途经点并标注简化程度。完整图片与GPX/KML保持精度。')
para('0.2.9最终追加记录260项逻辑通过。0.2.8没有独立公开下载交付，功能随0.2.9提供。',small)
end()

start('0.2.10','内部版本，全部并入本次0.2.11；以标记、模型、区域和剖面为主。')
bullet('扫码先看轨迹','扫码载入后打开信息与海拔，不自动进入导航；需要导航时再主动选择出行方式。')
bullet('标记信息编辑','点位进入编辑栏，图标优先：18个简单图标、名称、自定义属性和多行值。字段可增删并记住下次使用，支持真正的XLSX。')
bullet('统一收藏','标记、模型、区域、剖面、轨迹与规划路线统一管理；按省市归类，可手动修正地区。')
bullet('剖面图片','剖面图下方加入真实俯视地图，显示边框、A–D角点、采样点及精确坐标表；超长列表分图保存。')
bullet('划区域','复用路线道路吸附，轮廓闭合成区域，显示面积；地图节点可以调整。')
bullet('自定义模型','绘制凹凸轮廓后拉伸为模型，继续使用普通几何体的位置、尺寸、旋转与外观操作。')
bullet('地下与地形交界','地下模式默认局部裁切，可关闭；被遮挡的模型半透明可见，交界和侧壁亮色提示。使用真实DEM网格近似，非CAD实体布尔。')
bullet('轨迹点拖动','点击选中节点出现圆圈，随后直接拖动；有原始时间的记录仍通过副本编辑。')
bullet('地图标签定位','修正更新标记时覆盖地图定位类导致名称与实际位置偏离的问题。')
bullet('地质与手机UI','恢复地质图例及世界/地质云入口；地质云需授权。收窄规划、区域和轨迹编辑浮窗，避开右下摇杆。')
para('验证记录：275项逻辑、类型、网页/Android构建；真实扫码载入、剖面JPEG、Excel独立读取、区域拉伸、地下显示和390/360布局。没有OPPO真机验收。',small)
end()

start('0.2.11 · 轨迹与地图','本次增量（一）：照片、路线打包、沿线标记与可切换的图源。')
bullet('照片出现在路线详情','结束时或结束后追加的照片，选择对应路线后可看到缩略图与照片信息。')
bullet('一条路线一个ZIP','包含带二维码的全程路线图、照片副本、照片Excel清单、GPX/KML及路线JSON。现存清晰照片副本最长边2560px，旧预览单独注明。')
bullet('沿线临时绿点','点击两个节点之间的线段，出现绿色临时点，不改变轨迹。点击“添加行程标记”保存到此线路。')
bullet('行程进度提示','左侧里程条显示已关联的标记，可打开列表并定位编辑；轨迹分享同时包含行程标记。')
bullet('河流吸附','放在画线设置靠后的“更多吸附”，默认关闭；与道路吸附互斥。只沿可识别且连通的河流中心线，不跨越缺失水系。')
bullet('透明度与色阶','轨迹透明度可调0%–90%，保存后保留；海拔颜色在原方案上每50米细分，等高线按高度变化。')
bullet('12个免Key图源','全球5个：OSM、OpenTopoMap、NASA三类底图；美国USGS三类；日本国土地理院四类。保留地域范围、历史时次与署名。')
bullet('切换方式','图源面板直接选择，记住上次使用；新公共图源仅在线显示，不加入区域离线预取。NASA夜景为历史底图，不标成实时影像。')
para('真实样本检查：12/12图源HTTP200、图片签名与跨域可用。公共服务可用性仍取决于地区网络；未承诺全球所有免费图源或永久可用。',small)
heading('一眼看懂三种分享')
table([['格式','适合做什么'],['路线图片 + 离线QR','直观看全程；扫码载入概括路线，不包含照片'],['GPX / KML','交换通用点线；完整GPS坐标，GPX保留已有时间/海拔'],['ZIP + JSON + XLSX','完整打包照片、模型参数和属性；JSON用于本应用恢复']], [146,W-2*margin-146])
end()

start('0.2.11 · 标记与批量整理','本次增量（二）：面向上百个标记的紧凑收藏和可靠表格导出。')
bullet('看得清','标签不再因地形遮挡降到20%透明度，使用实底白字和彩色边框；圆角整体缩小，区域输入改浅底深字。')
bullet('选得快','收藏当前列表/城市/省分组全选；沿勾选栏滑动连选，靠近边缘自动滚动；删除前明确列出数量和对象。')
bullet('框选整项','右侧框选已保存对象，连续框选累加；矩形相交的轨迹整条选中，不截断GPS数据。地点上限2000，模型单独保留80个。')
bullet('首屏位置','名称下面直接显示坐标、海拔与国家/省市/区县/乡镇/社区/附近道路，缺失留空；人工地区不自动覆盖。')
bullet('表格可读','从A1开始，地名、经纬度、海拔和自定义属性优先；所有字段合并为列，无值留空，编号前导零保留，文字不作为公式。')
bullet('右侧操作','标记按钮先选地点/模型/区域；只保留一个定位准星，室内模式在定位设置中。标签收进44px按钮内。')
global_top=y
for i,(file,label) in enumerate([('collections-swipe-0211-360.png','收藏滑动连选（独立测试数据）'),('map-box-select-0211-360.png','地图矩形框选，完整对象进入导出')]):
    p=Path('docs/images')/file
    if p.exists():
        iw=130;ih=iw*780/360;x=margin+45+i*255
        c.drawImage(str(p),x,global_top-ih,width=iw,height=ih,mask='auto')
        c.setFont('CN',8);c.setFillColor(muted);c.drawCentredString(x+iw/2,global_top-ih-15,label)
y=global_top-302
end()

start('安装、验证与资料','下载时以同一Release中的APK与SHA256文件为准。保留旧应用中的个人数据。')
table([['平台','本次产物 / 状态'],['Android 8.0及以上','0.2.11-test / code18；独立“山兔测试版”APK。需较新WebView与WebGL2。'],['同签名独立测试版','可覆盖0.2.5/0.2.9等独立系列；包名com.guanyun.weather.shantu.preview。'],['0.2.6 / 0.2.7原系列','不同包名与证书，两套应用并存；数据不自动迁移，按需导出/导入。'],['HarmonyOS 6.1原生','未提供HAP/APP或邀请测试链接。仍缺完整工具链、开发者签名与安装验证。']], [140,W-2*margin-140])
heading('已经验证与仍待验证')
bullet('逻辑与文件','292项逻辑回归及类型检查；120点真实Excel导出，独立解析中文/前导零/空列；整条路线ZIP、QR与照片包已有界面输出检查。')
bullet('手机布局模拟','360×780、390×844；省市全选、拖选自动滚动、框选与导出衔接、缩小圆角、按钮提示边界。浏览器模拟不代表真机触控验收。')
bullet('真机边界','没有连接OPPO X8 Ultra；相机物理镜头、室内精度、静止道路闪烁、导航与系统分享仍需手机验收。网络定位不是楼层/房间定位。')
heading('可追溯资料')
for title,url in [('0.2.11 APK、校验文件与发行说明','https://github.com/Siger1989/map/releases/tag/v0.2.11-test-standalone'),('项目逐次记录与源码','https://github.com/Siger1989/map/blob/main/LOG.md'),('OSM公共瓦片使用规则','https://operations.osmfoundation.org/policies/tiles/'),('Photon名称语言参数','https://github.com/komoot/photon/blob/master/docs/api-v1.md')]:
    para(f'<link href="{url}" color="#177D79">{escape(title)}</link>',small,gap=5)
para('地质云仍需有效授权。模型与地形接触面是DEM网格近似；公共图源的许可、来源与覆盖说明保留。内部草稿的历史说明不代表已公开发行。',small)
end();c.save();print(out.resolve())
