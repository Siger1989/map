# 工作台组合

`trackOverlay.ts` 的 `composeTrackOverlay` 只接收 tracks 的公开数据、编辑会话和实时记录投影，返回地图覆盖层数据；不读写存档，不编辑几何，不调用地图实例。编辑来源过滤集中完成一次，实时记录统一追加。

`useGuidanceWorkflow.ts` 独立管理导航预览目标、启动、收藏/轨迹适配、首次定位跟随和结束时释放自有定位。通过Pick缩小模块输入，通过onActivateUi/onOpenRoute/onInvalidRoute回调协调其他工具，不访问其内部状态。

依赖方向：app → workbench → feature public types/functions。功能模块禁止反向导入 app/workbench，脚本 `npm run check:architecture` 检查此边界。后续主页面继续按完整操作流程提取控制器，不把多个模块的内部状态塞入一个全局上下文。

## 0.2.36窗口组合适配器

WorkbenchRouteWindows组合路线卡/行程详情与现有编辑入口；WorkbenchCollections连接收藏目录选择、隐藏对象查看和返回；WorkbenchRecording组合独立记录与导航收尾；WorkbenchPhotoPlacement保留照片候选会话跨地图点选。接口采用相关hook返回类型、MapHandle及明确回调，不在适配器增加另一份归档数据。新流程禁止反向从功能模块导入这些组合器。
