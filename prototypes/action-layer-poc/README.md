# Action + Layer PoC

这个 UXP 插件用活动图层 Alpha 代替 SAM 掩码，以隔离验证：

- `action.recordAction` 参数录制与全局回放处理器；
- 动作失败是否向 Photoshop 传播；
- `imaging.getPixels({ layerID })` 的活动图层读取；
- 既有选区的逐像素严格 ROI；
- `imaging.putSelection` 的选区写回和坐标。

## 本地静态测试

```powershell
node .\tests\pure.test.js
```

## Photoshop 测试

1. 在 UXP Developer Tool 中添加本目录的 `manifest.json` 并加载。
2. 在 Photoshop 打开“插件 > SAM 3.1 选区 PoC”。
3. 创建普通像素层/智能对象测试文档并执行面板按钮。
4. 打开动作面板并开始录制，点击“执行并录入动作”，停止录制。
5. 重放动作；再用文件批处理、图像处理器和脚本分别调用。

详细验收矩阵见 `../../docs/PROJECT_PLAN.md`。

## 2026-09-01 真机结果

- Photoshop 2026 27.10 中成功录入并重放真实 Action 步骤。
- 面板默认值改为 `jacket` 后，旧动作仍以录入的 `pants / 0.50` 重放。
- `forced-error` 会传递给 Photoshop，并显示宿主的“继续/停止”错误对话框。
- 普通像素层和转换后的嵌入智能对象均完成读取与选区写回。
- 1024×1536 图像的中心严格 ROI 实测边界为 `{256,384,768,1152}`。

这个原型用活动层 Alpha 作为代理掩码，只证明 Photoshop 集成链路，不包含 SAM 推理。
