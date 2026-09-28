# 0.2.79 性能调查与验证

## 复现与边界

OPPO Find X8 Ultra 用户报告0.2.78在路线分叉、地图平移缩放和普通3D旋转时仍卡。截图不能给出CPU/GPU耗时归因；本机ADB未连接手机。以下为代码审阅、桌面浏览器390×857 CSS / DPR2.04以及自动测试证据，不是OPPO帧率成绩。

## 证实的问题与修改

1. 主地图摇杆此前每pointermove调用easeTo(duration:0)，每个样本都结束一次相机移动。浏览器同一次拖动观测8次movestart和8次moveend。结束处理会同步路线索引、保存视角，并令MapLibre DOM marker强制更新地形遮挡。
   - 改为每RAF只发最新姿态，共用公开easeId，使用恒等于1的easing在下一帧到达目标，250ms仅维持连续事件身份；松手用duration0同步最后姿态，取消清理待执行帧。静止超过250ms可正常结算，不保持无限动画。
   - 相同拖动复测为1次开始、1次结束，最终bearing=-90.39052574992343、pitch=80，与原版一致。
2. 分叉绘制此前每个输入都会处理，吸附范围每次额外5次unproject；MapLibre6.7的terrain unproject是CPU射线步进/二分地形采样，不是GPU readPixels。
   - 合并同帧输入，松手flush，双指和取消丢弃pending；候选节点投影按手势缓存屏幕网格，精确14px距离/同距离后者优先规则不变。每次查询额外地形反算从5次到0次，实际手指点所需的1次保留。首帧索引仍需N次投影，候选/相机失效重新建立。
3. 主地图强制开启MSAA，增加高DPR全屏帧缓冲采样成本；恢复MapLibre默认antialias:false，保留原生DPR、路线/文字绘制和DEM tileSize256。运行时WebGL上下文确认false，实际画布仍795×1748。
   - 此项是降低渲染负担的配置改动，未获得手机GPU时间，不能声称已证明是OPPO唯一瓶颈。

MapLibre marker内部terrain.depthAtPoint使用同步readPixels，可能引入GPU等待；减少虚假的moveend亦减少该强制路径频率。本轮未更改依赖源码或隐藏地形/路线。参考[MDN WebGL性能建议](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)及仓库安装的MapLibre6.7 camera/marker/terrain源文件。

## 验证

- PASS：695/695自动测试、TypeScript；输入合并、尾点flush、双指取消、网格精确距离/平局/缓存失效有定向覆盖。
- PASS：普通平移一次开始/结束；旋转最终姿态一致；缩放后无地图source错误、无WebGL上下文丢失。基线普通平移39个运动帧间隔平均8ms/p95 13.7ms，仅说明桌面未复现同级卡顿，不作为优化百分比。
- PASS：开启节点吸附，选测试路线节点进入分叉，拖动松手生成分支并累计6.0公里；撤销回0米，按钮布局未改。
- 截图：artifacts/screenshots/perf-0279-3d-rotation.png（地形旋转），artifacts/screenshots/perf-0279-route-branch.png（分叉落点与原布局），视觉检查PASS。
- 诊断原始数据：.openai/perf-0279-browser.json；测试/类型日志：.openai/perf-0279-tests.log、.openai/perf-0279-tsc.log。
- APK：0.2.79-test/code86，构建/签名/资源见release-0.2.79.md。
- 待验证：OPPO实际连续旋转、平移、双指缩放、分叉和拖点手感；MSAA关闭后的手机地形边缘效果、覆盖安装。未声称真机已流畅。
