# FR SAM 文本选区 v0.9.0 Pre-release

这是第一个可安装的公开预发布版。请先安装 Windows 后端，再安装 Photoshop CCX 插件。

## 下载文件

- FR-SAM-Text-Selection-Backend-0.9.0-Windows-x64.exe
- com.fangrui.sam-selection_PS.ccx
- SHA256SUMS.txt

## 重要说明

- 仅支持 Windows 10/11、Photoshop 2025/2026、NVIDIA 显卡，最低要求 16 GB 显存。
- 安装器和 CCX 当前未做商业代码签名，Windows/Adobe 可能显示来源警告。
- 提示词只支持英文；界面为中文。
- 无对象时插件抛错并保留原选区。Photoshop Batch 可能显示宿主的“继续/停止”对话框。
- 软边来自 SAM 3.1 概率掩码，不是专用 alpha matting；毛发、薄纱和半透明质量不作专业级保证。
- Photoshop 2025、Windows 10、恰好 16 GB GPU 未在当前机器同配置实测，因此本版本标记为 Pre-release。
- 最终安装版后端已连续处理 20 张真实大图，20/20 成功；由于桌面控制器故障，本轮没有重新执行 Photoshop 内的 20 图 UI 批处理。

## English summary

This is the first installable public pre-release. Install the Windows backend before the Photoshop CCX. It is Windows-only, requires Photoshop 2025/2026 and an NVIDIA GPU with at least 16 GB VRAM, and becomes fully offline after setup. The UI is Chinese and prompts are English-only. Packages are currently unsigned.
