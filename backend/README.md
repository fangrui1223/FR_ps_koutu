# SAM 3.1 Local Backend

正式 Windows 本地后端。当前包含版本化协议、严格输入/路径校验、回环 HTTP 服务、幂等缓存、父进程/空闲退出、可测试的 Alpha 代理适配器，以及基于 Meta 官方 `facebookresearch/sam3` 源码的 SAM 3.1 适配器。

Alpha 代理适配器把输入 RGBA 的 Alpha 与 Photoshop ROI 相乘，仅用于自动化传输测试，不进入发布构建。正式适配器不会导入 ComfyUI。`installer/stage/payload` 已生成独立候选运行时：Python 3.10.11、35 个发行版依赖、Meta 官方源码和固定模型均位于安装负载内；完整 GPU/模型预检和正式冷/热推理已经在 RTX 5090 上通过。

## 开发自检

```powershell
Set-Location backend
C:\FR_comfyui\python\python.exe -m unittest discover -s tests -v
```

服务命令行要求 32 字节以上令牌文件和会话根目录。令牌文件读取后立即删除：

```powershell
python -m sam31_backend.server `
  --port 0 `
  --session-root <plugin-temp-root> `
  --token-file <restricted-token-file> `
  --ready-file backend-ready.json `
  --parent-pid <Photoshop-PID> `
  --idle-seconds 120 `
  --mock-alpha
```

正式适配器开发启动还需：

```powershell
python -m sam31_backend.server `
  --port 0 `
  --session-root <plugin-temp-root> `
  --token-file <restricted-token-file> `
  --ready-file backend-ready.json `
  --parent-pid <Photoshop-PID> `
  --idle-seconds 120 `
  --model-checkpoint ..\models\sam3.1_multiplex_fp16.safetensors `
  --official-sam3-root ..\work\sam3-official
```

正式安装包会自带 Python/CUDA/PyTorch 运行时，最终用户不需要安装 Python 或启动 ComfyUI。当前候选运行时使用 `torch 2.11.0.dev20260112+cu128`，只用于工程验证；公开发布前必须改为可重建、锁定哈希并完成许可复核的稳定 PyTorch/CUDA 组合。
