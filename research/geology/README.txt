地质绘图与研究归档

内容
- generator-v1：PC 实测剖面与钻孔柱状图导入、归一化、几何/渲染源码，规范合同、模板、示例和审查/最终图件。
- drill-demo：ZK0003 钻孔示例、原始示例数据、示图、附表与花纹证据。
- vertical-research：原始资料的结构化摘录、规范研究、源图局部和研究结论。read-deps 第三方运行包未归档；可按下文安装依赖。
- generator-v1/scripts/make_standard_templates.mjs：标准模板生成脚本。

原始资料映射
- 原始地质资料目录位于仓库根目录“地质资料/”，包含测段登记、钻孔分层/回次/采样、分析结果、规范 PDF、参考图例和原始照片。
- vertical-research/data 中的 XLS/XLSX 转换件、逐表摘录及 JSON 是上述资料的读取/规范化研究副本；相关文件名、哈希与来源关系见其 source-sha256.json、source-readonly-audit.json、source-file-inventory.txt。缺失、空值和来源冲突按原摘录保留，不用于补造几何。
- 人工补充的原始参考附件由仓库 references/chat-attachments-20261008/ 单独保存；本目录不再复制一份。
- 研究成果清单和 SHA-256 对照见仓库 docs/geology-archive-manifest-20261008.json。清单用“源工作区/…”代称原来源路径，避免记录个人工作区绝对路径。

在 Windows PC 启动

方式一：单文件桌面程序（推荐）
1. 运行 output/pc-industry/山兔地质行业工具.exe。程序自带 Python、openpyxl、xlrd、网页界面和四份标准/示例工作簿，不需要先安装 Python。
2. 优先打开独立桌面窗口（pywebview + Microsoft WebView2）；当前电脑没有可用 WebView2 时，会尝试用 Edge/Chrome 应用窗口打开。电脑至少需要 WebView2 Runtime、Edge 或 Chrome 中一项；都不可用时程序会报错退出。
3. 生成成果、上传副本及运行日志写到“文档/山兔行业工具”，不写入 EXE 的临时解包目录。可用 --data-dir 指定其他可写目录。
4. 用“山兔地质行业工具.exe --self-test”检查实测剖面和钻孔示例的导入及 SVG/PNG 输出；诊断记录与检查图件写入当前数据目录。

如需从源码构建：在 PowerShell 运行 research/geology/generator-v1/build_pc_exe.ps1。脚本自动探测 py -3.12 或 python.exe；也可用 -Python 指定 Python 3.10+ x64 解释器。依赖和 PyInstaller 虚拟环境放在 .openai/build/pc-industry，产物输出到 output/pc-industry。当前 PNG 栅格化使用已安装的 Microsoft Edge 或 Google Chrome；WebView2 使用系统运行时。程序本身监听随机本机端口 127.0.0.1；不会占用、连接或关闭旧的 9188 服务。

方式二：系统 Python 源码运行
1. 安装 Python 3.10 或更新的系统 Python，并确保 `py -3` 或 `python` 命令可用。
2. 安装 XLSX/XLS 读取依赖：`py -3 -m pip install openpyxl xlrd`（若使用 python 命令则替换前缀）。
3. 双击 generator-v1/启动_系统Python.cmd。它在当前归档目录启动本地服务，默认地址为 http://127.0.0.1:9188/。
4. PNG 导出需系统安装 Microsoft Edge 或 Google Chrome；矢量 SVG 和数据导入不依赖浏览器。

此启动脚本调用归档内 launch.py/server.py 并使用系统 Python，不依赖原工作区的 bundled Python、临时上传目录或 Codex 私有 runtime。归档的历史源码与图件作为历史记录保留；当前 EXE 适配只新增运行目录路由，未改输入校验与几何计算，也未重写历史图件。

路径与排除说明
- 绘图源码按 __file__ 定位模板、生成目录和 Web 文件，不依赖原工作区图片的绝对路径。原始 XLS/XLSX 与照片由仓库根目录“地质资料/”提供。
- 测试脚本 tests_importer.py、integration_checks.py 的旧版 XLS 测试样例固定指向 D:\天气地图\地质资料\实测地层剖面登记表.xls；迁移到其他仓库位置时，只需把测试样例路径改为新仓库根目录下对应文件。应用导入流程接收用户选择的文件路径，不使用这条测试路径。
- tools/Start-CodexProxyAware.ps1、Restart-CodexProxyAware.ps1、Watch-CodexProxyAware.ps1 是 Codex 系统代理诊断脚本，与地质绘图无关。
- output/codex-update-20261005 是 Codex 桌面安装包，与地质项目无关。以上项目均未复制进本目录。


历史成果说明
- generator-v1/generated/ 与 generator-v1/outputs/ 中包含本项目全部已保留的地质生成轮次，包括 before-* 预处理快照、review 子目录、每次 normalized 数据、manifest、SVG、PNG 和 HTML 附表。它们作为历史证据保留；带 before/日期/哈希目录名的快照不代表当前输入或当前成果。
- 目前主参考剖面成果位于 generator-v1/generated/pm01-canonical/，钻孔最终示例位于 generator-v1/generated/drill-final-20261007/。读取任何历史数据前，先按目录名和其 manifest 确认它对应的来源与轮次，不用旧 normalized 数据覆盖新输入。
- review-evidence/ 保存完整结构的 JSON 审查结果、稳定的 PNG 视觉证明和 v2 acceptance SVG/HTML/审计；其中 v2-acceptance-render.json 只把本机绝对渲染路径改写为仓库内 review-evidence 相对路径，保留 JSON 字段结构与审查数据。源工作区文件保持不变。
- 主生成流程用 openpyxl 读取 XLSX、用 xlrd 读取旧 XLS；PNG 由 Microsoft Edge/Google Chrome 的无头栅格化生成，不要求 Pillow。verify_standard_import_v2.py 的可选字体/图像核验会导入 Pillow，执行该核验时另需安装 `Pillow`。
- make_standard_templates.mjs 是从原工作区根目录原样归档的模板构建源文件；运行它需要 Node.js 与 `@oai/artifact-tool`，并要求原工作区的相对 `output/geology-generator-v1/` 布局。此归档保留它作为源代码和审计记录，不包含 Node `node_modules`；已生成的模板与填写示例可直接使用。
