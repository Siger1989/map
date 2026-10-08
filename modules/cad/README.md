# CAD 模块

## 合同

`decodeCad`读取DWG或ASCII DXF，返回图层、支持的几何、实体属性、单位信息、显式坐标系提示和告警；`projectCad`按用户确认的轴序、单位比例及源/工程CRS转换为地图WGS84参考几何；原文件及工程CRS/放置信息由CAD存储层保留。CAD叠加层只绘制可见文档，不接管地图点击、绘图手势或镜头。

CAD参考几何在地图侧以WGS84表示。文件有可信显式CRS时可据此识别；缺失或未知时必须由用户选择源CRS，不根据坐标数值猜测。北京54、西安80若未提供经核实的基准转换参数，禁止跨datum转换，不得假定为WGS84。2D投影转换保留原Z值，不执行垂直基准转换；因此不能将结果宣传为测绘精度成果。

## 支持范围与资源限制

当前解码覆盖常见点、线、面、文字及部分块/弧线实体，不是完整CAD渲染器或往返编辑器。二进制DXF、非默认OCS等不支持情形会拒绝、告警或跳过；带内洞的面不能无损转成业务区域，应保留为CAD参考图层。单文件上限20 MiB、每份文档图元20,000、顶点100,000、块引用深度8。超限或无效输入不得静默截断覆盖存档。

## 许可

DWG运行时依赖 `@mlightcad/libredwg-web` 0.7.4 及其LibreDWG WebAssembly解码器，按GNU GPL v3授权。随运行时提供的声明、对应源码链接和完整许可文本见 [`public/cad-runtime/NOTICE.txt`](../../public/cad-runtime/NOTICE.txt) 与 [`public/cad-runtime/LICENSE-GPL-3.0.txt`](../../public/cad-runtime/LICENSE-GPL-3.0.txt)。本模块代码与该第三方运行时的许可范围应分别判断；分发或修改运行时须遵守GPL义务，不能仅凭本说明推定整个应用的许可结论。
