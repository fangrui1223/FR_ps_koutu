# Photoshop 动作与批处理兼容性验收

> 状态：阶段 4 验收进行中；Photoshop 2026 的 Action、Batch、`.psjs` 与图像处理器兼容桥关键路径已通过，完整 A–F 与 Photoshop 2025 待执行  
> 适用插件：SAM 3.1 文本选区 V1  
> 更新日期：2026-09-02

## 1. 验收目的

验证等价的已录制动作步骤在 Photoshop 2025/2026 的动作面板、批处理、图像处理器和 UXP 脚本四个入口中均使用动作内冻结的英文提示词，并在成功时生成选区，在无对象或技术故障时抛错且不覆盖原选区。

Adobe 的接口边界是：插件用 `action.recordAction` 写入一个全局处理函数名称和参数对象；重放时 Photoshop 用已保存参数调用该函数。“再次录制”会用处理函数的返回对象替换旧参数。独立 `.psjs` 不能承载被动作调用的插件函数，因此脚本验收只负责找到并播放已经录好的动作，插件必须保持安装并加载。

Photoshop 2026 真机还证明：原生图像处理器从 ExtendScript 同步执行 `doAction()` 时，纯 UXP 动作会停在约 5%，首个 Imaging/DOM 主机调用无法返回。该入口必须改用安装到 `Presets/Scripts` 的 `SAM31 Image Processor Bridge.jsx` 录制动作。兼容动作通过 `app.playbackParameters` 保存相同的 prompt/threshold，并复用同一本地后端；这仍属于用户侧的“动作入口”，但不是同一个底层 UXP action handler。

## 2. 固定验收动作

常规 Action、Batch 和 `.psjs`：在“动作”面板新建动作组 `SAM 3.1 验收`，再录制 UXP 动作 `pants-baseline`：

1. 打开插件面板，输入 `pants, trousers`，阈值 `0.50`。
2. 单击“执行并录入动作”，等待成功后停止录制。
3. 动作中不得录入固定文件的“打开”命令；保存测试如需要，应另录“存储为”步骤并让批处理覆盖目标路径。
4. 把面板提示词改成 `jacket`，但不重新录制；后续四个入口仍必须选择裤子，以证明提示词来自动作步骤。

需要换提示词时，按既定产品规则修改/再次录制该步骤，不在批处理运行中弹窗询问。

原生图像处理器：从“文件 > 脚本 > SAM 3.1 图像处理器桥接”录制 `pants-image-processor`，首次录制时输入同样的 `pants, trousers / 0.50`。之后重放和图像处理器批次不得再次弹出提示词窗口。开发机实测动作名为 `默认动作 / SAM31-图像处理器-pants-0.50`。

## 3. 测试夹具

每个 Photoshop 版本使用相同输入副本，禁止拿原始生产文件直接跑失败测试：

| 夹具 | 用途 | 预期 |
|---|---|---|
| A：普通像素层，含裤子 | 基线 | 成功、非空选区 |
| B：智能对象，含裤子 | 智能对象 | 成功、非空选区 |
| C：有严格 ROI，覆盖半条裤子 | ROI | 结果逐像素不越过原 ROI |
| D：不含裤子 | 无对象 | 插件抛错，原选区不变 |
| E：RGB 16 位 | 不支持模式 | 插件抛错，原选区不变 |
| F：同名文件位于两个目录 | 调度隔离 | 两份文件都被处理，不发生串图 |

批处理和图像处理器的第一轮各用 10 张，按 `A、B、C、A、D、A、F1、F2、A、A` 排列，让错误位于中间而非最后。1000 张长跑属于阶段 5，不用它代替本阶段的功能矩阵。

## 4. 四入口矩阵

每一行都要在 Photoshop 2025 和 2026 分别记录版本号、日期、输入数量、成功数量、首个失败文件、原选区是否保持和结果。不能用“同版本应该一样”代替实测。

| 入口 | 操作 | 合格条件 |
|---|---|---|
| 动作面板 | 清除/设置原选区，直接播放 `pants-baseline` | 面板当前为 `jacket` 时仍按 `pants, trousers / 0.50`；成功非空 |
| 文件 > 自动 > 批处理 | 来源选择测试目录；动作选择基线动作；错误选择“因错误而停止” | 逐文件调用；到 D 立即由 Photoshop 停止并显示错误；D 的原选区不被插件覆盖 |
| 文件 > 脚本 > 图像处理器 | 勾选“运行动作”，选择 ExtendScript 兼容动作；输出 PSD 测试副本 | 每张图都使用同一动作参数；不弹提示词窗口且不死锁；成功文件有预期选区驱动的后续结果；D 的宿主行为单独记录 |
| 文件 > 脚本 > 浏览 | 先改好测试脚本中的动作组/动作名，再运行 `tests/photoshop/run-recorded-action.psjs` | 控制台输出 `"result":"PASS"` 和非空 `selectionBounds` |

