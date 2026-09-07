# v0.9.2 修复与回归报告

日期：2026-09-07。环境：Windows 11、Photoshop 2026 27.10、RTX 5090 32 GB。测试图像留在本机，不随仓库或发布资产上传。

## 本轮确认的问题

1. 运行时配置文件实际存在，但安装目录的旧版 Manifest 缺少 `localFileSystem: fullAccess`。源码/CCX 含权限不代表已安装副本一致；新发布检查必须核验实际安装文件。
2. 官方 UPIA 对同版本 CCX 重装返回成功，但 `index.html` 等文件仍为先前内容。本机经官方 `/remove`、`/install` 后逐文件校验才通过；不把“安装成功”字符串作为验收结论。
3. JSX 中 `// @sam31-release-dev-fallback` 被 ExtendScript 解释为特殊指令，导致语法错误。逐函数编译定位后，将构建标记改为普通注释；源码与已安装桥均通过 Photoshop 自身的编译器验证。Node 语法检查原本能通过，不能覆盖此宿主特例。
4. 面板参数校验位于错误处理之外，输入不合法时可能没有清晰反馈；并发点击、默认命令及动作错误状态处理不统一。
5. 原选区读取失败会被当作“无选区”继续全图搜索；异步推理完成后缺少文档、图层、尺寸和历史状态一致性保护。
6. 后端空闲计时没有排除正在运行的长请求；Windows 父进程句柄未声明 64 位类型；HTTP 空连接可长时间占用线程。
7. 原生后端启动失败位于重试循环之外；工作线程 detached 使插件卸载与推理线程生命周期不明确。
8. 旧桥启动失败漏掉 RuntimeError 重试，健康检查使用过长的推理超时。
9. 升级前过早移走可用 Python；Windows PowerShell 5.1 把 File.Replace 的空备份参数解释为无效路径；Inno 安装后置步骤失败仍可能返回成功退出码。
10. 日志轮转/写入权限失败会向 stderr 重复打印堆栈。改为局部非致命日志处理，不影响选区结果。
11. 旧桥无条件设置 `exportedLayer.grouped = false`，本机宿主会把原本未剪贴的副本切换为剪贴层，隐藏下层后导出全透明 PNG。改为先检查，再仅对已剪贴层解除剪贴。
12. ExtendScript `Document.duplicate` 不保留原选区，旧桥的 ROI 导出因此成为全白 RGB 图。改为用临时 Alpha 通道传递完整灰度选区，并在推理前恢复源文档的活动历史状态、图层及通道。错误不修改原选区；旧宿主内部可能保留临时步骤的重做历史，不承诺历史列表长度完全不变。
13. 掩码置入会受到原选区/可视区域居中与宿主缩放影响。大图回归出现完整掩码平移，严格 ROI 因此越界。置入前取消旧选区，置入后读取智能对象完整画布的变换坐标，显式校正尺寸和原点，再验证坐标；不能使用忽略透明边缘的图层 bounds 对齐。导入出错时恢复原活动历史状态。

对应修复已加入本版：新版本号、文件权限检查、包/安装一致性检查、普通 JSX 构建注释、中文简短状态与可展开详情、输入锁定和取消状态、严格 ROI 失败保护、提交前状态校验、长任务生命周期与重试修复、升级暂存校验和原子配置切换。

## 已完成的自动化与安装检查

| 检查 | 结果与范围 |
| --- | --- |
| Node 插件测试 | 21/21 通过，覆盖协调器、宿主 I/O 模拟、面板错误/重入、清单权限、JSX 构建标记 |
| 插件纯逻辑套件 | PASS |
| Python pytest | 15/15 通过，包含长请求空闲保护、桥接启动重试、父进程检查、日志失败降级 |
| Native Release CTest | 2/2 通过，最终运行 9.72 秒；包含 v1/v2 配置、相对模型路径拒绝、正式后端启动 |
| 1000 请求压力测试 | 1000/1000，3.98 秒；2×2 AlphaProxy 测试适配器，验证本地 HTTP/服务，不是 1000 张真实模型或 Photoshop 图像处理器批量 |
| UDT 正式 CCX 打包 | PASS，Manifest v6、正式 ID、0.9.2、Addon + fullAccess |
| 官方安装后文件检查 | PASS；最终 CCX、发布暂存和实际安装目录相符 |
| 后端安装文件检查 | PASS；最终 EXE 安装退出码 0，后端、vendor、安装助手及 PS 2025/2026 两份桥脚本逐文件与正式载荷一致 |
| 实机 JSX 编译 | PASS；源码及安装脚本均由 Photoshop ExtendScript 编译 |
| 大图掩码坐标往返 | 7637×5094 透明画布，有/无原选区均返回精确预期坐标；注入导入错误后原选区恢复 |

## 真实模型和 Photoshop

独立安装运行时（不是 ComfyUI Python）对测试文件夹 20 张真实大图、提示词 `pants, trousers`、阈值 0.50 连续处理：20/20 成功。总计 69.164 秒；首张请求含模型加载 10.791 秒，其余请求 1.730–2.067 秒。总计还包括图片读取、PNG 输入导出和结果检查，不是 Photoshop 整批耗时，也不代表所有图片的抠图质量均已人工验收。

