# 安装、卸载与发布

> 适用版本：FR SAM 文本选区 0.9.3 Pre-release
>
> 更新日期：2026-09-12

## 最终用户安装

先确认 Windows 10/11、Photoshop 2025 或 2026、NVIDIA 驱动和至少 16 GB 显存，并准备足够磁盘空间。首次安装需要联网下载固定 Python/CUDA 运行时；如果选择下载模型，还需要额外下载约 1.75 GB。

1. 运行 FR-SAM-Text-Selection-Backend-0.9.3-Windows-x64.exe。升级前等待任务结束，建议退出 Photoshop。
2. 选择模型来源：
   - 复用已有 sam3.1_multiplex_fp16.safetensors：安装器校验 SHA-256 后直接引用，不复制、不在卸载时删除。
   - 下载固定模型：从 Comfy-Org 固定地址下载并校验，默认在卸载时保留，可由用户选择删除。
3. 等待安装器完成 GPU 检查、稳定运行时安装和强制离线自检。
4. 双击 com.fangrui.sam-selection_PS.ccx，通过 Creative Cloud Desktop 安装。
   安装或更新时需同意本机文件系统访问权限。该权限用于读取配套 Windows 后端的固定配置、启动离线运行时并交换临时图像数据，不会上传图片。
5. 重启 Photoshop，在“增效工具 > FR SAM 文本选区”打开面板。
6. 将面板拖到右侧竖向图标栏。固定位置属于 Photoshop 工作区状态，用户只需手动停靠一次。

安装位置：

- 程序：%LOCALAPPDATA%\Programs\FR\FR SAM Text Selection
- 配置与日志：%LOCALAPPDATA%\FR\FR SAM Text Selection
- 图像处理器桥：%APPDATA%\Adobe\Adobe Photoshop 2025 或 2026\Presets\Scripts

日常推理不联网，不要求 ComfyUI、系统 Python或开发工具。

### 配置报错和同版本残留

0.9.2 排查确认：运行时配置存在并不表示插件有权读取它；实际安装目录的 Manifest 也必须包含 `localFileSystem: fullAccess`。仅检查源码或只看到 Adobe 安装器的“成功”提示不够。本机复现过同版本重复安装返回成功，但已安装文件仍为旧内容。

如果升级后面板版本/界面仍不对，保存图片并退出 Photoshop，在 Creative Cloud 中只卸载“FR SAM 文本选区”，重新安装新 CCX 后重启。无需删除模型、后端数据或 Photoshop 动作；如果工作区停靠位置丢失，重新拖入图标栏即可。不要手工改 Program Files 下的 manifest 来绕过安装权限确认。

运行时升级先在 `runtime.new` 准备 Python 并校验模型、依赖和离线预检，通过后才替换 `runtime`；配置使用临时文件原子替换并保留一份 `.previous`。这是运行时切换保护，不是对整个 Inno 安装过程的完整事务回滚。安装失败仍需检查日志并重试。

### 安装工具能看到配置，但 Photoshop 仍提示未安装

2026-09-12 本机发现另一类情况：终端能读取配置，但普通资源管理器和实际 Photoshop 进程均看不到配置父目录。它与“模型未匹配到对象”无关，不能以全选画布掩盖。不能仅凭 `Test-Path` 或安装日志判断已修复。

排查必须在实际 Photoshop 宿主中核对 `%LOCALAPPDATA%/FR/FR SAM Text Selection/runtime-v2.ini` 的存在和可读性，再检查配置指向的 Python、后端及模型。若配置存在但无权访问，不要盲目覆盖、修改系统安全设置或扩大权限。

本仓库提供维护用 `installer/tools/Repair-PhotoshopRuntimeConfig.jsx`：仅对**宿主确认缺失**的配置，读取明确指定、已核对的安装器配置源；先验证运行时和模型在 Photoshop 中可见，再创建当前用户配置目录、复制并重新读取核验。已有配置一律拒绝覆盖。必须在同一次 ExtendScript 执行中设置 `$.global.__frSamRepairConfigSource` 并调用 `$.evalFile`，它不是供用户直接录入动作的脚本，也不是后端安装器的替代品。

