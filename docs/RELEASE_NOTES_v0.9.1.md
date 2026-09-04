# FR SAM 文本选区 v0.9.1 Pre-release

这是针对 v0.9.0 的运行时定位热修复。请先安装 Windows 后端，再安装 Photoshop CCX 插件，并在安装后重启 Photoshop。

## 修复内容

- 修复后端已经安装但 Photoshop 面板误报“runtime is not installed”的问题。
- 原生 Addon 现在优先使用 Windows Known Folder API 定位当前用户 LocalAppData。
- 后端安装器写入 HKCU 备用配置指针；同时保留环境变量兼容路径。
- 配置定位失败时显示实际检查路径，便于区分配置缺失和访问失败。

## 下载文件

- FR-SAM-Text-Selection-Backend-0.9.1-Windows-x64.exe
- com.fangrui.sam-selection_PS.ccx
- SHA256SUMS.txt

其余功能范围、硬件要求和已知限制与 v0.9.0 相同。安装包目前未做商业代码签名。

## English summary

This hotfix resolves false “runtime is not installed” errors inside Photoshop. Runtime discovery now uses the Windows LocalAppData known folder, an installer-owned HKCU pointer, and compatibility fallbacks. Reinstall both packages and restart Photoshop.
