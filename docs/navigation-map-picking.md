# 导航地图选点与地点箭头

路线规划的起点、终点和途经点右侧均显示“选点”。点击后保留路线面板，高亮待设置地址。点地图上已有标记时采用其名称及原坐标；点空白地图仍可自由选点。地图平移不关闭面板，取消或Escape保留原地址，关闭面板退出选点。最多8个途经点，长列表内部滚动，选点说明和取消入口固定可见。

普通地点标记沿用原图标和自选颜色，底部新增14 CSS像素箭头，箭头尖端与MapLibre bottom锚点重合；名称可截断但箭头不会被裁切。模型继续使用已有可见几何顶部投影，不改变高度或地表位置。选点完成后点击标记仍打开摘要和编辑。

顶部地址搜索及路线地址搜索结果使用不透明浅色背景。顶部下拉框单独覆盖通用玻璃样式，禁用背景滤镜，文字、分隔线与焦点状态保持可读。

## 模块边界

- `modules/navigation/RoutePanel.tsx`：地址输入和选点提示；经`onPick`请求地图选取，经`NavigationState.place`写入地点；搜索、途经点上限和道路服务接口沿用。
- `modules/controls/ControlDock.tsx`：新增可选`keepOpenOnMapInteraction`，默认行为保持；启用时由父组件处理Escape取消当前操作。
- `modules/map/TerrainMap.tsx`：`annotationPicking`只允许导航选点接收标记点击；`pickingActive`仍阻止拖动编辑。DOM标签和模型命中都通过`onAnnotationSelect`上报，不直接访问导航状态。
- `app/page.tsx`：组装导航和标记，选点时复制名称/经纬度，不改标记、不打开编辑窗口；正常点击仍走原编辑流程。
- `modules/annotations/AnnotationLayer.ts`与`annotations.css`：标签内容和箭头；保留MapLibre自身定位类。`modules/controls/modern.css`单独控制搜索底色，`modules/navigation/navigation.css`控制选点布局。

没有新增存储键、数据字段、服务或凭据，没有删除业务模块。跨模块通过props与回调连接；若回滚本功能，只回退以上UI/接线变更，无需迁移存档。照片、GPS记录、备份、路线计算和模型高度算法未修改。

## 验证

- 390×844及360×780：起点/途经点选择已有标记、终点选择空白地图、切换待选地址、取消、Escape、地图拖动和退出后重新编辑标记通过；两个尺寸均无横向溢出。
- 10行地址（起终点+8个途经点）时，起点切换到终点及返回可自动滚动到可见区域，提示和取消按钮保留。
- 顶部搜索真实“成都”结果：两尺寸背景`rgb(247, 248, 243)`、滤镜`none`；名称与详细地址可读，搜索服务本身未修改。
- 普通地点在390视口的地图锚点为(195,422)，标签按钮底边422，箭头bottom=0、border-top=14px；选中、取消和地图移动保持锚定。
- 类型检查、341项逻辑测试、网页构建通过；APK验证另见对应发行说明。浏览器检查不等于Android真机触控或安装验收。

本地截图：`artifacts/screenshots/navigation-{pick,search}-{390,360}-0216.png`。日志：`.openai/navigation-0216-*.log`，不提交运行日志或截图缓存。
