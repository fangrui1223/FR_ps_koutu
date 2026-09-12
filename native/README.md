# Windows Hybrid Addon

sam31-supervisor.uxpaddon 使用 Adobe UXP Hybrid Plugin SDK v6.5.0。它通过 CreateProcessW、CREATE_NO_WINDOW、Job Object、随机 256-bit 令牌和 127.0.0.1 HTTP 管理外部后端；技术故障自动重启并只重试一次。

Release 构建关闭 Mock 和开发路径回退，只读取 %LOCALAPPDATA%\FR\FR SAM Text Selection\runtime-v2.ini，并校验解析后的路径不会越出安装根目录。CUDA 与模型始终在 Photoshop 进程外加载。

Release CTest 包含运行时配置解析和 supervisor 正式后端启动冒烟测试。

`fr-sam-legacy-launcher.exe` 为旧 ExtendScript/图像处理器提供无窗口入口：GUI 子系统、静态 C++ 运行库，安装于后端 `bin`。脚本通过 `File.execute()` 启动，只认领当前用户 Temp/sam31-selection-legacy 下最近两分钟的固定命名 ready 请求。路径与命令不可由 ready 文件指定；运行时解析复用 `runtime_config.cpp`，固定客户端通过 `CreateProcessW(CREATE_NO_WINDOW)` 执行。响应完成标记原子写入，脚本等待后再继续动作。

取消标记或最长 25 分钟等待会终止本次短命桥接客户端；这不是常驻服务，也不替代后端的闲置退出策略。原生 launcher 测试使用 mock 子程序验证中文路径、控制台缺失、退出错误、取消和完成通知，不加载 CUDA。
