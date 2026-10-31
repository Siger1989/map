# 148：标记信息卡、误触导航与底图纹理更新

用户在147/code154手机反馈：点击标记直接出现“起点/终点”，卡在选中状态，左上标记名称/属性卡片缺失。用户明确不是隐藏界面的锁定。另提供约10级截图并确认是地图底图乱闪。继续不开模拟器、不操作Unreal、不清数据；在147已交付代码上修复并生成148私人测试候选。

## 原因与处理

### 标记信息与导航

- 原生地图上的网页快速导航控件复用了一个`visibility:hidden`的假标记标签来计算按钮位置。标签字体/锚点与真正的WorldWind标记不同，假标签旁的导航按钮可能遮住真实标记；只有导航按钮接收网页点击，于是直接展开起终点。改为独立28px箭头，位于投影地面锚点下方12px，不再使用隐藏标签撑尺寸。网页只发布真正按钮/展开菜单的触控区域；普通标记仍由原生GPU拾取。点击外部、原生触摸、切换选中标记/地图或失焦会关闭菜单。
- 首页把`selectedPose`存在当作隐藏信息卡的条件，但“可以计算位置”不等于“已经打开位置编辑器”。普通pin也可有pose；模型只有在编辑、位置页及对应调整状态满足时才显示gizmo。改为同一个`annotationPositionEditing`条件同时控制gizmo与信息卡互斥，普通点选立即显示名称和详情入口，不需要第二次点击解卡。
- 复核发现定位状态提示还可能盖住名称。选中标记时暂不显示这条次要提示，不清理错误或定位状态；退出选择后按原条件恢复。pin提示文案从“长按模型”改为“长按标记”。

### 自动底图闪烁：确认的源码缺口及验证边界

截图中是Layers图标和“约10级”；`RasterLevelControl.tsx`的固定级别会显示Lock图标及“锁X级”，因此不能把固定层问题直接说成本次根因。

普通自动层发现确定的图标纹理身份膨胀路径：

1. Host在允许地形工作时检查DEM修订，controller原来每次修订都重建所有标记。
2. 普通pin本来由SDK的`CLAMP_TO_GROUND`自动贴地，不需要这个重建；每次重建却又生成全新的64×64 `ArgbImage`。
3. 项目实际使用的WWK 2.1.1把`ArgbImage`对象自身作为ImageSource缓存key；Android工厂也按此key比较。相同图案/颜色的新对象无法复用旧纹理。旧资源留在全局纹理LRU中，容量不足时可挤走可见底图，再由`useAncestorTileTexture`回退较模糊父层。

现在普通pin不随DEM修订重建；真正依赖地面的模型和有效深度钻孔保留刷新。地面采样与刷新共用同一判断，普通pin仍交SDK贴地。相同图案/ARGB颜色或同色圆点共享图像源，独立有界LRU最多128个glyph，约2MiB最大像素工作集；改名称、选中状态、钻孔杆高度不会重建相同图标纹理。不同颜色/图案、图标/圆点模式保持隔离。没有扩大192MiB全局纹理上限，没有关闭8GiB持久浏览缓存。

这修复了确定的不必要分配和纹理身份变化；没有设备缓存用量/录屏的同步证据，不能保证它是手机闪烁的唯一原因，不能把源码检查写成“已无闪烁”。ADB本轮没有设备，手机实际闪烁仍待148同场景验证。

### 固定细节层的独立资源清理缺口

固定细节瓦片退役原先只回收本地位图/图形，没有移除SDK中对应的纹理；还会clear整层再逐个重加剩余瓦片。现在保留每块的ImageSource，使用WWK 2.1.1绘制所持的同一`renderResourceCache`锁，逐个移除退役图形及其纹理；clear/close走同一路径，保留750ms位图延时回收。挂载在锁内复核closed/代次/provider/pending/job，晚回调不能重新挂载。其它基础影像不被清理。此项单独修复，不冒充自动模式闪烁的已证实原因。

## 官方依据与主agent复核

