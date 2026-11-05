> 最终以[172交付记录](../release-0.2.172.md)为准。171功能验证通过但羽化视觉FAIL未交付；172移除羽化集成，保留功能修复和悬浮导航，已完成两尺寸实装验证。下表保留施工阶段状态，不代表最终包结果。

# 独立包基础悬浮导航与171修复

## 已确认目标

2026-11-06用户要求先完成功能优化并交付APK，UI总览/整体配色改造延后。在既有隔离老引擎工程增加切换到其他App仍可显示的小导航。深黑绿、荧绿路线参考用户图1；实际道路、建筑轮廓、路线和定位参考图2。正式包和原始数据、166/167/168/169/170历史包保持。

## 功能清单

- 真实活动导航路线进入小窗，北向固定和可信移动方向朝上两种模式。
- 原生定位前台服务、系统悬浮窗权限、拖动、返回山兔、关闭小窗；关闭小窗不结束主导航。
- OpenFreeMap实际道路/水系/建筑轮廓、路线、定位点/可信方向箭头；无定位或无可信方向如实提示。
- 地图与路线共用Web Mercator坐标，后台Canvas轻量绘制，复用原有MVT原始缓存和请求租约。
- 不绘制参考图中的虚构城市/装饰楼体。基础款为二维地图，不包含后台自动重规划、语音或手表端。
- 同包继续包含169统一选色、170编辑双指/道路河流坐标吸附、真实缓存错误诊断与不同LOD边界GPU混合。

## 施工办法

React在唯一guidance状态上管理悬浮服务，导航卡片只提供入口；切换面板或主Activity进入后台不结束导航。权限由受信本地页面的Activity前台启动流程承接；服务非导出，使用location类型前台通知并持续监听GPS。路线原子写到本应用临时文件，用小Intent传文件路径，不把完整路线塞进Binder，不持久化GPS。结束导航取消待处理的权限启动；销毁停止定位、取消网络任务并释放原始瓦片租约。

地图仅读取当前小窗口可见z14瓦片（通常1–4块，上限9），解析后的几何有固定预算，不建立第二套WorldWind。真实运动方向复用已有NativeMotionHeading；北向地图只旋转定位箭头，行进模式地图旋转一次并令可信运动箭头朝上。停止或方向不足时保留最近可信朝向并提示，不以路线方向冒充。

吸附补发修复：Host原500ms节流窗口直接丢弃调用；现在安排唯一延后publish，避免快速开关后renderFrame snapRevision和geometry payload版本长期不同。继续保留QA对同一revision、真实MVT数据和真实拖动的检查。

## 交付门禁与当前结果

| 项目 | 当前状态 | 证据/限制 |
|---|---|---|
| 独立身份/原签名/旧包 | 待171最终核验 | 仅com.shantu.oldengine；正式166不替换 |
| 171类型检查/31项定向Node | PASS | 本机日志.openai/171-tsc.log、171-node.log |
| 新原生源码真实SDK编译 | PASS | 171-compile-resume.log；后续Host修正仍须最终构建 |
| Kotlin策略/完整optimized APK | 待验证 | 复用源码未变且已核对的四ABI CAD；所有改动Kotlin/React重编 |
| 公共Bing14/19实际下载/落盘/离线读回 | PASS（170） | 每级1个公共研究瓦片，非用户292项全量成功证明 |
| 编辑吸附 | 未通过，继续修复 | 170两次被严格freshness barrier阻止；171补发修正待实装 |
| 悬浮窗权限/跨App/两模式/关闭/主导航 | 待实装验证 | 只读源码/构建不等于可用结果 |
| 390×857、360×780导航和颜色 | 170前者PASS；171待复验 | 独立MuMu，非手机验证 |
| 手机GPS/后台保活/真实行走方向 | 未验证 | 用户暂不能连接真机 |
| UI截图总览 | 已保留55张原始截图 | 按用户最新优先级暂停，非完整窗口清单 |

## 平台与素材依据

悬浮窗口使用Android官方[TYPE_APPLICATION_OVERLAY](https://developer.android.com/reference/android/view/WindowManager.LayoutParams)；定位服务遵循[前台服务类型要求](https://developer.android.com/about/versions/14/changes/fgs-types-required)与[Android15后台启动限制](https://developer.android.com/about/versions/15/behavior-changes-15)，由可见Activity明确点击启动。真实底图使用现有[OpenFreeMap](https://openfreemap.org/)数据链，显示OpenFreeMap、OpenMapTiles、OpenStreetMap署名；既有非商业影像许可限制不变，私人天地图Key不记录、不公开发布。
