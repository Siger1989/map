# 记录点、刷新与手动精度门槛

## 区别

系统定位更新先经过筛选，接受的点才写入实走轨迹。安卓当前对 GPS 与网络定位分别请求最小4秒间隔、最小5米距离；这不是保证每4秒一定返回一个点。网页约每1.5秒读取原生记录快照，地图跟随最后一个有效记录点；读快照或重绘地图不会新增轨迹点。

旧版记录门槛固定80米。源码现在提供“行程 → 实走记录 → 记录精度”，默认20米，可输入5到80之间的整数。应用设置后从下一个定位点开始生效，保存在本机，关闭重开后继续使用。未超过门槛的点仍须通过过期、异常跳变和距离/时间采样检查，不能把每次刷新都算为记录。

## 设置的含义

例如设为10米，系统报告估计误差30米的定位就不写入轨迹，也不会成为记录期间的新跟随点。界面显示过滤原因；达到门槛后继续接受有效定位。设置越严格，遮挡/弱信号时可能长时间没有新记录；长时间缺点仍按原规则分段，不补造点。

这不能命令硬件达到指定精度，也不能保证消除漂移。Android 的 accuracy 是系统估计的水平误差半径，并非位置误差的绝对上限。原定位请求频率、GPS/网络来源及地图平滑逻辑保持不变，本轮没有新增道路吸附或把原始实走点移到道路上。

参考：[Location 精度定义](https://developer.android.com/reference/android/location/Location#getAccuracy())、[LocationManager 更新参数](https://developer.android.com/reference/android/location/LocationManager#requestLocationUpdates(java.lang.String,long,float,android.location.LocationListener))。

## 模块与兼容

- `modules/outdoor/recordingPreferences.ts`：门槛范围、默认值和过滤提示；`useRecordingPreferences.ts`：本机存储/原生桥与失败状态；`RecordingPrecision.tsx`：折叠设置。
- `recording.ts` 的接受函数新增可选门槛参数，历史存档仍按旧80米上限验证，收紧设置不会使旧数据无法读取；`useRecording.ts` 为新点应用门槛并显示过滤原因。
- Android `RecordingPreferences.java` 使用独立 SharedPreferences；`RecordingStore` 每个新点读取门槛，过滤提示只保留在内存，不为每个拒绝点重写整个轨迹。`NativeBridge` 提供受限数值读写。
- 没有配置接口的旧 APK 显示80米且禁用设置，避免网页虚假承诺已改变原生记录行为。GPS精度设置不修改普通定位按钮的数据源，也不改变历史照片匹配。
- 未删除业务文件；地形、天气、照片存储/匹配、路线计算及原生定位请求频率不改。回滚本轮提交可恢复旧固定门槛；偏好使用独立键，不改变轨迹格式。

源码并入尚未发布的0.2.5。已发布0.2.4没有该设置；原签名仍缺失，不发布不同签名的替代安装包。类型、逻辑、界面与构建结果见 `CURRENT_STATE.md`；模拟定位无法验证真实手机的漂移幅度或耗电。