- [WWK 2.1.1 common源码](https://repo.maven.apache.org/maven2/earth/worldwind/worldwind/2.1.1/worldwind-2.1.1-sources.jar)：`commonMain/earth/worldwind/render/image/ArgbImage.kt:28`的`argbImageSource(this) { this }`。
- [WWK 2.1.1 Android源码](https://repo.maven.apache.org/maven2/earth/worldwind/worldwind-android/2.1.1/worldwind-android-2.1.1-sources.jar)：`ArgbImage.android.kt:19-21`按key实现equals/hashCode；`RenderResourceCache.kt:40`低水位默认capacity×0.75；`WorldWindow.kt:301,320`在同一缓存monitor内绘制。
- [MDN pointer-events](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/pointer-events)：父元素pointer-events:none不阻止显式auto的子元素抢到点击。
- [Android触控目标说明](https://support.google.com/accessibility/android/answer/7101858)：扩大触控区域要留意相邻对象重叠；未声称28 CSS px快捷箭头满足Android 48dp无障碍建议。

主agent已重新下载实际2.1.1源码包、核对上述实现，并复核限定文件与关键测试，非仅转述子agent结论。源码包和检查日志只存本机`.openai`。

## 验证

| 检查 | 结果与边界 |
|---|---|
| NativeModelRendererTest / NativeModelTerrainInputTest / NativeRasterDetailRetirementTest | 3组20项PASS，0失败/错误/跳过 |
| 图标图像源 | 100次钻孔高度/选中变化保持同一glyph引用；杆体高度继续更新；不同样式隔离、同色圆点复用、自定义颜色LRU上限检查PASS |
| 地形刷新分类 | 普通pin/未知海拔pin不刷新；有效深度钻孔和四种模型保留；只换图案、无效/未知深度不错误触发钻孔刷新 |
| 固定细节退役 | 生产helper路径的单块/全部退役、保留base、晚回调不挂载PASS；不是实机GPU采样 |
| 4个相关Node文件 | 32项PASS，0失败/跳过 |
| 私人React148与TSC | PASS；APK最终完整性见148核验JSON |
| 共享首页UI，390×857 / 360×780 | 6组真实组件流程PASS：有海拔pin、未知海拔pin、模型，一次点击出现名称卡→详情→返回→再次选择→完成取消；名称中心实际elementFromPoint不被定位提示遮挡 |
| 信息卡/详情实际边界 | 名称卡x8/y52/w276/h93；pin详情x8/y56/w220/h324或363，模型摘要h86；两尺寸关键控件均可达 |
| 原生导航网页叠层独立组件，两尺寸 | 实际computed矩形与锚点分离，普通锚点点击不展开，明确箭头展开起终点，外部/原生touch事件关闭，start/end回调PASS |
| 原生手机点击、主双图/倾斜/密集重叠/IME及地图是否停止闪烁 | 未验证；浏览器地图和模拟锚点都不能代替原生/真机验收 |

日志：`.openai/private148-{native-tests,node-tests,typescript-final,react-build,optimized-build}-20261031.log`、`marker148-home-qa-final.log`、`marker148-navigation-qa.log`。截图在`artifacts/screenshots/marker148-*.png`，使用独立浏览器合成数据，没有改用户存档；地图请求隔离，画面不是实景影像验收。

代表性证据：[390名称卡](../../artifacts/screenshots/marker148-summary-pin-known-390.png)、[360属性编辑](../../artifacts/screenshots/marker148-detail-pin-known-360.png)、[360模型名称卡](../../artifacts/screenshots/marker148-summary-box-known-360.png)、[导航DOM独立组件](../../artifacts/screenshots/marker148-navigation-390.png)。[六组边界与流程记录](verification-148-ui-20261031.json)可跨电脑查阅；这些是共享React/独立DOM证据，不是手机截图。

## 手机下一步

用148原签名覆盖安装。在截图同位置、同图源、自动级别下停手观察自然加载，检查是否还在清晰/模糊间循环；再点标记主体查看左上名称→详情→返回/完成，单独点箭头查看起终点。分别记录147/148是否抖动、是否仅首次加载、是否与拖图/地形到达同步。如仍闪，下一轮需采同帧可见底图纹理与父层回退、缓存用量/容量、DEM修订及glyph分配；不再凭截图推定缓存容量，也不使用真实源并发压测。
