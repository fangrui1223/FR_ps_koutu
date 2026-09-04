# v0.9.0 发布测试报告

> 日期：2026-09-04

## 结果摘要

| 项目 | 结果 |
|---|---|
| Python 后端单元测试 | 10/10 通过 |
| UXP 纯逻辑与协调器套件 | 9/9 通过 |
| Release 原生 Addon CTest | 2/2 通过 |
| 最终安装器当前用户安装 | 通过，固定运行时和模型复用完成 |
| 最终安装版强制离线预检 | 通过 |
| 1000 次连续 HTTP 请求 | 1000/1000，通过；3.774 秒 |
| 20 张真实大图连续推理 | 20/20，通过；65.166 秒 |
| CCX 内容 | 18 个文件与发布暂存逐字节一致 |
| Adobe UPIA 安装登记 | Enabled，FR SAM 文本选区 0.9.0 |
| 发布二进制开发路径扫描 | 通过 |

20 图使用最终已安装的稳定运行时、正式 Meta SAM 3.1 适配器、pants, trousers 和阈值 0.50。首张含冷启动约 9.99 秒；其余单张约 1.68–1.97 秒。全部返回 pants、非空灰度软掩码。

## Photoshop 证据

Photoshop 2026 27.10 在前一轮真机回归中已通过：正式模型面板调用、普通像素层、智能对象、严格 ROI、灰度选区、面板取消、动作录入/重放、Batch、PSJS，以及图像处理器桥连续处理 3 张约 39 MP 真实图片。

本轮最终 CCX 已由 Adobe Unified Plugin Installer Agent 成功安装并登记为 Enabled。Photoshop 从 2026-09-03 起一直运行，正式 CCX 需要下次正常重启后加载。为避免丢失用户未保存文档，测试没有强制结束 Photoshop。

Windows 桌面控制器在本轮三次恢复尝试后仍以 windows sandbox failed: helper_unknown_error: setup refresh had errors 退出。因此无法诚实完成“最终安装包重启后，在 Photoshop UI 内重新跑 20 张并拖拽停靠”的最后一轮。已改用最终安装版后端完成 20/20 真实图验证，但两者不能混称。

## 发布资产

- FR-SAM-Text-Selection-Backend-0.9.0-Windows-x64.exe

  SHA-256 E7C65A0593A44AD2B3380B93B734168EB70CFFC2BDA7A81537B40C8D9102EE0F
- com.fangrui.sam-selection_PS.ccx

  SHA-256 2C740D79B1A58DC1094FA31D9198DEB6674CD5E1B4CE526D8889783001A473AB

CCX 遵循 Adobe UXP Developer Tool 使用的 ZIP 容器和文件忽略规则，并通过逐文件验证及 Adobe UPIA 安装验证。由于桌面控制器故障，本轮没有在 UXP Developer Tool 图形界面中再次点击 Package；此前开发候选已在该工具中成功校验和打包。

## 未覆盖环境

- Photoshop 2025
- Windows 10
- 恰好 16 GB 显存的 NVIDIA GPU
- 代码签名后的 SmartScreen/企业部署

上述限制是 v0.9.0 标记为 Pre-release 的原因，发布说明不得把它们写成已实测。
