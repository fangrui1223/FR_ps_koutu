# SAM 3.1 Photoshop 文本选区：安装、使用与发布说明

> 状态：内部工程候选，非公开发布包  
> 版本：0.1.0-dev  
> 更新日期：2026-09-03

## 1. 两个安装包

V1 按已确认方案分为两个安装包：

1. UXP Hybrid 插件 `.ccx`：面板、动作入口和原生 Supervisor Addon。
2. Windows 后端安装程序：独立 Python/CUDA/PyTorch、Meta SAM 3.1 源码、固定权重、机器级配置和图像处理器桥。

建议安装顺序是先装 Windows 后端，再装 `.ccx`，然后重启 Photoshop。后端安装程序需要管理员权限，因为它会写入 `%PROGRAMDATA%` 并把图像处理器脚本复制到已安装的 Photoshop 2025/2026 `Presets\Scripts`。

当前只生成了内部 CCX：`installer/dist/ccx/com.fr.sam31-selection.dev_PS.ccx`。Windows 安装器工程已完成，但可执行安装包尚未编译、签名；因此当前候选不应交给普通最终用户安装。

## 2. 单张图片

1. 在 Photoshop 打开 RGB 8 位文档，选中一个普通像素图层或智能对象。
2. 如已有选区，它会成为严格搜索范围；最终选区不会越出原选区。
3. 打开“插件 > SAM 3.1 文本选区”。
4. 输入英文提示词。支持短语和最多 5 个逗号候选，例如 `black leather jacket, pants`。
5. 调整最低置信度，默认 `0.50`，然后单击“生成选区”。

插件只读活动图层自身像素，忽略下方图层的混合结果。成功时只替换当前选区；后续羽化、选择并遮住、蒙版和其他处理由 Photoshop 动作继续执行。

## 3. 动作、批处理和脚本

常规动作、Photoshop“文件 > 自动 > 批处理”和 `.psjs` 使用 UXP 动作步骤：

1. 在动作面板开始录制。
2. 在插件面板设定提示词与阈值，单击“执行并录入动作”。
3. 等待选区成功后停止录制，并在其后追加需要的 Photoshop 命令。
4. 同一批次的每张图片都使用动作中保存的提示词；换提示词时修改或重新录制该动作步骤。

`.psjs` 只负责播放已录制动作，示例见 `tests/photoshop/run-recorded-action.psjs`。插件必须已安装并由 Photoshop 加载。

无对象或低于阈值时，插件保留原选区并向 Photoshop 抛错。Photoshop 2026 的“因错误而停止”会显示两级宿主确认框，必须两次选择“停止”才会结束队列；插件无法让这些宿主对话框静默自动确认。

## 4. 图像处理器

原生“文件 > 脚本 > 图像处理器”不能直接使用纯 UXP 动作：Photoshop 的同步 ExtendScript `doAction()` 会阻塞 UXP 的 Imaging/DOM 调用。这里使用安装器部署的 `SAM 3.1 图像处理器桥接`：

1. 在动作面板开始录制。
2. 运行“文件 > 脚本 > SAM 3.1 图像处理器桥接”。
3. 首次录制时输入英文提示词和阈值，完成后停止录制。
4. 在图像处理器的“运行动作”中选择这个兼容动作。

提示词和阈值保存在动作步骤中，批次重放不再弹窗。该桥仍只读活动层，复用相同本地模型、Top-1、严格 ROI 和失败语义。

## 5. 离线与生命周期

- 运行时只绑定 `127.0.0.1`，请求使用随机 256-bit 会话令牌。
- 第一次使用按需启动模型；连续任务复用进程；空闲或 Photoshop 退出后结束。
- 技术故障自动重启后端并重试同一请求一次；第二次失败立即抛回 Photoshop。
- 安装后不需要 ComfyUI、系统 Python 或互联网连接。
- V1 不写持久运行日志，只保留当前请求所需的临时会话文件并在完成后清理。

## 6. 当前内部候选

| 项目 | 状态 |
|---|---|
| CCX | 已由 UXP Developer Tools 验证并打包；`.dev` ID，仅内部测试 |
| 独立后端负载 | 已生成；19,842 个文件，6,897,065,303 字节（约 6.423 GiB） |
| 完整模型/GPU 预检 | RTX 5090 通过 |
| 不依赖 ComfyUI 的正式推理 | clean build 通过；冷 11.212 s、热 0.194 s（1024×1536 夹具） |
| Windows 安装器源码 | 已完成 |
| Windows 安装器 EXE/签名 | 未完成 |
| 公开发布 | 禁止；尚未满足发布 Gate |

内部 CCX 与源码开发插件使用相同 ID，不能在同一 Photoshop 配置中同时安装/加载。开发机应继续由 UXP Developer Tools 加载 `plugin/manifest.json`。

## 7. 发布构建流程

1. 取得最终 Adobe Developer Distribution ID，并替换 `.dev` ID。
2. 把 nightly PyTorch/CUDA 候选替换为锁定版本及文件哈希的稳定组合。
3. 运行 `installer/Prepare-Release.ps1 -PublicRelease`，完成 Release Addon、独立运行时、模型预检和逐文件哈希清单。
4. 用 Adobe UXP Developer Tools 对 `installer/stage/plugin/manifest.json` 执行 Package，生成 `.ccx`。
5. 用 Inno Setup 6 编译 `installer/SAM31PhotoshopSelection.iss`，得到后端安装程序及分片。
6. 完成 Windows 代码签名、恶意软件误报检查和第三方许可人工复核。
7. 在干净 Windows 10/11、Photoshop 2025/2026 与最低 16 GB NVIDIA GPU 上执行安装/升级/卸载及离线验收。
8. 完成 4000×6000 端到端 P95、8000×12000、完整 A–F 和 1000 张长跑后，方可公开分发。

当前候选 CCX 的 SHA-256 为 `A76030204A2F85608BF8C1D4F37A7657A351E2DC7CC38A411E526F32C5F70B0B`。发布 ID、版本或任一文件变化后必须重新生成并公布哈希。
