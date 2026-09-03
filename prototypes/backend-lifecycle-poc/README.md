# Backend Lifecycle PoC

这个 Windows x64 原型用一个独立 C++ 可执行文件同时模拟 launcher 和后端，验证正式 Hybrid addon 需要复用的进程生命周期逻辑：

- 后端只绑定 `127.0.0.1`；
- 使用 32 字节随机令牌认证；
- `CREATE_NO_WINDOW` 无窗口启动；
- 首次推理崩溃后自动重启并且只重试一次；
- 错误令牌返回 401；
- 空闲超时和父进程退出后结束。

该原型不冒充 Adobe Hybrid addon。将 launcher 入口编译为 `.uxpaddon` 仍需要 Adobe 官方 Hybrid SDK；取得 SDK 后直接复用这里的启动、健康检查和重试状态机。

## 构建与测试

```powershell
& 'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe' -S . -B build -G 'Visual Studio 17 2022' -A x64
& 'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe' --build build --config Release
& '.\build\Release\sam31_lifecycle_poc.exe' --selftest
```

2026-09-01 Release 自检通过：回环监听、32 字节随机令牌、未授权拒绝、模拟崩溃后的唯一一次重启重试，以及空闲退出均为 PASS。
