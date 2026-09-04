# Changelog

## 0.9.1 — 2026-09-04

- Fixed false “runtime is not installed” errors inside Photoshop by resolving LocalAppData with the Windows Known Folder API.
- Added an installer-owned HKCU runtime configuration pointer and retained environment-based compatibility fallbacks.
- Runtime discovery failures now report the paths that were checked instead of showing a generic installation error.

## 0.9.1 — 中文摘要

- 修复 Photoshop 内误报“运行时未安装”的问题，改用 Windows Known Folder API 定位 LocalAppData。
- 安装器增加当前用户注册表备用定位键，并保留环境变量兼容路径。
- 找不到运行时时显示实际检查路径，不再只显示笼统英文错误。

## 0.9.0 — 2026-09-04

- Renamed the product to FR SAM 文本选区 and froze plugin ID com.fangrui.sam-selection.
- Added a Photoshop 2025/2026 Manifest v6 hybrid UXP panel and recordable action command.
- Added an independent, on-demand local SAM 3.1 backend with one automatic restart/retry and idle shutdown.
- Added active-layer capture for pixel layers and Smart Objects, strict existing-selection ROI, global Top-1 prompt/object selection, and soft grayscale selection output.
- Added the optimized ExtendScript Image Processor bridge with fewer active-document switches and a hidden mask-import transaction.
- Added current-user Windows installer, fixed stable CUDA runtime, optional verified model download/reuse, NVIDIA 16 GB preflight, and offline post-install validation.
- Added privacy-limited rotating diagnostics, a 1000-request stress harness, release staging, checksums, third-party notices, and bilingual release documentation.

## 0.9.0 — 中文摘要

- 正式名称改为 FR SAM 文本选区，插件 ID 固定为 com.fangrui.sam-selection。
- 完成 Photoshop 2025/2026 Hybrid UXP 面板、可录制动作、活动图层与智能对象、严格 ROI、全局 Top-1 和灰度软选区。
- 完成按需启动的独立离线后端、技术失败一次重启重试、空闲退出，以及图像处理器兼容桥。
- 完成当前用户级 Windows 安装器、固定稳定 CUDA 运行时、已有模型复用/校验下载、16 GB 显存预检和离线自检。
