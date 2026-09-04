# v0.9.1 发布测试报告

> 状态：发布候选已完成构建、安装和 Photoshop 实机验证

## 修复目标

v0.9.0 的正式 Addon 在后端已经正确安装时仍可能误报运行时未安装。v0.9.1 改用 Windows Known Folder API，并增加 HKCU 与环境变量备用定位路径。

## 自动化回归

| 项目 | 结果 |
| --- | --- |
| 原生 Release 编译 | 通过 |
| 原生 CTest | 2/2 通过 |
| 后端 pytest | 10/10 通过 |
| UXP 纯逻辑测试 | 通过 |
| 缺失 LOCALAPPDATA 的正式监督器测试 | 通过，成功定位配置并启动正式后端 |
| 正式安装器升级安装 | 通过，后端自报 0.9.1 |
| HKCU 备用配置指针 | 通过，指向 runtime-v2.ini |
| Adobe UXP Developer Tool 打包 | 通过；正式 Manifest v6 包含 `enableAddon` 与 `localFileSystem: fullAccess` |
| CCX SHA-256 | `9BEC0CC1490109DA46796C17E11D16191DAD2543EA4D9828DD2229D8F5747E3A` |
| Adobe UPIA CCX 安装 | Enabled，FR SAM 文本选区 0.9.1 |
| Photoshop 内真实图片运行 | 通过；Photoshop 2026 27.10、RGB/8、7640×5096 活动像素层 |
| 文本提示与选区写回 | 通过；`pants`、阈值 0.50、Top-1 分数 0.863，画布生成裤子选区 |
| 连续请求模型复用 | 通过；同图紧接热请求后端耗时 690.86 ms |

## 结论

正式候选安装包和 CCX 已生成并安装。Photoshop 完整重启后，面板不再误报运行时配置不可访问，正式 SAM 3.1 后端能够启动、完成推理并写回可见选区。本轮两次后端冷启动实测为 9.94 秒和 10.17 秒，连续热请求为 0.69 秒；因此 8 秒仍作为 RTX 5090 的优化目标，而不是每次冷启动的硬性保证。v0.9.1 已满足 Pre-release 发布条件。
