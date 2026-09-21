# 文件夹用途与清理规则

## 保留在项目内

| 目录/入口 | 内容 |
| --- | --- |
| README.md、CURRENT_STATE.md、AGENTS.md | 项目入口、当前进度、工作规则 |
| app、modules、components、hooks、lib、types | 按职责分模块的源码 |
| config、public | 配置、原Logo、地形/地图worker/字体及许可证；不能当缓存删 |
| mobile、desktop-web | 平台外壳；mobile/.build内的原签名密钥需要特别保护 |
| scripts、tests、tools | 构建、检查与布局开发工具 |
| docs | 有效专题文档；agent-handoff.md索引，不必一次全读 |
| docs/reference | 本次讨论的原始PDF（32页，已校验SHA256） |
| docs/history | 已完成轮次/旧版本状态，不作为当前指令 |
| output/pdf | 既有已跟踪历史版本PDF，保留兼容链接 |
| APK | 当前主目录最后的参考包与本轮新包；交付以GitHub Release为准 |
| .openai、artifacts | 本机日志/临时检查/截图，默认不入Git；hosting.json保留 |
| node_modules | 共享依赖；其他工作树通过junction复用，不能直接删 |

## 移出项目的本机归档

本轮归档根：`D:/山兔-本地归档/20260921-cleanup`。旧APK、旧构建中间目录、一次性脚本和历史日志分类保存；具体文件、字节数与SHA256在该目录的manifest.json。归档不进GitHub，也不代表磁盘空间已经释放。

已移出1400项、16588个文件，共12,400,837,613字节；逐文件大小和SHA256全部复核，结果verified.json。已安装的outputs/tools因包含工具自带证书保留原位；没有改动签名密钥、环境文件、共享依赖或地形源。

未提交改动先做独立快照：`D:/山兔-本地归档/20260921-before-rollback-110139`。两个归档目的不同，不要混用恢复补丁。

## 后续维护

- CURRENT_STATE.md只保留最新目标、分支、结果、限制、下一步；历史另存，不逐轮全文堆叠。
- 正式检查脚本放scripts/tests；一次性调试放.openai。截图按轮次放artifacts/screenshots。
- APK不提交Git；旧包归档或从Release下载。不要把旧包重命名成新版本。
- 不用 `git clean -fdx` 清理全仓，不删除.env、签名密钥、用户草稿、备份、地形资源或共享依赖。
- 工作树删除前核对分支、未提交文件、运行服务和恢复路径；本轮旧工作树保留但标记停用。
