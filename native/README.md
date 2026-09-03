# Windows Hybrid Addon

这里是正式 `sam31-supervisor.uxpaddon` 的源码与构建落点。项目已使用 Adobe UXP Hybrid Plugin SDK v6.5.0 接通 Manifest v6，并在 Photoshop 2026 27.10 中完成 Mock 与正式 SAM 3.1 真机闭环。

当前实现：

1. SDK 固定在 `work/adobe-uxp-hybrid-sdk-6.5.0/`，原始下载哈希记录在计划书；Adobe SDK 文件不进入最终源码分发包。
2. `src/module.cpp` 按官方 ABI 导出异步 `infer(sessionRootNativePath, requestJson)` 与同步 `cancel(requestId)`。
3. `src/supervisor.cpp` 使用 `CreateProcessW`、`CREATE_NO_WINDOW`、Job Object、BCrypt 256-bit 令牌和 `127.0.0.1` HTTP；技术失败只重启重试一次。
4. `build/` 保留 Mock-alpha 开发构建；`build-release/` 生成正式配置型 Release Addon，CTest 当前为 2/2 通过。
5. `plugin/win/x64/sam31-supervisor.uxpaddon` 用于开发回归；发布暂存使用 `build-release/Release/sam31-supervisor.uxpaddon`。
6. Release 构建关闭 `SAM31_ALLOW_DEV_FALLBACK`，只从 `%PROGRAMDATA%\FR\SAM31 Photoshop Selection\runtime-v1.ini` 解析安装根目录及相对组件路径，并拒绝越出安装根目录的路径。二进制扫描不含开发机 Python、ComfyUI、模型或源码绝对路径。
7. 配置型 Addon 已在指向 `installer/stage/payload` 的临时配置下启动独立后端并完成 Mock 传输；正式模型预检和推理由同一独立负载另行通过。最终用户不需要 ComfyUI。

JS/C++ 契约见 `include/supervisor_contract.h`；HTTP 和文件协议见 `docs/PROTOCOL_V1.md`。
