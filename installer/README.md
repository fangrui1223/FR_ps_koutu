# 发布安装工程

- Prepare-PublicRelease.ps1：固定正式 ID 和版本，校验官方 SAM 提交，构建 Release Addon，生成不含开发机路径的 stage。
- FRSAMTextSelection.iss：Inno Setup 6 当前用户安装器。
- runtime-requirements.txt：稳定推理依赖锁。
- tools/Install-OnlineRuntime.ps1：下载并校验 CPython、pip、PyTorch/CUDA 和可选模型，随后离线预检。

后端配置位于 %LOCALAPPDATA%\FR\FR SAM Text Selection\runtime-v2.ini。安装器不要求管理员权限，不依赖 ComfyUI 或系统 Python。CCX 从 stage/plugin/manifest.json 使用 Adobe UXP Developer Tool 打包。

正式发布资产为：

- FR-SAM-Text-Selection-Backend-0.9.0-Windows-x64.exe
- com.fangrui.sam-selection_PS.ccx
- SHA256SUMS.txt

早期离线大包原型已移除，避免误用旧 ID、开发运行时或机器级配置。
