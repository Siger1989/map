# 连线测量

`useMeasurement` 管理可连续添加的 A/B/C 等点、单点删除与撤销、地形海拔和编辑草稿；`data` 计算各段水平距离、斜距、真北朝向、水平夹角。最多 200 点。拖点或地图选点传入经纬度，模型尺寸不参与高度。

新草稿键 `shantu.measurement.path.v1` 首次兼容读取 pair/v1 及旧 polyline/v1，不覆盖旧键；savedId保存所编辑记录身份，删首点后仍更新原记录。`saved` 与 `useSavedMeasurements` 使用独立 `shantu.measurement.saved.v1` 保存最多 200 组快照；写入成功后才更新 UI，读坏数据不覆盖。点击保存更新当前记录，重新测量后保存新记录；关闭草稿不删除地图记录，移除记录可立即撤销。

`MeasureLines` 使用三维相机投影：每段 B 的水平投影点为 B 经纬度、A 海拔；水平参考线及垂直投影均为虚线。图上高度仅按地图地形夸张比例显示，数值使用未夸张地面高程。未知高度不冒充 0。结果合入单一紧凑卡片，更多选项可展开非等比示意；高度受统一28dvh/200px上限限制。

`profile` 生成工程风格 SVG，再由 `MeasurementShare` 转为 1200px JPEG，复用照片文件输出边界。每页 10 段，跨页共用衔接点，累计距离连续；保存与分享逐页提供。图含坐标、高程、里程、分段水平长度/夹角/朝向，注明横纵比例不同及非连续采样地形剖面。

验证见 tests/measurement-save-profile.test.mjs、tests/measurement-marker-delete.test.mjs；网页 390×843 与 360×780 检查、保存重开与已存在模型选 C 点已通过。浏览器验证不代替真机手势与系统分享。