最终 CCX 在 Photoshop 重启后实测：

- 普通 RGB8 像素层：生成可见裤子灰度选区，Top-1 0.930；首次后端推理 9.796 秒，配置读取报错未再出现。
- 同图测试副本转换智能对象后，原选区限制为 `[2800, 2200, 4200, 4800]`：运行成功，Top-1 0.969，输出边界没有超出原范围；保留一个智能对象图层，没有残留掩码图层。
- 运行期间输入/执行按钮禁用、取消按钮显示；完成后恢复，状态在顶部可见。长详情和使用规则采用显式展开控件，不依赖 UXP 未完整支持的 HTML details 行为。
- 新 Photoshop 进程中实测推理取消：显示“任务已取消，原选区保持不变”，输入和执行按钮恢复；再次点击后成功生成裤子选区，Top-1 0.930，冷后端总推理约 9.719 秒。保留该 QA 副本供现场查看，没有修改两张原图。
- 图像处理器桥接最终安装版：连续三次成功；确实无 `airplane` 候选时抛错且保留原选区、活动历史状态和通道数量；随后 `pants` 成功，边界严格位于 `[2800, 2200, 4200, 4800]` 内，后续 Photoshop 羽化命令可继续运行。没有残留临时文档或图层。回归输出明确记录已安装脚本路径。
- 额外核对安装桥的实际灰度输出：后端 PNG 与 Photoshop 存储选区的非零像素均为 4,952,304，灰度至少 128 的像素均为 3,467,823，255 像素均为 15,224。该样图边缘有灰度 5 的低概率尾部，因此 selection.bounds 可覆盖全画布，不代表整张图片被完全选中；保留模型软概率，不擅自加二值阈值。

所有图像操作在原图的临时 QA 副本上完成；先前面板测试产生的选区未保存到原 JPG。

## 验证边界

- 本轮不是“零 BUG 证明”。Photoshop 2025、Windows 10、恰好 16 GB 显卡未实机测试，96 MP 极限/1000 张真实 Photoshop 全流程未在本轮完整重跑。
- 历史版本已做动作录入/重放、Batch、PSJS 等原型验收；本轮已执行的具体项目以上表和实机记录为准，不把历史证据冒充本轮全矩阵复测。
- 本机 UXP 浮动面板的自动化文本输入焦点不稳定，未把失败的自动化输入尝试计为中文输入实机通过；输入错误状态由 Node 模拟测试验证。
- 在反复混用外部 COM/ExtendScript 调试、历史回退与面板操作的长会话中，出现一次宿主像素读取长期等待，取消不能强制终止该宿主调用。确认原图未修改并关闭后重启 Photoshop；新进程中的推理取消立即完成并恢复控件。旧长会话情况未定为已修复，不把所有宿主等待都归因于 SAM 后端，也不承诺 Photoshop 异常状态下取消一定能即时完成。
- 灰度概率不是物理 alpha matting；毛发、薄纱和半透明质量受 SAM 3.1 限制。无对象时抛错并保留原选区，Photoshop 原生 Batch 的继续/停止弹框由宿主控制。
- 包未商业代码签名，仍为免费 Pre-release。

## 复测入口

```powershell
node --test plugin/tests/coordinator.test.js plugin/tests/host-io.test.js plugin/tests/panel.test.js
node plugin/tests/pure.test.js
python -m pytest backend/tests -q
ctest --test-dir native/build-release -C Release --output-on-failure
```

Python 测试需令 `PYTHONPATH` 指向仓库的 backend；真实模型运行使用安装器部署的独立 Python。发布包核验脚本为 `installer/Test-ReleasePackage.ps1`。Photoshop 脚本编译检查为 `tests/photoshop/check-bridge-syntax.jsx`；连续桥接回归为 `tests/photoshop/installed-bridge-regression.jsx`，只允许操作专门命名的 QA 副本。`tests/photoshop/bridge-mask-placement.jsx` 用已知掩码和不同的全不透明目标图层验证精确坐标及导入失败回滚，避免误读原层透明度造成假通过。

## 发布资产 SHA-256

- Windows EXE：`c7e839480d0970277acb0794d87599a01164ba7df4a6f2b63fe00646ff89ce3d`
- Photoshop CCX：`cc4e2dbc5b7aa72e1924089b325b86d26c1874879371f05eb48558379c7bd72c`

相关官方依据：[Adobe 文件权限声明](https://developer.adobe.com/photoshop/uxp/2022/guides/uxp_guide/uxp-misc/manifest-v5/)、[Hybrid 插件流程](https://developer.adobe.com/photoshop/uxp/2022/guides/hybrid-plugins/getting-started/)、[Photoshop 模态执行与取消](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal)。宿主同版本安装残留及 JSX 标记解析现象来自本机复现，不推断为 Adobe 对所有版本的通用保证。
