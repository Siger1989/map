# 0.2.98-test 私有手机测试 APK

2026-10-02。用户要求打包后补充手机反馈：编辑仍显示断开提示、分叉终点按钮找不到、编辑卡顿。早先同版本未交付包已停止下载并替换；以本文最终哈希为准。

- Android versionCode105，包名 com.guanyun.weather.shantu.preview，原签名未变，可覆盖对应独立测试版。
- APK：APK/Shantu-0.2.98-test-standalone.apk，66,069,296字节；SHA256 `0b821858e1f7e1771003ddd94cecbfd8b063cf9d552cbefdb8d40c1c03cb25bc`。
- 最终暂存：mobile/.build/apk-20261002-093807/web。38项用户图源配置原样纳入、已有天地图Key与apk-preview配置一致（只检查布尔值，不打印Key）。1365张全球卫星概览、473张主地形瓦片保留。该包仅供用户自己的手机，不公开发布到GitHub。
- 双图编辑节点预览减少整条路线提交、跟随视角覆盖更新合并；双图选中路线独立删除；路线/标记标题单个上下切换按钮，横屏左右切换，草稿及子页保留。
- 进入编辑清掉断开图层（DOM断点、距离、地理虚线），编辑中阻止旧检查重新显示；退出不自动恢复。未改断开路线几何。
- 主工具栏恢复“设终点”：选一个节点、结束分叉后可用；保存/撤销沿用实际编辑流程。“节点属性”文字缩为“属性”，可访问名称保留，不加解释栏。
- 坡度/海拔显示的着色路线对象与analysisParts按真实几何/模式变化更新，单纯选点保持引用，修复绕过TrackLayer局部更新的路径。

验证：TypeScript、85项路线/分叉/双图/标记/显示定向检查通过；此前本轮39项网络/原生读取/取消/坐标校正/地形检查通过。v2/v3原证书签名、CRC、1910项最终暂存资产对照、496张地形PNG像素/元数据对照、种子原样对照、概览输出哈希及Key配置对照通过。架构文件行数预算仍有8处失败，未以结构重构扩大本轮修复。

独立9287存档实测390×857单图“导航断开→查看断开处→编辑→设终点→撤销→退出”；360×780双图选点设终点/上下切换保留/撤销退出，无文字或按钮溢出。最终暂存网页再确认双图选择、设终点、上下切换、撤销退出。截图在artifacts/screenshots/loading-reuse-20261001/route-gap-endpoint-fix-390.png、route-gap-endpoint-fix-dual-360.png、route-endpoint-final-apk-0298.png。

受控真实useRouteDisplay+TrackLayer回归：1000节点坡度着色路线连续20次选点，着色引用保持，整条路线源写入及所有节点投影次数不增加；不代表手机GPU帧率。Android触控、实际流畅度和覆盖安装仍待用户验收。预览上游高程/道路存在失败，未宣称所有图源可达或达到奥维性能。HarmonyOS6.1原生包仍未交付，见harmonyos-6.1-install.md。

构建命令：

```powershell
npx.cmd tsc --noEmit
node --experimental-strip-types --test tests/route-edit-feedback.test.mjs tests/route-edit-ui.test.mjs tests/route-info.test.mjs tests/route-selection-details.test.mjs tests/map-comparison.test.mjs tests/annotation-editor.test.mjs tests/dual-edit-performance.test.mjs tests/track-analysis-render.test.mjs tests/track-branch-fast-path.test.mjs tests/route-display.test.mjs tests/track-network.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -SdkRoot D:\GodotAndroid\android-sdk -JdkRoot D:\GodotAndroid\jdk-17 -StandaloneTest -DefaultMapSources .openai/default-map-sources-private.json
python .openai/verify-0298-integrity.py
node .openai/verify-0298-config.mjs
```

手机分发使用随机单APK路径、2小时有效期、支持Range，不开放项目目录。最终链接与整包外网SHA校验结果保存在.openai/apk-0298-r3-public-download.json及public-verified.json；需电脑在线。本轮未提交或推送Git。功能分支codex/rollback-ui-0235-20260921，HEAD ec47ec0aa5f23cba6dfa2dd576197a82b6f34efe，当前改动尚未提交，未合入main；本轮未查询或变更远端。
