# SAM 3.1 本地后端协议 v1

> 状态：v0.9.1 冻结协议
>
> 传输：仅 `127.0.0.1` HTTP；每次 Photoshop/插件会话使用独立 256-bit 令牌

## 1. 安全模型

- 后端只能绑定 IPv4 回环地址，不接受 `0.0.0.0`、IPv6 公网或局域网地址。
- Hybrid addon 生成至少 32 字节随机令牌。令牌不写日志；正式实现通过受限临时文件或继承句柄传给后端，读取后立即删除。
- 所有端点都要求 `Authorization: Bearer <token>`。
- 后端启动时固定一个会话根目录。协议中的所有文件名必须是该目录下的相对路径；绝对路径、盘符、`..`、符号链接逃逸一律拒绝。
- 请求 JSON 上限 1 MiB；图像数据不使用 base64。
- 输出先写 `.partial`，成功关闭后再原子替换正式输出文件。

## 2. 端点

### `GET /v1/health`

成功响应：

```json
{
  "status": "ok",
  "protocolVersion": 1,
  "backendVersion": "0.9.1",
  "modelId": "sam3.1-multiplex-fp16",
  "modelReady": false
}
```

### `POST /v1/infer`

请求：

```json
{
  "schemaVersion": 1,
  "requestId": "9f14b0f0-52f4-4b62-a7aa-82c756d2c8bd",
  "modelId": "sam3.1-multiplex-fp16",
  "prompts": ["black leather jacket", "pants"],
  "threshold": 0.5,
  "document": {
    "width": 4000,
    "height": 6000,
    "resolution": 300
  },
  "input": {
    "file": "9f14b0f0-52f4-4b62-a7aa-82c756d2c8bd/input.png",
    "encoding": "png-rgba8",
    "width": 4000,
    "height": 6000,
    "bounds": {"left": 0, "top": 0, "right": 4000, "bottom": 6000}
  },
  "roi": {
    "file": "9f14b0f0-52f4-4b62-a7aa-82c756d2c8bd/roi.png",
    "encoding": "png-alpha8",
    "width": 2000,
    "height": 3000,
    "bounds": {"left": 1000, "top": 1500, "right": 3000, "bottom": 4500}
  },
  "output": {
    "file": "9f14b0f0-52f4-4b62-a7aa-82c756d2c8bd/mask.png",
    "encoding": "png-alpha8"
  }
}
```

`roi` 可为 `null`。协议不传送源文件路径、图像内容摘要或提示词到持久日志；`resolution` 只用于让输出 PNG 保持文档像素密度。

成功响应：

```json
{
  "status": "ok",
  "requestId": "9f14b0f0-52f4-4b62-a7aa-82c756d2c8bd",
  "selected": {"prompt": "black leather jacket", "score": 0.9883},
  "mask": {
    "file": "9f14b0f0-52f4-4b62-a7aa-82c756d2c8bd/mask.png",
    "encoding": "png-alpha8",
    "width": 4000,
    "height": 6000,
    "bounds": {"left": 0, "top": 0, "right": 4000, "bottom": 6000}
  },
  "timingsMs": {
    "preprocess": 0,
    "inference": 0,
    "compose": 0,
    "total": 0
  }
}
```

## 3. 像素文件格式

- `rgba8`：无头、逐行、top-down、chunky RGBA，每像素 4 字节，行无 padding。
- `gray8`：无头、逐行、top-down，每像素 1 字节，行无 padding。
- `png-rgba8`：合法 PNG，声明尺寸必须与 PNG 尺寸一致；解码后统一为 RGBA8。用于 Photoshop DOM/ExtendScript 兼容捕获。
- `png-alpha8`：合法且含 Alpha 通道的 PNG，声明尺寸必须与 PNG 尺寸一致；读取 Alpha 作为 ROI 或输出选区。用于原生图像处理器兼容桥和 UXP DOM 回退。
- 原始格式的实际字节数必须精确等于 `width × height × components`；PNG 必须通过格式、尺寸和 Alpha 校验。
- 所有 bounds 使用 Photoshop 文档像素坐标，右/下边界不包含。
- 输出 mask 尺寸和 bounds 必须与 input 完全相同。
- 活动层 Alpha 和 ROI 灰度必须在后端最终合成时逐像素相乘；ROI 外必须为 0。

常规 UXP 面板、Action、Batch 和 `.psjs` 优先使用原始 `rgba8`/`gray8`，减少编码开销。Photoshop 原生图像处理器的 ExtendScript 兼容动作使用 `png-rgba8`/`png-alpha8`，因为其同步宿主环境不能调用 UXP Imaging API。两种传输共享同一请求、Top-1、ROI、错误与幂等语义。

## 4. 幂等与重试

`requestId` 是幂等键。同一会话内收到完全相同的 `requestId` 和请求体时，可返回缓存成功结果；相同 ID 但请求体不同必须返回 `REQUEST_ID_CONFLICT`。

Hybrid addon 只对以下技术错误重启后端并重试一次：连接失败、后端提前退出、协议损坏、CUDA 运行时异常、显存分配失败。输入错误和 `NO_OBJECT` 不重试。

输出文件在成功响应前不可视为有效。第二次失败后插件抛错，Photoshop 原选区保持不变。

## 5. 错误格式

```json
{
  "status": "error",
  "requestId": "9f14b0f0-52f4-4b62-a7aa-82c756d2c8bd",
  "error": {
    "code": "NO_OBJECT",
    "message": "No candidate met the confidence threshold.",
    "retryable": false
  }
}
```

稳定错误码：

| HTTP | code | 重试 |
|---:|---|---:|
| 400 | `INVALID_REQUEST`、`UNSUPPORTED_SCHEMA`、`UNSUPPORTED_MODEL` | 否 |
| 400 | `PATH_OUTSIDE_SESSION`、`INPUT_SIZE_MISMATCH` | 否 |
| 401 | `UNAUTHORIZED` | 否 |
| 409 | `REQUEST_ID_CONFLICT` | 否 |
| 422 | `NO_OBJECT`、`EMPTY_EFFECTIVE_ROI` | 否 |
| 499 | `CANCELLED` | 否 |
| 500 | `INFERENCE_FAILED`、`CUDA_ERROR`、`OUTPUT_WRITE_FAILED` | 是 |
| 503 | `MODEL_NOT_READY`、`BACKEND_SHUTTING_DOWN` | 是 |

## 6. 资源限制

- 文档任一边最大 12,000 像素，总计最大 96,000,000 像素；横向 12,000×8,000 与纵向 8,000×12,000 均合法。
- 单次最多 5 个提示词，每个规范化后 1–120 个字符。
- 只接受 RGB 8 位来源转换出的 RGBA8。
- 后端同时只执行一个 GPU 推理请求；额外请求排队，不并发复制模型。
- 默认空闲退出时间 120 秒；正在执行或有排队请求时不退出。
