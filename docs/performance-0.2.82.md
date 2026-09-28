# 0.2.82 路线分叉性能记录

## 桌面基准

使用同一脚本和 10 条、每条 6,000 个坐标的合成路线，对照 `.openai/branch-0282-before.json` 与 `.openai/branch-0282-after.json`：

| 操作 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 开启分叉 | 193.066 ms | 2.004 ms |
| 结束空分叉 | 183.857 ms | 1.880 ms |

优化后这两条快路径均未触发主地图 source 的 `setData`、`updateData` 或节点投影。背景 recorded/samples 路线只差分更新改变的节点。快路径仅适用于已保存路线尾部的空单点段；若草稿包含新几何，或相机/source 失效，则回退完整更新。

这些数值来自桌面同步 JavaScript 合成基准，不代表 Android WebView、渲染或真机触控耗时。

## 浏览器操作验证

390px 浏览器中，以 3.0 km 路线开启分叉并新增节点，结束分叉后连续撤销到 0 m，再不保存退出：PASS。截图：[branch-0282-undo.png](../artifacts/screenshots/branch-0282-undo.png)。

857×390 横屏中，地图工具宽 50 px、高 220 px，右下摇杆为 64×48 px，两者间距 8 px；贴合右侧安全边界检查通过。截图：[landscape-right-edge-0282.png](../artifacts/screenshots/landscape-right-edge-0282.png)。横屏收藏左侧列表约360×334，右地图及剖面覆盖层约497×334；展开、定位与关闭通过，竖屏仍为上下布局。

删除确认框在857×390、857×350、390×844、360×780中均约179px高，clientHeight与scrollHeight均177，无内部滚动；取消/确认和六个路线操作保留。确认提示不再重复长路线名，完整名称保留于标题及无障碍标签。仅打开确认后取消，未实际删除用户路线。

## 边界

桌面基准及浏览器操作不等同于 Android 真机性能验收。尚无 OPPO 设备上的分叉耗时或触控跟手数据；最终源码已重新构建APK，交付校验见发行说明。
