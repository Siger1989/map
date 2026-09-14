# 返航

入口ReturnPanel；对外仅通过tracks/record/fix/markers输入，以及onRemember、onNavigate、onShow回调。保存车位/营地/撤退点复用annotations，随既有JSON备份转移，不引入第二套地点库。

breadcrumbs反转用户选定的一个连续段，完整保留循环和点序，不自动连接暂停缺口。导航交给现有导航预览/会话。返回固定点明确使用offlineRouting的步行路网；无路网/不连通时显示失败，不绘制可走捷径。

直线距离/真北方位单独标明，需30秒内GPS、估计误差不大于80米；地图中心保存是用户显式勾选的手动坐标。无可靠位置不启动路线返程。
