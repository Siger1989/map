# 0.2.160-test 本机私人试修记录

160是本机私人试修记录，不是公开发行或完整验收结论。它让规划路线、保存轨迹、导航线与相关描边按连续zoom曲线缩放，保留用户基础宽度和颜色比例；同时调整原生绘制放大镜的ROI捕获频率/面积，并统一高质量天地图底图与栅格注记的detailControl。道路吸附状态与道路显示状态独立。相机gizmo的orbit/倾斜拖动新增中心小位移死区和低位移缓动；环形方位拖动原有死区保留。

- 版本：`0.2.160-test` / code167；原包名及兼容标识不变。
- 线宽因子：zoom≤6为0.25，10为0.5，14为0.8，zoom≥16为1；区间线性插值。渲染宽度=`用户基础宽度×zoom因子`，所有路线描边/selected edge同因子；独立点选容差保持12 CSS像素。
- 放大镜：96×96 CSS像素捕获ROI，取32×32 CSS像素邻域放大至96×96显示；single-flight，125ms最小请求间隔，失败后750ms重试。此限频不是FPS指标。
- 当前源码含道路吸附路径判定修复。最终本机APK `Shantu-0.2.160-test-private.apk`：165171888 bytes，SHA256 `d2ce77c9bff7092631b70a78aaeece7173510f1321f8228962cacfa4a19f38b5`；177/177 Node、TSC、fresh React、optimized构建及包审计PASS。已复制到`交付包/山兔-0.2.160-test-2026-11-01/01-Android-APK`及固定`APK/山兔手机.apk`，三份SHA256相同。固定入口目标为160；159/158/157版本化归档保留。
- 已完成路线runtime：road display OFF / snap ON / node ON；沿914顶点缓存路从首点生成沿路65点，held hint为`along-road`、结束提示非crossing；相对直连的最大横差约566.54m，lossless截图确认约3.1km曲线。node-close路线67点且终点精确；own undo后draft/saved均归0。第二轮同target虽生成3点但画出864m直线，仍计FAIL，点数不代替视觉验收。最终包还有3次短手势，9/9 capture reply/render且有纹理。
- 最终APK原生renderer的7姿态/133条stroke检查PASS，状态、revision及相机恢复PASS。合成origin pose冷启动时相机回读不符FAIL，同姿态在DEM就绪后2/2 PASS，不能据此确认SDK clamp/race根因。实际UI摇杆MotionEvent对照通过；离线路网car/moto受限回归通过且恢复原状态。细节见[160交接](HANDOFF-20261101-160.md)。
- 放大镜40 MOVE同空草稿对照属于首轮160构建子模块样本：159 52个全幅JPEG回复仅2次绘制；首轮160 23个ROI PNG回复22次绘制，样本capture 103ms。样本字符串长度与一轮耗时不代表带宽/FPS/通用延迟。最终APK不是40 MOVE复测。
- 高质量CIA detailControl `.5` runtime PASS；早期2.5秒画面出现粗大父级标签，静置约1分钟的zoom14/pitch44 lossless画面显示较小、更多细节标签。不能称注记字体/密度不变或通用加载提速。
- Library原图像素未读、手机当前版本未知；手机、主双图和完整真实导航跟随未验收，不承诺已修复手机卡顿或闪烁。APK保持本机私人用途，不新建下载地址、不公开。159/158/157版本化归档保留；未清理用户数据，鸿蒙/EXE/DMG未重建。最终APK归档复制与摘要核对完成。

实现边界、baseline事实及接续验证见[160工作交接](HANDOFF-20261101-160.md)。
