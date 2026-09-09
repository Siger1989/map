# 收藏模块

`CollectionsPanel.tsx` 是正式入口：默认显示 `WorkbenchPanel`，高级地区编辑和 ZIP/XLSX 导出复用原有目录能力。上方收藏 / 下方原地图的布局由 `workbenchLayout.css` 管理；地图只新增容器大小监听，不新建替代地图。

- `WorkbenchPanel` 负责搜索、分类、地区投影、树形展开与操作状态。通过 `onLocate` 定位且保持收藏打开，通过 `onOpen` / `onNavigate` 进入既有详情或导航。文件夹点击只展开。
- `WorkbenchAction` / `WorkbenchShare` / `WorkbenchSort` 分别负责操作对话框、真实路线图片与数据输出、同一父目录内的排序。`useSwipeSelection` 管理勾选栏滑选，`useWorkbenchLongPress` 在静止长按450ms后开始可取消拖动；它不改变地图单指响应时间。
- `workbenchTree` 是无存储副作用的树形操作；`workbenchAdapter` 从原始 `Transfer` 投影并更新名字、可编辑颜色和归档关系，几何、来源、时间及模型属性保留。
- `workbenchStore` 比对最新存档再写入，失败时回滚；撤销复用相同比对，不覆盖其他页面的新数据。`useWorkbenchData` 监听既有数据变更事件和跨标签页存储事件。
- `data` / `folders` / `transfer` / `export` 保持原存储键和version1备份，新增可选parentId与treeOrder；导出包含选中对象及目录祖先，导入碰撞时重映射目录和顺序。

原 `RouteCollectionsPanel`、批量地区编辑和高级导出继续可用。没有把预览示例或预览专用存档导入用户正式数据。新模块测试见 `collection-workbench.test.mjs`、`collection-folders.test.mjs`，手势仲裁测试仍在 `track-interaction.test.mjs`。
