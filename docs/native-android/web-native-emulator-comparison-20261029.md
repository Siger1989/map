# 网页141与原生142：Google模拟器失败记录

> 后续用户指定网易MuMu，已改用独立MuMu实例进行实测；新结果见[`mumu-web-native-performance-20261029.md`](mumu-web-native-performance-20261029.md)。以下“未完成”结论仅指本次Google模拟器尝试，保留作故障历史，不能覆盖后续MuMu数据。

用户明确要求比较原网页地图版与现原生地图版，并先在模拟器测试。本轮使用精确已交付APK，未使用上一轮尚未出包的内存优化源码替代原生142。

| APK | 地图实现 | 大小/本机SHA256 |
| --- | --- | --- |
| 私人0.2.141-test / code148 | React + MapLibre网页地图 | 70,306,068字节；`ca3d673a58846d70fe98ff89165d5c9e0eabbe7d9f78d36b89cedda19b5660ad` |
| 私人0.2.142-test / code149 | React UI + WorldWind原生地图 | 180,488,627字节；`7833d6fa8c60c52b9b1ee8b76d07e4b24e2ba959c6597249c7e4cd242b2317c4` |

二者均为原包名和私人配置版本。APK大小是安装资源大小，不代表运行内存、CPU或耗电。

## 测试方法和实际结果

计划同一AVD、同一应用身份依次覆盖安装，固定中心102.9/31、zoom12、高清、地形开启、天地图影像、道路/地名开启，平视及55度各采静置、相同物理滑动与滑动后静置。主进程和该应用WebView renderer合并采集PSS/RSS与CPU；CPU应按稳定PID的utime/stime差分和CLK_TCK换算，不能把累计ticks直接当百分比。renderer归属有歧义或任一进程缺采样时必须判无效。SurfaceView和WebView的gfxinfo口径不同，不把它直接用作共同FPS。

尝试了既有API35验证AVD、全新API35 AVD、全新API34 AOSP AVD，以及将API34镜像/新userdata复制到SSD的独立AVD；尝试host GPU和SwiftShader。原验证AVD、用户Androws与真实手机未删除或清数据；没有重建/替换固定交付APK。新装官方SDK镜像为`system-images;android-34;default;x86_64`。独立新AVD使用4核/4GiB、390×857，SSD位于本机`C:/Users/bodean/AppData/Local/ShantuBench/`。

- **原生142**：API35中已实际到React nativeReady，DOM canvas=0、相机zoom12/pitch0。采样遇到系统ANR、内存服务DEAD_OBJECT和系统服务重启。该次设置还出现Sentinel/TDT状态不一致，因而本身也不满足同图源前提。
- **网页141**：API34 SSD/host GPU中MapLibre实际getZoom=12、pitch=0、terrain和TDT影像/高清设置确认；`loaded()`与`areTilesLoaded()`曾均为true，DOM canvas=1。随后renderer PID3154收到SIGSEGV（status11），宿主PID3122因未处理renderer崩溃触发SIGTRAP/native crash。Android退出记录支持此失败类型，不是手机OOM证据。
- 网页141主进程曾读取到PSS，但同时renderer的dumpsys meminfo超时。**不能漏掉renderer后比较，也不能将缺失项按0计**。已有0值样本明确无效。
- 换为直接读`/proc/<pid>/smaps_rollup`以避免依赖进程内内存查询，并统一SwiftShader后，仍发生CDP超时及模拟器连接消失，未取得完整阶段样本。该PSS口径只覆盖进程映射，不等于包含所有宿主GPU分配的整机消耗。
- 排查时曾临时停止模拟器传感器HAL及关闭测试AVD中的Google后台包。这些操作可能干扰系统稳定性，相关尝试不作为严格基线；停止HAL不能认定为有效的性能修复。最终所有本轮模拟器进程已停止，没有保留这些进程在后台持续耗用CPU。

## 证据和边界

本机原始证据分别保存在`.openai/perf-141-142-20261029/`、`.openai/perf-141-142-api34ssd-20261029/`、`.openai/perf-141-142-api34ssd-sw-20261029/`；采集草稿`.openai/perf-compare-141-142.cjs`。前两个目录包含未满足前提或查询失败的中间样本，均不可当性能结果。模拟器启动日志在本机`D:/ShantuNativeTools/perf*-20261029-*.log`。截图`setup.png`、`fresh-state.png`记录系统无响应；API34目录保存网页配置、瓦片加载状态和部分内存原始输出。

**结论：未获得有效的两版CPU、完整应用PSS/RSS、FPS、耗电或启动速度对比。不能判断原生版比网页版省或更费，也不能用单次启动耗时、安装包大小或理论位图预算替代该结论。**

继续前应先单独确认模拟器在不停止必需HAL的条件下稳定运行、系统服务无重启、WebView/WebGL及原生GL压力测试稳定；再重新固定同图源/相机/画质、同加载状态并至少重复两轮。模拟器GPU/功耗不能外推Find X8。用户要求的对比仍未完成，不把此报告当性能验收。
