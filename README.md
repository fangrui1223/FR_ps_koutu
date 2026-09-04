# FR SAM 文本选区 / FR SAM Text Selection

v0.9.1 是面向 Windows 10/11、Photoshop 2025/2026 的预发布版。插件在中文面板中接收英文文本提示词，只读取当前活动图层，通过本机 SAM 3.1 生成灰度 Photoshop 选区。安装完成后推理完全离线，不要求安装或启动 ComfyUI。

## 主要能力

- 普通像素图层和智能对象；忽略下方图层的混合结果。
- 英文短语或逗号分隔候选词，最多 5 个；返回全局置信度最高的一个对象。
- 原选区作为搜索范围，输出严格裁切在原选区内。
- 输出 0–255 灰度软选区；毛发、薄纱和半透明效果受 SAM 3.1 自身能力限制。
- 面板交互入口与可录制动作入口；动作保存提示词和置信度，适合 Photoshop Batch、脚本和图像处理器。
- 后端按需启动、批次内复用、空闲退出；技术故障自动重启并重试一次。
- 无对象或输入错误会保留原选区并抛错，让 Photoshop 停止或询问如何继续。

## 安装

发布页提供两个文件，建议按顺序安装：

1. FR-SAM-Text-Selection-Backend-0.9.1-Windows-x64.exe
2. com.fangrui.sam-selection_PS.ccx

Windows 后端安装器要求 NVIDIA 显卡及至少 16 GB 显存。它可以引用已有的 sam3.1_multiplex_fp16.safetensors，也可以联网下载并校验固定模型；运行时、依赖和模型准备完成后，日常使用不联网。CCX 采用 Adobe UXP Developer Tool 的标准包格式，通过 Creative Cloud Desktop 安装。

详细步骤见 [安装与发布说明](docs/INSTALLATION_AND_RELEASE.md)，动作和批处理方法见 [Photoshop 批处理兼容性](docs/PHOTOSHOP_BATCH_COMPATIBILITY.md)，完整证据见 [v0.9.1 测试报告](docs/TEST_REPORT_v0.9.1.md)。

## 使用

在 Photoshop 打开“增效工具 > FR SAM 文本选区”。面板可以拖到右侧面板图标栏固定，Photoshop 会随工作区记住位置。

- 单张处理：输入英文提示词，调整最低置信度，点击“生成选区”。
- 录制动作：开始录制 Photoshop 动作后，点击“执行并录入动作”。以后重放使用动作中保存的提示词和阈值。
- 更换批次提示词：修改并重新录制该动作步骤。
- 图像处理器：录制安装器提供的“FR SAM Text Selection Image Processor”脚本步骤；不要在图像处理器中调用普通 UXP 动作步骤。

## 已验证

- Photoshop 2026 27.10：面板、正式 SAM 推理、动作录入/重放、Batch、PSJS、普通像素层、智能对象、严格 ROI、取消和灰度选区写回。
- 独立稳定运行时：PyTorch 2.10.0+cu128、torchvision 0.25.0+cu128、CUDA 12.8；没有 ComfyUI 路径依赖。
- RTX 5090、7647×5100 实图：单图冷启动约 8.15 秒，热请求约 0.88 秒。
- 最终安装版后端连续处理测试文件夹 20 张真实大图：20/20 成功，总计 65.17 秒；首张含冷启动约 9.99 秒，其余约 1.68–1.97 秒。
- 1000 次连续后端请求：1000/1000 成功。
- 原生 Release 构建测试：2/2 通过；Python 后端测试：10/10；UXP 测试套件：9/9。

这是未签名的免费预发布版。Photoshop 2025、Windows 10 和恰好 16 GB 显卡没有在当前开发机上做同配置实机验收；兼容声明来自 API/清单下限与静态测试，问题请在 GitHub Issues 报告。

## 隐私与许可

所有推理均在本机完成。诊断日志只记录错误类别、阶段、版本和耗时，不记录提示词、图像、源文件路径或会话令牌；日志最多保留 3 个轮转文件。

本项目代码使用 [MIT License](LICENSE)。Meta SAM 3.1、模型权重及第三方 Python 依赖适用各自许可证，见 [第三方通知](THIRD_PARTY_NOTICES.md)。模型权重不提交到源码仓库。

---

## English

FR SAM Text Selection is a Windows-only Photoshop 2025/2026 hybrid UXP plugin. It converts English text prompts into a soft Photoshop selection using a local SAM 3.1 backend. Inference is fully offline after setup and does not require ComfyUI.

Install the Windows backend first, then the CCX. The backend requires an NVIDIA GPU with at least 16 GB VRAM and either references an existing supported checkpoint or downloads and verifies the fixed checkpoint. The plugin reads only the active layer, supports pixel layers and Smart Objects, treats an existing selection as a strict ROI, and returns the single highest-confidence object across up to five comma-separated English prompts.

This is a free, unsigned pre-release. Photoshop 2026, an RTX 5090, a 20/20 real-image run through the final installed backend, action replay, the Image Processor bridge, and a 1000-request backend stress run have been exercised. Photoshop 2025, Windows 10, and an exact 16 GB GPU were not available for same-machine validation.
