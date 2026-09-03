# 发布安装工程

发布物分为两部分，符合已确认的安装方式：

1. `plugin/*.ccx`：由 Adobe UXP Developer Tool 对 `installer/stage/plugin/manifest.json` 打包；用户双击后由 Creative Cloud Desktop 安装。
2. `SAM31-Backend-Windows-x64.exe` 与同目录数据分片：由 Inno Setup 6 编译 `SAM31PhotoshopSelection.iss`；安装独立 Python/CUDA/PyTorch、官方 SAM 3.1 代码、固定模型和图像处理器脚本。

后端安装器允许自定义目录，并在 `%PROGRAMDATA%\FR\SAM31 Photoshop Selection\runtime-v1.ini` 写入仅含相对组件路径的机器级配置。UXP Hybrid Addon 与 ExtendScript 都读取该配置；发布构建禁用开发路径回退，因此最终用户无需 ComfyUI、系统 Python 或开发工具。

## 构建

在仓库根目录运行（示例路径仅适用于当前开发机）：

```powershell
.\installer\Prepare-Release.ps1 `
  -RuntimePython 'C:\FR_comfyui\python\python.exe' `
  -HybridSdkRoot '.\work\adobe-uxp-hybrid-sdk-6.5.0' `
  -PluginId '<Adobe Developer Distribution ID>' `
  -Version '0.1.0' `
  -PublicRelease
```

脚本从已审计的 Python 环境按发行版依赖闭包复制最小运行时，不复制 ComfyUI 根目录或 custom nodes，并生成 Python 包版本/许可清单和逐文件 SHA-256。随后：

- 在 UXP Developer Tool 中添加 `installer/stage/plugin/manifest.json`，选择 Package 输出 `.ccx`。
- 用 Inno Setup 6 编译 `installer/SAM31PhotoshopSelection.iss`。
- 对 Windows 安装程序签名；`.ccx` 按 Adobe 官方流程打包。

## 当前候选产物（不是公开发布包）

- `stage/release-manifest.json`：19,860 个暂存文件、总计 6,897,249,406 字节，每个文件含 SHA-256；清单不自包含，避免不可验证的自引用哈希。
- `stage/payload/licenses/python-runtime-manifest.json`：35 个 Python 发行版及版本/许可文件清单；不记录开发机绝对路径。
- clean build 排除 `.pyc/__pycache__`，并在模型预检期间禁止写字节码；当前暂存中缓存数为 0，二进制扫描不含 ComfyUI 或项目盘路径。
- `dist/ccx/com.fr.sam31-selection.dev_PS.ccx`：Adobe UXP Developer Tools 验证并打包成功，86,577 字节，SHA-256 `A76030204A2F85608BF8C1D4F37A7657A351E2DC7CC38A411E526F32C5F70B0B`；包内 18 个文件与最终插件暂存目录逐字节一致。
- `SAM31PhotoshopSelection.iss`：后端安装器工程已完成，但本机尚未安装 Inno Setup，因此 `.exe` 和数据分片尚未编译。

当前 CCX 使用 `.dev` ID，只允许内部工程测试。`-PublicRelease` 会拒绝 `.dev` ID，避免误把它标为正式公开包。

安装器在复制前用 `nvidia-smi` 要求至少 15360 MiB 报告显存（对应市售 16 GB 级显卡），复制后调用 `sam31_backend.preflight` 校验固定模型哈希、核心 Python 包、CUDA 与显存。

## 尚不能伪造完成的发布 Gate

- 最终 Adobe 插件 ID；
- Inno Setup 与 Windows 代码签名证书；
- 将 nightly PyTorch/CUDA 候选替换成锁定哈希的稳定发行组合；
- 第三方许可人工复核；
- 干净 Windows 10/11、Photoshop 2025/2026、16 GB GPU 实机安装验收；
- 1000 张稳定性和公开包恶意软件误报检查。

模型及官方 SAM 代码再分发必须附带 `SAM-LICENSE.txt`。生成的 Python 许可目录仍需发布负责人审核，自动收集不能替代法务结论。
