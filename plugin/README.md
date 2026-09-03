# SAM 3.1 Photoshop UXP Hybrid 插件

这是正式插件源码，已在 Photoshop 2026 27.10 中接通正式 SAM 3.1 后端。Adobe UXP Developer Tools 已将配置型 Release 暂存成功打成内部测试 CCX，但它仍不是公开发布包：当前 ID 为 `com.fr.sam31-selection.dev`，尚未取得最终 Adobe Distribution ID。

- `manifest.json` 使用 Manifest v6，并加载 `win/x64/sam31-supervisor.uxpaddon`。
- 面板和 Action 双入口共用版本化参数、协议校验与协调器；Action 重放使用动作内冻结参数。
- Photoshop 图像事务分为短捕获模态、模态外推理和短提交模态，使运行中取消可用。
- 普通 RGB/RGBA 活动层、智能对象、原选区严格 ROI 和最终 GRAY8 选区写回已在 Photoshop 2026 真机通过。
- 取消令牌在读取响应、读取掩码和最终 `putSelection` 前均有守卫；失败、取消或空掩码不会覆盖原选区。
- 根级插件图标与 panel 图标均按 Photoshop 主题提供 23/46 px PNG，已通过 UXP 打包校验。
- Release Addon 只读取机器级运行时配置；开发 Addon 可保留本机回退供源码调试。发布版由 Windows 安装器提供独立运行时。

内部候选：`installer/dist/ccx/com.fr.sam31-selection.dev_PS.ccx`。它与源码开发插件使用相同 ID，不应在同一 Photoshop 配置中同时安装/加载。

## 静态测试

```powershell
node --test .\plugin\tests\pure.test.js .\plugin\tests\coordinator.test.js
node --check .\plugin\index.js
```
