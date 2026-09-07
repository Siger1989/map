# 0.2.5 实走存档与照片文件夹修复（待签名）

## 原因与处理

旧界面把所有保存的实走、导入和手绘轨迹放在“手绘”标题下。正常“保存到轨迹”包含逐点时间；但进入续画并再次保存会用手绘对象替换原存档，丢失 samples；反向和合并也未同步时间点结构。照片页如果沿用不带时间的选中轨迹，会没有有效默认选择。

现在轨迹管理和收藏显示来源，实走保存写入 recorded 标识并核实存储内容，然后清除当前记录检查点并进入照片页。旧版没有来源但仍有时间数据的轨迹显示为“带时间轨迹”，继续支持匹配。失效选择回退到可匹配轨迹；没有时间的轨迹仍列出并说明原因。

实走及带采样的导入轨迹保留原始坐标和时间，允许重命名、改线条样式。改线使用“复制为手绘”，另存副本；原记录不参与节点移动、反向或合并。没有时间的旧线不会自动补造时间；若旧版已覆盖掉 samples，需要原始带时间 GPX 才能恢复匹配。

## 照片入口

行程 → 照片，选择已保存的实走/带时间轨迹。可多选照片（每批30张），也可选择具体照片文件夹（含子目录，最多200张）。文件夹过滤普通文档；超过限制明确提示，不默默截断。安卓通过系统目录选择器授权所选目录，目录扫描在后台执行，取消/关闭后不再回传。Android 系统可能限制存储根目录等位置，应选择具体行程目录。

安卓目录入口使用受控输入标记经 AppFiles 转为 ACTION_OPEN_DOCUMENT_TREE，再通过 DocumentsContract 返回所选树内的照片 URI；兼容旧 WebView 的普通多选输入。浏览器使用目录输入；旧 APK 会提示升级，普通多选入口保留。不新增整库相册权限，不上传照片。

参考：[Android 系统目录访问](https://developer.android.com/training/data-storage/shared/documents-files)、[DocumentsContract](https://developer.android.com/reference/android/provider/DocumentsContract)。

## 模块及回滚

- tracks/provenance：来源显示、时间判定、原始节点保护；drawing 保持旧存档键并兼容可选 source。
- outdoor/savedRecording：统一坐标/时间转换、保存与读回验证；页面通过 onSavedTrack 选择新存档。
- photos/PhotoPicker、selection：文件/目录选择、类型和限额；PhotoPanel 负责匹配与预览。
- Android PhotoDirectory：仅扫描获授权目录；AppFiles 负责系统选择/取消/回调。
- 地形、天气、地质、卫星数据算法及路线计算不变。没有删除业务模块。回滚本次提交即可恢复实现；存档 source 为附加字段，旧版本仍能读取坐标与 samples，但不应再用旧版续画覆盖原始记录。

## 构建与签名

源码版本为 0.2.5-test/code12，当前机器没有 0.1.4–0.2.4 测试版使用的私有签名。没有发布 0.2.5 APK；最新已发布包仍为 0.2.4。

config/android-signing.json 只记录公开包名和证书指纹，构建脚本在打包前校验，不再自动生成一个无法覆盖旧版的新签名。原签名电脑拉取源码后可执行原有构建命令；其他电脑可通过 GUANYUN_SIGNING_KEY 或 -SigningKey 指定私下迁移的原密钥路径。密钥不进入 Git。-UnsignedOnly 编译/检查的产物放 mobile/.build，仅供待签名验证，不能安装。

测试及最终结果见 CURRENT_STATE.md；浏览器模拟不能替代安卓系统目录选择、真机记录和触控验收。
