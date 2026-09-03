# SAM 3.1 Photoshop Selection Plugin

Windows 10/11、Photoshop 2025–2026 本地离线 SAM 3.1 英文文本提示选区插件。

当前状态：四项可行性原型、Photoshop 2026 Hybrid 真机闭环和阶段 3 核心图像事务已经完成。正式 UXP 动作已通过动作面板、原生 Batch 和 `.psjs`；原生“图像处理器”使用随安装器部署的 ExtendScript 兼容动作桥，3 张 7640×5096/5100 真实图片已连续通过。独立运行时候选已从开发 Python 的 35 个发行版依赖闭包生成，不包含 ComfyUI 根目录或 custom nodes；完整模型预检、配置型 Release Addon 到独立后端的 Mock 传输、以及不借助 ComfyUI 的正式冷/热推理均已通过。Adobe UXP Developer Tools 已成功生成内部测试 `.ccx`。

当前仍不是公开发布成品：CCX 使用临时 `.dev` ID，Windows 安装器只有已完成的 Inno Setup 工程、尚未编译/签名；候选运行时还含 nightly PyTorch，必须换成审计并锁定的稳定版本。PS 2025、完整 A–F 夹具、图层蒙版/样式/软 ROI/96 MP UXP、4000×6000 端到端 P95、16 GB 实机和 1000 张长跑也仍是发布 Gate。无对象 Batch 会准确在失败文件报错，但 Photoshop 2026 会显示两级“继续/停止”宿主对话框，所以 V1 不保证错误后的静默无人值守退出。完整计划见 [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md)，安装/发布说明见 [`docs/INSTALLATION_AND_RELEASE.md`](docs/INSTALLATION_AND_RELEASE.md)，批处理验收见 [`docs/PHOTOSHOP_BATCH_COMPATIBILITY.md`](docs/PHOTOSHOP_BATCH_COMPATIBILITY.md)。

## 已完成原型

- `prototypes/action-layer-poc/`：Photoshop Action 参数录入/重放、错误传播、活动图层、智能对象与严格 ROI。
- `prototypes/backend-lifecycle-poc/`：回环鉴权、隐藏启动、崩溃后一次重启重试、空闲退出。
- `prototypes/model-poc/`：固定权重结构、英文多候选全局 Top-1、大图显存与性能策略。

## 已完成产品骨架

- `docs/PROTOCOL_V1.md`：本机回环协议、鉴权、会话文件、错误、幂等和资源限制。
- `plugin/`：中文 UXP 面板、双入口 Action 参数、活动层/ROI 捕获、会话 I/O 与选区提交。
- `backend/`：独立离线服务、路径隔离、生命周期、正式 Meta SAM 3.1 适配器及单元测试。
- `native/`：Adobe Hybrid SDK v6.5.0 Addon；异步推理、按需启动、会话鉴权、健康检查、一次重启重试、取消和空闲退出。
- `legacy/`：仅供 Photoshop 原生“图像处理器”调用的可录制 ExtendScript 桥接；提示词和阈值保存在动作步骤中，后端仍按需启动并空闲退出。

RTX 5090 正式后端热请求实测：4000×6000 约 0.573 秒，8000×12000 约 1.791 秒。Photoshop 2026 的 1024×1536 正式 Hybrid 热调用在 3.111 秒观察窗口内完成；最终 8 秒目标仍必须按 4000×6000 端到端 P95 验收。

面板执行采用短捕获模态、模态外推理和短提交模态；取消由后端中断与前端本地守卫共同保证，即使后端迟到返回成功也不会覆盖原选区。

当前 Photoshop 2026 中仍保留开发桥用于回归；发布暂存中的桥已关闭开发路径回退，只读取 `%PROGRAMDATA%\FR\SAM31 Photoshop Selection\runtime-v1.ini`。正式 Release Addon 同样为配置型构建，二者都不包含开发机 Python、ComfyUI 或源码绝对路径。最终用户不需要安装或启动 ComfyUI。

当前内部 CCX 候选：`installer/dist/ccx/com.fr.sam31-selection.dev_PS.ccx`（86,577 字节，SHA-256 `A76030204A2F85608BF8C1D4F37A7657A351E2DC7CC38A411E526F32C5F70B0B`）。它只包含 UXP/Hybrid 插件，不包含约 6.423 GiB 的独立后端负载；两者按已确认的“双安装包”方式分发。

模型权重位于 `models/`，不应提交到源码仓库或未经许可直接再分发。`model-poc` 中调用 ComfyUI 的脚本仅作为本机参考 oracle，不得复制进正式闭源后端。