维护验收应包括面板真实推理、已安装桥接事件、无对象全选及后续命令，并正常退出/重启 Photoshop 后复验。此次恢复只证明当前机器的配置缺失已修复；不同进程为何看到不同目录仍未定位到系统级原因。详见 [本机恢复记录](RUNTIME_RECOVERY_2026-09-12.md)。

## 卸载和诊断

从 Windows“已安装的应用”卸载后端，再从 Creative Cloud Desktop 卸载 CCX。卸载器删除运行时配置和诊断日志；引用的外部模型永不删除。安装器下载的模型默认保留，卸载时会询问是否一并删除。

诊断日志位于 LocalAppData 数据目录的 Logs 子目录，单文件上限 512 KiB，最多 3 个。日志只包含版本、阶段、耗时和有限错误类别，不包含提示词、图像、完整源文件路径、会话令牌或认证头。

## 源码构建

2026-09-12 维护优化增加 `{app}/bin/fr-sam-legacy-launcher.exe`，新桥接脚本必须与此启动器一起部署。源码暂存构建已覆盖该文件，现有 GitHub 0.9.3 包未原地更新；下次公开发布需要先递增版本。

本机旧动作还引用了 Program Files 下开发期遗留的 `SAM31 Image Processor Bridge.jsx`。仅升级用户目录的正式桥不能保证这些旧动作迁移。维护时须核实实际调用文件，备份后通过正常管理员授权更新其兼容副本，保留 `sam31ImageProcessorBridge` 事件 ID。仓库维护脚本 `installer/tools/Deploy-BatchBridgeUpdate.ps1` 针对已核对的本机 2026 安装；默认检查全部三个入口写权限，`-UserScriptsOnly` 不会修复 Program Files 旧入口。勿修改 ACL 或把维护脚本录入动作。

1. 运行 installer/Prepare-PublicRelease.ps1，校验正式 ID、官方 SAM 提交、依赖锁和发布扫描，构建 Release Addon 并生成 installer/stage。
2. 使用 Adobe UXP Developer Tool 校验并打包 installer/stage/plugin/manifest.json；产物名为 com.fangrui.sam-selection_PS.ccx。
3. 使用 Inno Setup 6 编译 installer/FRSAMTextSelection.iss。
4. 安装后运行 `installer/Test-ReleasePackage.ps1`，同时传入 CCX、`-StagedPluginRoot` 和真实 `-InstalledPluginRoot`。它核验 ID、版本、文件权限及每个文件的内容；Manifest 允许 Adobe 改写 JSON 空白。
5. 在 Photoshop 中运行 `tests/photoshop/check-bridge-syntax.jsx`，使用真实 ExtendScript 编译器验证源码及安装脚本；Node 的 JavaScript 解析器不能代替这一步。
6. 运行单元、原生、离线预检、真实模型、压力和 Photoshop 回归，在报告中区分 Mock 压力测试与真实图片测试。
7. 对最终 EXE、CCX 生成 SHA-256，写入 SHA256SUMS.txt。
8. 提交并推送源码，创建 GitHub v0.9.3 Pre-release，上传两个安装包和校验文件。已发布资产不可原地替换；后续修复增加版本号。

发布暂存不包含模型、开发机 Python、ComfyUI、自定义节点、开发绝对路径、会话文件或测试图片。Windows 安装器是小型联网引导程序，固定所有下载 URL、版本和哈希；安装完成后后端设置离线环境变量。

## 许可证

仓库代码为 MIT。Meta SAM 3.1 源码和模型权重受其独立许可证约束；Python 包受各自许可证约束。发布包包含 LICENSE、THIRD_PARTY_NOTICES 和 Meta SAM LICENSE。预发布前的自动清单和人工检查不能替代使用者自身的法律评估。

## 已知限制

- 当前包未签名，Windows SmartScreen 或 Adobe 可能显示来源警告。
- Photoshop 2025、Windows 10 和恰好 16 GB GPU 未在当前开发机同配置实测。
- 原生 Photoshop Batch 遇到插件错误时可能显示两级宿主确认框；这由 Photoshop 控制。
