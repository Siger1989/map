# 移动网页兼容层

入口是 `mobile/bootstrap.ts`：先补齐必要接口、检测实际图形能力，再动态加载业务。OEM WebView 的包版本不作为浏览器内核版本，也不作为启动门槛。

- `abort.ts`：仅在接口缺失时补 `AbortSignal.any/timeout/throwIfAborted`。取消理由传递到调用者，组合信号取消后清理监听；应用超时范围为0～2147483647ms。不替换现代内核实现。
- `capabilities.ts`：通过一次可释放的WebGL2上下文和Worker能力进行探测，UA仅供失败信息阅读。探测失败保留重试和诊断信息，不要求升级系统或安装谷歌组件。
- `mobile/compatibility.ts`：旧内核的动态视口测量及`:has()`适配；现代内核继续使用原生实现。仅影响APK入口。
- `scripts/mobile-has-compat.mjs`与`mobile/relationalLayout.ts`：构建时生成关系样式的条件、作用对象和选择器权重；旧内核根据条件更新有限的兼容类。通过同源CSSOM读取元数据，避免Chrome99无法枚举计算样式自定义变量的问题。没有全局替换DOM选择器；原生`:has`可用时不启动观察器。新增兄弟关系等不支持的谓词会在构建时报错，需显式扩展并验证。
- `scripts/mobile-css-compat.mjs`：把APK样式里的dvh及包含它的自定义变量转换为兼容视口单位。Lightning CSS处理嵌套/颜色等可静态转换的语法；动态收藏颜色有独立渐变回退。
- `scripts/mobile-worker-compat.mjs`：将独立复制的MapLibre公共worker与shared模块也编译至Chrome99，防止仅主包兼容而后台解码失败。

依赖原生WebView/WebGL2、Worker和项目原有MapLibre。没有打包第三方浏览器内核，没有修改系统设置、TLS校验、网页权限、网络白名单或用户存储。Chrome99是构建与回归基线，不保证所有同版本驱动或所有更旧内核可用；HarmonyOS4.2真机状态单列在发行说明中。

回滚可以撤回此模块、APK启动/构建接线与新依赖；业务存储格式保持原样。手势修复位于`modules/tracks/DrawingGestureBridge.ts`，独立于兼容层；被双指打断的临时笔画取消，已松手提交的几何对象不会修改。
