# Windows Hybrid Addon

sam31-supervisor.uxpaddon 使用 Adobe UXP Hybrid Plugin SDK v6.5.0。它通过 CreateProcessW、CREATE_NO_WINDOW、Job Object、随机 256-bit 令牌和 127.0.0.1 HTTP 管理外部后端；技术故障自动重启并只重试一次。

Release 构建关闭 Mock 和开发路径回退，只读取 %LOCALAPPDATA%\FR\FR SAM Text Selection\runtime-v2.ini，并校验解析后的路径不会越出安装根目录。CUDA 与模型始终在 Photoshop 进程外加载。

Release CTest 包含运行时配置解析和 supervisor 正式后端启动冒烟测试。
