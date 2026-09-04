# 安装、卸载与发布

> 适用版本：FR SAM 文本选区 0.9.1 Pre-release
>
> 更新日期：2026-09-04

## 最终用户安装

先确认 Windows 10/11、Photoshop 2025 或 2026、NVIDIA 驱动和至少 16 GB 显存，并准备足够磁盘空间。首次安装需要联网下载固定 Python/CUDA 运行时；如果选择下载模型，还需要额外下载约 1.75 GB。

1. 运行 FR-SAM-Text-Selection-Backend-0.9.1-Windows-x64.exe。
2. 选择模型来源：
   - 复用已有 sam3.1_multiplex_fp16.safetensors：安装器校验 SHA-256 后直接引用，不复制、不在卸载时删除。
   - 下载固定模型：从 Comfy-Org 固定地址下载并校验，默认在卸载时保留，可由用户选择删除。
3. 等待安装器完成 GPU 检查、稳定运行时安装和强制离线自检。
4. 双击 com.fangrui.sam-selection_PS.ccx，通过 Creative Cloud Desktop 安装。
5. 重启 Photoshop，在“增效工具 > FR SAM 文本选区”打开面板。
6. 将面板拖到右侧竖向图标栏。固定位置属于 Photoshop 工作区状态，用户只需手动停靠一次。

安装位置：

- 程序：%LOCALAPPDATA%\Programs\FR\FR SAM Text Selection
- 配置与日志：%LOCALAPPDATA%\FR\FR SAM Text Selection
- 图像处理器桥：%APPDATA%\Adobe\Adobe Photoshop 2025 或 2026\Presets\Scripts

日常推理不联网，不要求 ComfyUI、系统 Python或开发工具。

## 卸载和诊断

从 Windows“已安装的应用”卸载后端，再从 Creative Cloud Desktop 卸载 CCX。卸载器删除运行时配置和诊断日志；引用的外部模型永不删除。安装器下载的模型默认保留，卸载时会询问是否一并删除。

诊断日志位于 LocalAppData 数据目录的 Logs 子目录，单文件上限 512 KiB，最多 3 个。日志只包含版本、阶段、耗时和有限错误类别，不包含提示词、图像、完整源文件路径、会话令牌或认证头。

## 源码构建

1. 运行 installer/Prepare-PublicRelease.ps1，校验正式 ID、官方 SAM 提交、依赖锁和发布扫描，构建 Release Addon 并生成 installer/stage。
2. 使用 Adobe UXP Developer Tool 校验并打包 installer/stage/plugin/manifest.json；产物名为 com.fangrui.sam-selection_PS.ccx。
3. 使用 Inno Setup 6 编译 installer/FRSAMTextSelection.iss。
4. 对 EXE、CCX 和清单生成 SHA-256，写入 SHA256SUMS.txt。
5. 运行单元、原生、离线预检、真实模型、压力和 Photoshop 回归。
6. 提交并推送源码，创建 GitHub v0.9.1 Pre-release，上传两个安装包和校验文件。

发布暂存不包含模型、开发机 Python、ComfyUI、自定义节点、开发绝对路径、会话文件或测试图片。Windows 安装器是小型联网引导程序，固定所有下载 URL、版本和哈希；安装完成后后端设置离线环境变量。

## 许可证

仓库代码为 MIT。Meta SAM 3.1 源码和模型权重受其独立许可证约束；Python 包受各自许可证约束。发布包包含 LICENSE、THIRD_PARTY_NOTICES 和 Meta SAM LICENSE。预发布前的自动清单和人工检查不能替代使用者自身的法律评估。

## 已知限制

- 当前包未签名，Windows SmartScreen 或 Adobe 可能显示来源警告。
- Photoshop 2025、Windows 10 和恰好 16 GB GPU 未在当前开发机同配置实测。
- 原生 Photoshop Batch 遇到插件错误时可能显示两级宿主确认框；这由 Photoshop 控制。
