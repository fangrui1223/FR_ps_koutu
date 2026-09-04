# SAM 3.1 Local Backend

独立 Windows 本地推理服务。它包含版本化协议、严格输入和会话路径校验、仅回环 HTTP、幂等缓存、父进程与空闲退出、测试适配器，以及基于 Meta 官方 SAM 3.1 源码的正式适配器。

正式运行时使用 CPython 3.10.11 embedded、PyTorch 2.10.0+cu128、torchvision 0.25.0+cu128 和锁定依赖，不导入 ComfyUI。Alpha 测试适配器只用于自动化传输测试，不进入 Release Addon。

开发自检：

    cd backend
    python -m unittest discover -s tests -v

服务要求至少 32 字节会话令牌、受限会话根目录和父 Photoshop PID。令牌文件读取后立即删除。正式安装程序提供完整运行时，最终用户无需安装 Python。
