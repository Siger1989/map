# 测量模块

入口`Measurement.tsx`负责三维投影、点选与紧凑参数面板，`useMeasurement.ts`维护一条本机测量、单次操作撤销栈及异步地形高程，`data.ts`提供校验、存档解析、水平/空间距离和方位角。

对外接口为MeasurementState、地图点击传入坐标/已加载高程、WatchProjection、projectGround和定位回调。依赖地图公开接口与objectTransform控制器；不访问轨迹、标记内部状态，不写入旧存档键。

`shantu.measurement.v1`最多200点，保存失败保留当前状态；未知高程不生成空间距离，取得高程后按点ID和原坐标核对再填入，防止迟到结果覆盖手动编辑。XYZ操作使用measurement-point类型，只暴露平移手柄。

用户本轮要求跳过进一步验证。后续需核查两手机尺寸、原厂相机回前台、地图未知海拔、XYZ拖动及保存重开；见CURRENT_STATE.md和docs/release-0.2.19.md。