批处理必须选择 Photoshop 官方的“因错误而停止/Stop For Errors”。若选择“将错误记录到文件”，Photoshop 的设计就是记录后继续，这不属于插件可覆盖的行为。2026 实测中“因错误而停止”仍会显示两级宿主确认框：先是“插件操作失败”，再是“是继续下一个文件还是停止”；必须两次选择“停止”才终止批次。图像处理器遇错如何结束仍须以两个版本的真机结果为准，不能预先声称等同批处理。

## 5. 错误与恢复矩阵

| 注入 | 插件预期 | 宿主验收 |
|---|---|---|
| 提示对象不存在/低于阈值 | 不重试，抛错 | 当前动作停止；原选区保持 |
| 后端进程首次崩溃 | 自动重启并只重试一次 | 若第二次成功则动作成功 |
| 后端连续两次失败 | 第二次后抛错 | 批处理在“因错误而停止”模式停止 |
| 用户在面板入口取消 | 抛出 `CANCELLED`，不提交迟到结果 | 原选区保持；此项不用于无界面 Action |
| RGB 16/32、CMYK、Lab | 捕获前拒绝 | 不启动有效推理；原选区保持 |
| 返回空掩码或响应越界 | 协议校验失败，不提交 | 动作失败；原选区保持 |

## 6. 参数迁移与升级

- 当前 Action schema 为 v1。
- 正式版本化前录制、没有 `schemaVersion` 的同字段数据按 v0 迁移到 v1。
- 未知的未来版本必须报错，不能猜测执行。
- 处理函数成功返回规范化后的 v1 参数，使 Photoshop“再次录制”可以更新旧步骤。
- 模型 ID 不匹配时直接拒绝，防止升级后旧动作静默改变语义。

## 7. 结果记录模板

| PS 版本 | 入口 | 用例 | 结果 | 耗时 | 原选区保持 | 备注 |
|---|---|---|---|---:|---|---|
| 27.10 / 2026 | 动作 | A | 通过 | 未精确计时 | 不适用（成功提交） | 真机录制并回放 `自建动作 / SAM31-正式回归`；返回 `pants / 0.965`，选区正确 |
| 27.10 / 2026 | 批处理 | A–D 核心路径 | 通过（完整矩阵待补） | 单张约数秒至 10 s | D 在写回前失败 | UXP 动作；修正夹具为有裤子/卡车/有裤子。A 成功，D 返回 `No candidate met the confidence threshold`；两次选择宿主“停止”后停在 D，第 3 张未打开 |
| 27.10 / 2026 | 图像处理器 | A 成功路径 ×3 | 通过 | 每张约 10 s | 不适用 | ExtendScript 兼容动作；7646×5100、7640×5096、7640×5096 三张真实图片连续完成，3 个输出文件生成，无提示词弹窗、无死锁 |
| 27.10 / 2026 | `.psjs` | A | 通过 | ≤ 12 s 观察窗口 | 不适用（成功提交） | `app.actionTree` + `Action.play` 真机触发同一正式动作；返回 `pants / 0.973`，选区正确 |
| 26.x / 2025 | 全矩阵 | A–F | 阻塞 | — | — | 本机未安装 PS 2025 |

上述结果使用正式 Hybrid 插件、正式 Meta SAM 3.1 后端和正式兼容桥，不是早期 Action PoC。图像处理器当次配置为 JPEG 质量 12、适合 5000×3000，因此输出文件只证明顺序执行、保存和无死锁，不作为持久化选区证据。当前实测动作名用于本机回归；发布验收仍按第 2 节的独立动作组和全套 A–F 副本执行。`.psjs` 执行时插件必须保持安装并已由 Photoshop 加载。

## 8. 当前结论与剩余项

- UXP Action 可用于动作面板、Photoshop Batch 和 `.psjs`。
- Photoshop 原生图像处理器必须选 ExtendScript 兼容动作；纯 UXP 动作路径已因可复现宿主死锁否决。
- Batch 的无对象错误会准确停在失败文件且不打开后续文件，但需要用户处理 Photoshop 的两级“停止”对话框；V1 不承诺失败后的静默无人值守退出。
- 图像处理器失败路径、完整 A–F、PS 2025、16 GB、1000 张和安装版独立运行时仍待验收。

## 9. 官方依据

- Adobe UXP Action Recording：<https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/action-recording/>
- Adobe Photoshop DOM Actions：<https://developer.adobe.com/photoshop/uxp/ps_reference/>
- Adobe UXP Scripting：<https://developer.adobe.com/photoshop/uxp/ps_reference/media/uxpscripting/>
- Adobe Batch 选项：<https://helpx.adobe.com/photoshop/desktop/automate-tasks/process-a-batch-of-files/batch-and-droplet-processing-options.html>
- Adobe Image Processor：<https://helpx.adobe.com/ca/photoshop/desktop/automate-tasks/process-a-batch-of-files/convert-files-with-the-image-processor.html>
