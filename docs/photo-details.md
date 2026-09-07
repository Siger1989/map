# 照片放大、编辑、分享与拍摄环境（0.2.5 待签名源码）

地图照片小预览中的图片可点击放大，进入全屏。双指/滚轮/加减键支持1–6倍缩放，放大后拖动，双击或“适应屏幕”复位。全屏是用户主动查看照片的界面，关闭后恢复地图；小预览仍保持38dvh/320px限制。

“编辑”修改标题、备注，支持90°旋转；“标记”支持红/黄/白三色画线、撤销和清空。保存后重开、重新导入同一张照片均保留编辑。按返回或取消放弃当次未保存编辑。所有操作在本机照片副本上进行，原始相册文件不变。

“分享”先生成可预览的JPEG图片，再点击系统分享或保存图片；可以取消附带信息，仅输出带标记的照片。附带信息包括标题、拍摄时间、估算位置、海拔及来源、天气时次/来源和备注，绘制在图片下方。信息同时保存在本机照片记录中；没有重写相册原图的EXIF。网页用Web Share文件接口，不支持时可下载；新安卓桥用系统ACTION_SEND/CREATE_DOCUMENT。用户自行选择接收者，取消不会自动发送。

## 海拔与天气的含义

- 优先读取照片EXIF GPSAltitude及海平面方向标志；缺失时读取对应轨迹点海拔，同段两分钟内按时间比例估算，显示“轨迹插值估算”。零值和负值有效，没有数据明确显示“海拔未记录”。不从当前地图高度冒充拍摄海拔。
- 新导入照片立即存本机，后台按拍摄位置和时间补天气；旧照片自动补天气，打开预览时可从仍存在的原轨迹补海拔。
- 超过7天的时间查询Open-Meteo ERA5历史再分析，近期用Forecast API的对应日期模型天气。显示非现场实测、最近整点时次与真实获取时间，保存温度℃、风速m/s、天气代码和该整点前一小时累计降水mm。
- 网络失败/缺少该时次/全部值为空不替换成当前天气，也不把缺失温度或降水写成0；“详细信息 → 重新查询拍摄天气”可重试。未来时间或1940年前不查询。最多2个后台请求，每次15秒超时；最多32个按地点/日期缓存，缓存15分钟。
- 图片不上传。天气查询向Open-Meteo发送拍摄坐标与日期；数据来源为Open-Meteo/ERA5或近期模型，CC BY 4.0。山区网格天气不能代表照片所在点的准确实况。

依据：[Open-Meteo历史天气说明](https://open-meteo.com/en/docs/historical-weather-api)、[Forecast日期和变量说明](https://open-meteo.com/en/docs)、[Web Share规范](https://www.w3.org/TR/web-share/)、[Android安全分享文件说明](https://developer.android.com/training/secure-file-sharing)。

## 存储与兼容

新导入保留960px缩略图，另存最长边2560px、JPEG质量0.86、单张至多4MB的查看副本。每次输入照片仍≤20MB；最多200张、预览合计40MB、包含清晰副本合计200MB，配额失败整笔回滚。不是原片无损存档。旧照片只有之前的预览，放大不能恢复丢失细节，重新导入同一原图可升级清晰副本。

IndexedDB名称/版本/主键保持，附加字段均可选。重导入保留标题、备注、旋转、画线；拍摄时间或匹配位置变更时使天气失效重查。后台天气通过事务读取最新对象，只补字段，不覆盖编辑，也不复活被移除的照片。查看副本URL在仅信息更新时保持稳定，防止查天气打断用户缩放。

照片仍独立于普通JSON/GPX备份；删除本机记录不会删除原始相册文件。分享JPEG是可见信息图片，不是能还原编辑图层的工程备份。

## 模块与验证

- `modules/photos/details.ts`定义可选环境/编辑类型与校验，`matching.ts`输出可选海拔，`import.ts`读EXIF并生成清晰副本。
- `storage.ts`事务导入和字段patch；`useTripPhotos.ts`管理副本URL、后台天气补录；`weather.ts`独立日期查询与缺失判断。
- `PhotoViewer.tsx`小预览入口；`PhotoLightbox.tsx`全屏步骤；`PhotoStage.tsx`手势与归一化画线；`export.ts`生成信息图及平台输出；`photos.css`限定照片界面。
- `app/page.tsx`仅通过props接入更新接口与原轨迹；`useRecording.ts`仅扩充可选桥类型。安卓`PhotoShareProvider.java`只暴露生成的JPEG缓存副本，未导出provider、临时只读URI授权；`NativeBridge`/`AppFiles`接系统分享/保存；返回键优先关闭全屏子步骤。
- 没有新增依赖、删除业务文件；记录筛选与定位频率、地图/地形、路线和天气图层算法保持。回滚本轮提交即可恢复旧界面，保留数据库；不要删除数据库或换签名卸载安装。

验证命令：`npx tsc --noEmit`、`node --experimental-strip-types --test tests/*.test.mjs`、`node scripts/verify-photo-details.mjs`、`node scripts/verify-trip-photos.mjs`、`npm run build`、`scripts/build-android.ps1 -UnsignedOnly`。测试使用合成图片与指定时次天气模拟；另有真实历史接口请求。最终结果见CURRENT_STATE.md。Android系统分享/相册/双指触控仍需真机验收。

本机仍缺少0.2.4原签名，保持0.2.5/code12待签名源码；UnsignedOnly产物不可安装，不是新Release。原签名电脑拉取main后可构建覆盖安装包。
