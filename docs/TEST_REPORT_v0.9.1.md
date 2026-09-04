# v0.9.1 发布测试报告

> 状态：候选包已构建并安装；等待 Photoshop 重启后的最终 UI 验证

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
| Adobe UPIA CCX 安装 | Enabled，FR SAM 文本选区 0.9.1 |
| Photoshop 内真实图片运行 | 等待 Photoshop 完整重启后验证 |

## 结论

正式候选安装包和 CCX 已生成并安装。由于 Photoshop 必须完整重启才能卸载旧的 0.9.0 原生 Addon，且本轮电脑控制内核连续异常退出，为避免关闭未保存文档，最终 Photoshop UI 验证与 GitHub 发布暂缓。
