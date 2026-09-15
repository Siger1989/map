# 户外记录与离线缓存

- `OutdoorPanel.tsx`：四标签组合入口，记录/导入/缓存/照片分别拥有界面和临时状态。
- `useRecording.ts`：记录生命周期、浏览器定位或原生快照、保存失败反馈。`recording.ts` 是独立纯状态转换。
- `nativeRecordingSnapshot.ts`：重复快照复用；仅错误或阶段变化保持几何引用。后台页面停止轮询，原生服务继续记录。
- `useRecordingTracks.ts`：地图和照片所需投影，按点位变化缓存，避免每次提示刷新全量生成。
- `samplingPolicy.ts`：模式参数/校验/采样筛选；`useSamplingPolicy.ts`：偏好持久化和原生能力适配；`SamplingSettings.tsx`：折叠设置。
- Android `SamplingPreferences.java`：独立偏好及严格范围验证；`SamplingPolicy.java`：纯采样/调度规则；`RecordingService.java`：请求频率与静止/移动检测；`RecordingStore.java`：原子轨迹检查点。
- `RecordingPanel.tsx`：记录控制/样式；`OfflinePanel.tsx` 与 `useOffline.ts`：底图/地形缓存。缓存不是离线路由图。
- `savedRecording.ts`：保存完成后验证再清理记录；保留原始逐点时间/海拔和暂停边界。
- `exchange.ts`：旧数据交换兼容入口，实现在 dataTransfer。

跨模块只使用公开参数/返回值与 `DATA_CHANGED` 事件。记录模式独立于最大定位误差门槛；历史轨迹不会因设置收紧而失效。新增样式 `colorMode` 为可选字段，旧文件仍单色。

默认标准4秒/5米；省电10秒/10米；高频1秒/2米。每个定位点仍必须通过精度、时间、异常速度和容量筛选。按距离模式不在原地定时补点。原生静止60秒后最短请求间隔提高至15秒，可靠移动超过定位误差范围后恢复；“恢复”受下次有效定位与系统调度影响，不能保证即时检测。网页仅控制接受采样，无法要求硬件以指定频率工作。Android耗电/GPS/锁屏待真机检验。

自动记录仅指用户开启选项后开始导航时、空闲状态下开始新记录；不会随开机/应用启动记录，未保存记录和暂停记录不覆盖。结束导航后记录仍需用户结束，以免漏记返程。

## 0.2.36记录与行程窗口

RecordingWindow是独立入口/内容外壳，RecordingPanel切换未开始/记录/暂停/待保存及子设置；收起不发停止命令。useRecording与recordingCommand用记录ID关联命令与原生最终快照；NavigationFinish在保存读回确认后才清理。tripData提供真实统计和独立行程转路线事务，TripDetails/TripGraphs展示数据及点图联动。照片继续调用photos模块，不复制导入逻辑。
