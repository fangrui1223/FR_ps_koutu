# SAM 3.1 Photoshop 文本选区插件：总体架构、PoC 结论与执行计划

> 文档状态：可行性 Gate、Photoshop 2026 Hybrid 真机闭环与阶段 3 核心图像事务已完成；阶段 4 关键真机路径已通过；阶段 6 已形成独立运行时候选、配置型 Release Addon、Inno Setup 工程和内部测试 CCX  
> 版本：1.7.0  
> 更新日期：2026-09-03  
> 目标平台：Windows 10/11、Photoshop 2025–2026、NVIDIA GPU（最低 16 GB 显存）

## 1. 执行结论

项目总体可行，建议继续产品化，但结论是“有明确边界的可行”，不是已经完成成品。

四类核心风险都已有可运行原型和本机证据：Photoshop Action 能保存并重放提示词参数；活动像素层和智能对象能通过 Imaging API 形成选区；本地后端可按需启动、鉴权、崩溃后只重试一次并空闲退出；指定 SAM 3.1 权重能完成英文文本 Top-1 分割，并能用低分辨率 GPU 推理避免 8000×12000 图像的全尺寸 GPU 掩码占用。

继续产品化必须接受以下边界：

1. Photoshop 抛错后由宿主显示“继续/停止”。2026 真机 Batch 在第 2 张无目标图上先显示“插件操作失败”，选择“停止”后又显示“是继续下一个文件还是停止”；第二次选择“停止”后批次停在第 2 张且未打开第 3 张。插件能可靠抛错并阻止自己的后续步骤，但不能替用户点击这两级宿主对话框；若未来要求失败后百分之百无人干预地退出，需要自建批处理编排器，而不是只依赖 Photoshop“文件 > 自动 > 批处理”。
2. 16 GB 显卡不能采用 ComfyUI 参考实现的全分辨率 GPU 掩码路径。正式后端必须固定为约 1008 像素检测/精炼、CPU 或分块方式合成全尺寸掩码。
3. 正式 Meta 适配器在 RTX 5090 上的热请求核心耗时为：1024×1536 约 0.205 秒、4000×6000 约 0.573 秒、8000×12000 约 1.791 秒；冷请求约 9–11 秒。Photoshop 2026 的 1024×1536 正式 Hybrid 热调用在 3.111 秒观察窗口内完成，但 8 秒验收口径是 4000×6000 的端到端 P95，仍需专门样本集测量。
4. V1 只输出 SAM 二值/灰度选区，不增加第二个精细抠图模型。它可以保留模型输出的软边，但不能承诺毛发、薄纱和半透明材质达到专业 alpha matting 质量；边缘优化继续由后续 Photoshop Action 负责。
5. Adobe Hybrid Plugin SDK v6.5.0 已从 Developer Console 取得并完成 ABI 接入；Manifest v6、Windows x64 `.uxpaddon`、异步 JS 导出、按需后端和正式模型均已在 Photoshop 2026 27.10 真机闭环。发布暂存中的 Addon 和图像处理器桥已关闭开发回退，只读取 `%PROGRAMDATA%` 机器级配置；独立运行时、完整模型预检和不依赖 ComfyUI 的正式推理均已通过。Adobe UXP Developer Tools 已成功生成内部 `.ccx`，但它使用 `.dev` ID；Windows 安装器尚未编译/签名，仍不是公开发布成品。
6. 当前只在 Photoshop 2026 27.10 真机验证；Photoshop 2025 必须纳入正式兼容性矩阵。
7. 正式 Hybrid 清单已由 UXP Developer Tools 在 Photoshop 2026 27.10 中加载；中文面板、Mock 传输闭环、正式 `pants` 推理、普通像素层、智能对象、灰度选区写回、严格 ROI 热重放、运行中取消、原生 Batch 和 `.psjs` 均已通过。Photoshop 2025 仍需独立真机验收。
8. Photoshop 2026 原生“图像处理器”从旧式 ExtendScript 同步调用 `doAction()`；纯 UXP 动作一进入 Photoshop 主机读图调用就停在 5%。因此 V1 保持同一用户概念上的“动作入口”，但内部采用两条官方 Photoshop 扩展路径：UXP 动作用于动作面板、Batch 和 `.psjs`；可录制 ExtendScript 桥接动作用于原生图像处理器。桥接成功处理 3 张约 39 MP 真实图片，未出现提示词弹窗或死锁。发布版桥由后端安装器复制到 PS 2025/2026 `Presets\Scripts`，并与 Addon 共用同一机器级运行时配置。

## 2. 已冻结的 V1 产品目标

开发一个遵循 Adobe UXP/Hybrid 官方流程的 Photoshop 本地离线插件。用户在中文面板中输入英文对象提示词，插件只读取当前活动图层的像素语义，调用本机 SAM 3.1，选择所有提示词和模型候选中置信度最高的一个对象，并把掩码写成当前 Photoshop 选区。

插件提供两个入口：

1. **交互面板入口**：单张图片使用；可修改提示词和阈值，显示进度、取消和简短错误信息。
2. **动作入口**：将提示词、阈值、模型 ID 和协议版本冻结在 Photoshop Action 步骤中；重放时不依赖面板当前值。常规动作、Batch 和 `.psjs` 使用 UXP 动作步骤；原生图像处理器使用安装器部署的 ExtendScript 兼容动作步骤。

界面对用户仍是既定“双入口”（交互面板 / 可录制动作），不是增加第三种工作方式。兼容动作只解决图像处理器的同步宿主限制；提示词和阈值同样随动作保存，运行时不弹窗。

| 主题 | V1 决策 |
|---|---|
| 输入 | 当前活动图层；普通像素层与智能对象 |
| 图层语义 | 读取该层自身渲染像素；包含其透明度、图层蒙版和智能对象变换；忽略下方图层、混合与剪贴关系 |
| 图层样式 | 目标是包含；需用专门样式夹具补测，若 Imaging API 不含样式则使用隔离临时文档回退 |
| 文档模式 | 只支持 RGB 8 位；其他模式直接报错 |
| 既有选区 | 作为严格搜索 ROI，结果逐像素裁切在原选区内 |
| 无既有选区 | 搜索画布内活动图层的有效像素 |
| 透明像素 | 完全透明区域不参与候选与最终选区 |
| 提示词 | 仅英文；支持短语和逗号分隔候选，最多 5 个；去空白、忽略大小写去重 |
| 候选选择 | 所有提示词、所有检测结果中全局置信度 Top-1 |
| 阈值 | 默认 0.50，可调范围 0.05–0.95，随 Action 步骤保存 |
| 成功 | 一次性替换当前选区，后续处理全部交给 Photoshop Action |
| 无对象/输入错误 | 保留原选区并抛错，不生成空选区 |
| 后端技术故障 | 自动重启并重试同一请求一次；仍失败则保留原选区并抛错 |
| 取消 | 交互模式可取消并保留原选区；动作模式无自定义弹窗 |
| 日志 | V1 不写持久运行日志；错误直接返回 Photoshop，临时会话文件只用于当前请求 |
| 推理 | 安装完成后完全离线；不要求 ComfyUI 启动，不依赖用户 Python |
| 生命周期 | 第一次使用时按需启动；连续批次复用；空闲或 Photoshop 退出后结束 |
| 分发 | 免费 `.ccx` + Windows 后端安装程序；内部、客户私发与公开下载 |

## 3. 正式总体架构

```text
Photoshop 2025 / 2026
┌──────────────────────────────────────────────────────────────┐
│ UXP Hybrid 插件                                             │
│  ├─ 中文 Panel：英文 prompt、阈值、执行、取消、状态         │
│  ├─ Action Recorder：冻结 schema/model/prompt/threshold     │
│  ├─ Capture modal：短模态读取活动层 RGB/Alpha + 原选区 ROI  │
│  ├─ Infer：模态外运行，允许面板取消                         │
│  ├─ Commit modal：最终成功后一次性 putSelection             │
│  └─ x64 .uxpaddon：启动/发现/关闭后端与会话握手             │
└──────────────────────────────┬───────────────────────────────┘
                               │ 127.0.0.1 + 256-bit 会话令牌
┌──────────────────────────────▼───────────────────────────────┐
│ Windows 本地后端                                            │
│  ├─ Supervisor：健康检查、一次重启重试、空闲退出           │
│  ├─ Validator：协议、RGB8、尺寸、ROI、提示词、模型哈希      │
│  ├─ SAM Adapter：与 UI/协议隔离，可在未来替换推理引擎       │
│  ├─ Pipeline：低分辨率候选检测 → 全局 Top-1 → 单次精炼      │
│  └─ Composer：CPU/分块全尺寸掩码、透明度与严格 ROI 相乘      │
└──────────────────────────────┬───────────────────────────────┘
                               │
                 sam3.1_multiplex_fp16.safetensors
```

### 3.1 为什么必须采用 Hybrid UXP

标准 UXP 面板适合 Action Recording 和 Imaging API，但不适合在无人交互的动作重放中可靠管理任意本机进程。Adobe 官方 Hybrid 插件允许 UXP 与 C++ 原生模块组合，并支持接入外部处理流水线，因此正式结构采用 `.ccx` 中的 UXP UI + x64 `.uxpaddon`。

原生模块保持极小：只负责安全启动、进程句柄、会话令牌和后端状态，不在 Photoshop 进程内加载 CUDA 或模型。模型崩溃不会直接拖垮 Photoshop。

原生图像处理器是一个例外兼容面。真机证明其 ExtendScript 调度器会同步等待 `doAction()` 返回，同时阻塞 UXP 动作继续调用 Photoshop Imaging/DOM；这不是调整超时可以解决的问题。安装器因此还会把 `legacy/SAM31 Image Processor Bridge.jsx` 安装到 Photoshop 官方 `Presets/Scripts` 目录。该步骤用 `app.playbackParameters` 录入提示词/阈值，以临时 PNG 交换活动层、ROI 和灰度/Alpha 选区，并通过本地 Python 启动器复用同一后端。它不读取合成图、不联网，也不把 CUDA 加载到 Photoshop 进程。

### 3.2 Action 数据契约

Action 步骤保存以下版本化数据：

```json
{
  "schemaVersion": 1,
  "modelId": "sam3.1-multiplex-fp16",
  "prompt": "black leather jacket, pants",
  "threshold": 0.5
}
```

重放流程固定为：读取并校验 Action 参数 → 捕获原选区和活动层 → 调用后端 → 校验响应 → 合成透明度和 ROI → 一次性写回选区。面板入口把捕获和提交分别放在两个短 Photoshop 模态中，推理在模态外运行，因此取消按钮可以工作；Action 重放沿用宿主提供的执行上下文，不嵌套模态。面板当前输入不得覆盖 Action 参数。用户换提示词时修改或重新录制动作。

### 3.3 本地协议和生命周期

- 后端仅绑定 `127.0.0.1`，禁止局域网监听。
- 每次启动生成 32 字节随机令牌；每个请求必须认证。
- 请求包含协议版本、模型 ID、prompt 列表、阈值、像素/ROI 描述和可选源文件路径。
- 大图不通过巨型 JSON/base64 传输；使用插件专用临时文件或命名共享内存，元数据使用 JSON。
- 临时数据在请求完成后清理，启动时清理过期残留。
- 第一次请求启动后端；批次内持续复用；空闲超时和父 Photoshop 进程退出均触发退出。
- 后端失联、进程退出或 CUDA 异常时，Supervisor 终止旧实例、启动新实例，并只重放一次原始幂等请求。
- 同一请求第二次失败时将错误抛回 Photoshop；不得无限重试或跳过图片。

## 4. 图像与选区语义

1. 捕获前验证恰好一个活动图层、RGB、8 位。
2. 先读取原选区，任何修改前将其保存在内存或临时缓冲区。
3. 使用 `imaging.getPixels({documentID, layerID})` 读取活动层，不读取合成图。
4. 以图层 Alpha 限制搜索区域，完全透明处强制为零。
5. 有原选区时，将 ROI 同时用于后端搜索和最终逐像素裁切；不能只传 bounding box。
6. 后端返回文档坐标系掩码和分数。前端复核尺寸、坐标、令牌和请求 ID。
7. 只有全部步骤成功后调用一次 `imaging.putSelection({replace: true})`。
8. 无对象、取消或任何异常发生在写回之前，因此原选区保持不变。取消同时使用后端中断和前端本地取消令牌；即使后端来不及停止并返回成功，提交前的最后一道守卫仍会拒绝写回。

正式插件已在 Photoshop 2026 中证明普通像素层、智能对象变换后的渲染像素、无选区、矩形严格 ROI、成功提交与运行中取消的闭环。图层样式、复杂图层蒙版、不规则抗锯齿 ROI 和超大文档传输仍属于正式阶段回归矩阵，不能由当前测试外推为已全部通过。

## 5. 模型与推理方案

### 5.1 固定模型

- 文件：`models/sam3.1_multiplex_fp16.safetensors`
- 大小：1,745,546,848 字节
- SHA-256：`9BA99C92703C2E8B4F47DE2D34A539BB8E18923049E238B780D70DBE6368EB03`
- safetensors 张量数：1,590（detector 1,133；tracker 457）
- 兼容信号：包含 detector、tracker 和 language backbone

安装和启动时验证模型哈希，拒绝静默加载未知权重。模型升级使用新的 `modelId`，不改变旧 Action 的语义。

### 5.2 正式推理流水线

1. 解析英文提示词，去空白、忽略大小写去重，最多 5 个。
2. 将 ROI 有效区域按长边缩放到模型输入策略；检测固定在约 1008×1008 范围。
3. 所有提示词完成候选检测，保留每个候选的模型置信度。
4. 跨提示词、跨检测结果选择全局 Top-1。
5. 只对 Top-1 做一次低分辨率精炼。
6. 在 CPU 或分块缓冲区还原到文档尺寸，乘以活动层 Alpha 和原选区灰度值。
7. 返回单通道 8 位掩码；不创建额外图层或蒙版。

该策略保留“先让所有候选公平竞争，再只精炼胜者”的语义，同时避免把 96 MP 的多组中间掩码长期放在 GPU。

### 5.3 许可边界

ComfyUI 只作为当前机器上的兼容性参考，不可将其 GPLv3 实现复制进计划中的闭源后端。正式后端当前已使用 Meta 官方 SAM 3.1 源码构建适配器，不导入 ComfyUI。固定开发基线为官方仓库提交 `660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7e`；发布时仍须按许可证要求完成法务复核和第三方通知。

Meta SAM License 是自定义许可证。发布安装包前必须：

- 由具备资质的人复核公开、内部和客户分发场景；
- 随模型及派生材料保留许可证和必要通知；
- 核对官方模型获取条款、用途限制及再分发条件；
- 不把“官方可下载”表述为无条件可商用或可再分发。

## 6. 四项可行性原型结果

| 原型 | 状态 | 已证明 | 未证明/限制 |
|---|---|---|---|
| A：Action 录制与错误传播 | 通过 | 真实 UXP 与 ExtendScript Action 步骤均可录入并无提示重放；原生 Batch 成功路径和第 2 张无对象失败路径已验证；图像处理器兼容动作连续处理 3 张真实大图 | 完整 A–F/1000 张矩阵尚未跑；Batch 失败会出现两级宿主“停止”，不是插件可控制 |
| B：活动层/智能对象/ROI | 核心通过 | PS 2026 27.10 中普通像素层和转换后的智能对象均能运行正式 SAM；严格 ROI 分别得到 `pants / 0.973` 与 `pants / 0.969`；失败和取消均发生在写回前 | 图层样式、复杂蒙版、不规则软 ROI、8000×12000 UXP 传输需产品化回归 |
| C：按需启动与容错 | 通过（发布候选闭环） | Windows x64 `.uxpaddon` 只连回环；32 字节令牌；隐藏启动；Job Object；健康检查；技术失败重启并只重试一次；空闲退出；配置型 Release Addon 已从机器级配置启动独立暂存后端并完成 Mock 传输 | 干净机安装、Photoshop 退出联动和长批次资源曲线仍需发布验收 |
| D：模型与性能 | 通过（开发闭环） | 指定权重结构/哈希通过；正式 Meta 适配器不导入 ComfyUI，支持短语、多候选、全局 Top-1；96 MP 后端热请求约 1.791 秒；正式 Hybrid 在 PS 2026 中生成 `pants` 选区 | 4000×6000 端到端 P95、16 GB 实机和 1000 张稳定性尚未完成；许可仍需发布前法务复核 |

### 6.1 Photoshop 真机证据

测试环境：Photoshop 2026 27.10、UXP Developer Tools、1024×1536 RGB 8 位服装样图。

- 在 Action 面板中录入 `SAM 3.1 文本选区` 后，清除选区再播放，选区重新出现。
- 面板默认值改成 `jacket` 并重载插件后，播放先前动作，状态显示 `动作重放完成：pants / 0.50`；证明参数属于动作步骤，而不是读取面板现值。
- 录入 `forced-error` 步骤后播放，Photoshop 显示“插件操作失败”并提供“继续/停止”；选择“停止”后动作终止。
- 将测试层转换为嵌入智能对象、清除选区、重放原动作后，选区仍正确出现。
- 原型用活动层 Alpha 代替 SAM 掩码，目的仅是隔离验证 Photoshop 读取/动作/写回链路，不代表模型已经嵌入插件。
- Adobe Hybrid Plugin SDK v6.5.0 已下载并校验：`work/uxp-hybrid-plugin-sdk-v6.5.0.zip`，SHA-256 `8C7469C5108F4F768FDEDF5C7E9AC8567F3D98F610A62D94DAE798030D9841A9`。SDK README 给出的 Photoshop 最低版本为 24.2；正式清单将最低宿主固定为 25.0，对应产品目标 Photoshop 2025–2026。
- Manifest v6 Hybrid 插件和 Windows x64 `.uxpaddon` 已由 UXP Developer Tools 成功加载。加入冷启动取消与临时目录清理后的正式开发二进制 SHA-256 为 `4D711C960D2108E13910267B57C59965FD24EDA70C32AE297C9FC1087756B20D`。
- Photoshop 的不透明背景层通过 Imaging API 返回 RGB 三通道；正式插件现将 RGB8 补 Alpha=255，RGBA8 则原样保留。这一修复已加入纯函数回归测试。
- Mock Addon 真机闭环显示 `完成：pants / 1.000`，证明 UXP 临时文件、异步 Addon、按需后端、HTTP 鉴权、蒙版读取和 `putSelection` 全链路工作。
- 正式 SAM 3.1 冷调用在 1024×1536 样图中选择 `pants / 0.914`；以该裤子选区作为严格 ROI 的热调用返回 `pants / 0.973`，并在 3.111 秒观察窗口内完成，结果未越出原选区。
- 同一严格 ROI 转换为智能对象后，正式插件返回 `pants / 0.969`。随后已撤销智能对象转换，测试文档恢复为原普通像素层。
- 面板执行已改为“短捕获模态 → 模态外推理 → 短提交模态”。在启动后约 100 ms 点击取消的真机竞态中，面板显示“任务已取消，原选区保持不变”，迟到结果没有写回；随后完整成功路径再次返回 `pants / 0.969`。
- 在模态重构后的正式插件中，新建并录制 `自建动作 / SAM31-正式回归`，由 Photoshop 2026 动作面板直接回放成功，返回 `pants / 0.965`；这不是早期 Action PoC。
- 从“文件 > 脚本 > 浏览”执行 `.psjs`，脚本通过 `app.actionTree` 和 `Action.play` 调用同一正式动作，插件显示“正在重放”并最终返回 `pants / 0.973`，选区正确。由此确认已安装插件的 Action 可由 Photoshop 2026 UXP 脚本入口触发。
- 原生 Batch 使用 `自建动作 / SAM31-正式回归` 成功逐张调用 UXP 动作。修正后的失败夹具为 `01-pants.jpg`、`02-no-pants.jpg`（卡车）和 `03-should-not-run.jpg`；第 1 张成功，第 2 张显示 `No candidate met the confidence threshold`，两次选择 Photoshop 宿主的“停止”后仍停在第 2 张，新夹具的第 3 张没有打开。
- 纯 UXP 动作由原生图像处理器的 ExtendScript `doAction()` 调用时，可复现停在约 5% 且首个 Photoshop 主机调用不返回。改用 `legacy/SAM31 Image Processor Bridge.jsx` 并录制 `默认动作 / SAM31-图像处理器-pants-0.50` 后，原生图像处理器连续完成 3 张 7646×5100、7640×5096、7640×5096 真实图片；每张约 10 秒，无提示词弹窗、无死锁，输出文件时间分别为 12:09:22、12:09:32、12:09:42。
- 安装在 Photoshop 2026 `Presets/Scripts` 的兼容脚本与工作区源码 SHA-256 完全一致：`7A05E959789FFEDC6E8D25AADCD5AAFEBC83225279351FB0BF662E5A3337D59B`。
- 当前开发构建回归通过：后端协议/显存单元测试 10/10、正式插件协调器 Node 测试 8/8、生产纯函数测试通过；Native Supervisor 与生命周期 CTest 为 2/2，通过；Release 运行时配置测试和“配置型 Addon → 独立暂存后端”传输也通过，均为零失败。
- 正式推理后实测后端按 120 秒空闲策略自动退出；退出后 Windows 中没有残留 `python`/`pythonw` 进程。独立暂存运行时也已完成模型冷/热推理，不依赖 ComfyUI；最终安装目录和 Photoshop 退出联动仍需干净机重复验收。

### 6.4 独立运行时候选与内部 CCX

- 从开发 Python 的依赖闭包只复制 Python 基础运行时和 35 个发行版，不复制 `C:\FR_comfyui` 根目录或 `custom_nodes`。
- 暂存负载含 19,842 个文件、6,897,065,303 字节；完整阶段清单含 19,860 个文件、6,897,249,406 字节和逐文件 SHA-256。clean build 排除了 2,647 个 `.pyc/__pycache__`，发布暂存中的字节码缓存数为 0。
- `sam31_backend.preflight` 在暂存运行时中完成核心包导入、CUDA/显存、固定模型哈希、Meta 源码导入和完整模型构建/上卡。
- clean build 后正式夹具的独立冷请求为 11.212 秒、热请求为 0.194 秒，Top-1 为 `black leather jacket / 0.96875`；报告明确记录 `usesComfyUI: false`。冷启动不计入已冻结的 8 秒热路径目标。
- 配置型 Release Addon 为 138,752 字节，SHA-256 `42EDB892E468B9B1040ADB2F4C95963BF2286078403AC3A6DF0C511CE7762931`；发布暂存中扫描不到 ComfyUI、项目盘或开发回退路径。
- UXP Developer Tools 在 Photoshop 2026 27.10 校验成功并生成 `com.fr.sam31-selection.dev_PS.ccx`，86,577 字节，SHA-256 `A76030204A2F85608BF8C1D4F37A7657A351E2DC7CC38A411E526F32C5F70B0B`；包内 18 个文件与最终插件暂存目录逐字节一致。
- 当前候选使用 `torch 2.11.0.dev20260112+cu128` / `torchvision 0.25.0.dev20260112+cu128`。它证明“可独立运行”，但 nightly 组合不能作为可重现公开发行基线；发布前必须换成审计、锁定版本和文件哈希的稳定组合。

### 6.2 模型和大图实测

测试设备：RTX 5090，现有 ComfyUI Python 3.10.11、PyTorch 2.11 dev、CUDA 12.8。下表是参考原型数据，不包含 UXP 捕获和 Photoshop 写回。

| 路径 | 图像 | 提示词数 | 模型加载 | 推理/核心总计 | 峰值 Torch 分配 | 结论 |
|---|---:|---:|---:|---:|---:|---|
| ComfyUI 参考 | 1024×1536 | 2 | 0.73 s | 候选 2.27 s | 2.76 GB | 通过 |
| ComfyUI 参考 | 4000×6000 | 2 | 0.70 s | 候选 2.08 s | 11.78 GB | 16 GB 边缘可行，但余量太小 |
| 全尺寸 GPU 参考 | 8000×12000 | 1 | 0.69 s | 候选 4.06 s | 41.40 GB | 否决，不能作为产品路径 |
| 优化路径 | 8000×12000 | 2 | 0.94 s | 源准备后 3.38 s | 2.94 GB | 推荐产品路径 |

优化路径与全尺寸 GPU 参考掩码的 IoU 为 `0.9976183997`。单次进程包含导入与输出的墙钟约 8.25 秒；正式 Hybrid 已证明 1024×1536 热调用可在 3.111 秒观察窗口内完成，但不能据此替代 4000×6000 的最终 8 秒 P95 验收。

### 6.3 正式 Meta 适配器实测

正式适配器位于 `backend/sam31_backend/meta_adapter.py`，直接使用 Meta 官方 `facebookresearch/sam3` 源码，不导入 ComfyUI。权重加载时无 unexpected keys；允许缺失项仅为运行期生成的 32 个 RoPE 缓冲和未使用的 `text_projection`。1024×1536 独立验证的 Torch 峰值分配约 4.12 GB，模型加载约 4.86 秒，两个提示词推理约 0.311 秒，Top-1 为 `black leather jacket`，分数 0.96875。

| 正式后端请求 | 提示词数 | 冷请求总计 | 热请求总计 | 选择结果 |
|---|---:|---:|---:|---|
| 1024×1536 | 2 | 9.231 s | 0.205 s | `black leather jacket` |
| 4000×6000 | 2 | 9.729 s | 0.573 s | `black leather jacket` |
| 8000×12000 | 2 | 11.287 s | 1.791 s | `black leather jacket` |

1024×1536 正式掩码与 ComfyUI oracle 的 IoU 为 `0.9887769282`；8000×12000 正式掩码与优化参考掩码的 IoU 为 `0.9902975345`。差异来自官方实现、插值和阈值路径，不影响本次 Top-1 选择一致性结论。上述时间是正式后端服务内部时间，不包含 UXP 捕获、RGBA 临时文件写入、原生桥接和 `putSelection`。

## 7. 错误与宿主行为

| 情况 | 插件行为 | 重试 | 原选区 |
|---|---|---:|---|
| 无文档、非单一活动层、非 RGB 8 位 | 抛错 | 0 | 保留 |
| 空提示、非法字符、候选超过 5 | 抛错 | 0 | 保留 |
| 活动层/ROI 无有效像素 | 抛错 | 0 | 保留 |
| 无对象或最高分低于阈值 | 抛错 | 0 | 保留 |
| 用户取消 | 取消当前命令 | 0 | 保留 |
| 后端失联、崩溃、CUDA 技术错误 | 重启后端并重放幂等请求 | 1 | 保留到成功 |
| 第二次仍失败 | 抛回 Photoshop | 不再重试 | 保留 |

Photoshop 的 Action/Batch 是宿主调度器。真机证明插件异常能到达宿主，但 Photoshop 2026 的“由于错误而停止”不是静默策略：它先显示“插件操作失败”，选择“停止”后再询问“是继续下一个文件还是停止”。第二次选择“停止”才会终止队列。基于用户已接受的 V1 规则，插件不伪造空选区、不跳过错误，也不自建批处理器；无人干预的“失败即静默退出”不列为 V1 保证。若以后把它重新列为硬性要求，优先新增插件自建队列/外部编排器，而不是自动操作 Photoshop 对话框。

## 8. 性能和稳定性验收口径

- **8 秒目标**：仅 RTX 5090、模型已加载、单个常见提示词、4000×6000 RGB8、无网络、从 UXP 开始捕获到 Photoshop 完成选区写回。
- **最大尺寸**：8000×12000 必须成功，不承诺 8 秒。
- **最低显存**：16 GB；产品路径在峰值 GPU 内存上必须保留至少 20% 安全余量，不采用 4000×6000 全尺寸参考路径。
- **批量稳定性**：连续 1000 张，后端进程不重复增长，GPU 峰值无趋势性上升，临时文件无泄漏。
- **冷启动**：单独记录，不计入 8 秒；面板显示“正在启动模型”。
- **相同提示词批次**：缓存文本 embedding，并保持模型常驻。

## 9. 产品化工程目录

```text
docs/                       架构、协议、测试、许可与发布文档
prototypes/
  action-layer-poc/         已完成的 UXP Action/Layer/ROI 原型
  backend-lifecycle-poc/    已完成的 Windows 生命周期核心原型
  model-poc/                已完成的模型/性能参考原型
plugin/                     正式 UXP Hybrid 插件
native/                     正式 Windows x64 .uxpaddon
backend/                    独立本地推理服务
legacy/                     Photoshop 图像处理器 ExtendScript 兼容动作
installer/                  签名安装、升级与卸载配置
tests/                      自动、手动、性能和 1000 张稳定性测试
models/                     本机开发权重；默认不提交源码仓库
```

### 9.1 当前产品化完成度

- `docs/PROTOCOL_V1.md`：已冻结回环 HTTP、256-bit Bearer token、会话目录相对路径、原始 RGBA8/GRAY8 与兼容 PNG 传输、错误码、幂等与资源上限。
- `plugin/`：正式中文 UXP 面板、Action 参数、活动层/ROI 捕获、会话文件清理、后端协调和最终选区提交已完成；Hybrid Manifest v6 已在 Photoshop 2026 27.10 中加载。
- `backend/`：回环服务、鉴权、路径隔离、幂等、错误分类、父进程/空闲生命周期和正式 Meta 适配器已完成；10/10 单元测试与独立暂存运行时冷/热推理通过。
- `native/`：已按 Adobe Hybrid SDK v6.5.0 完成 Manifest v6 ABI、异步 `infer`/同步 `cancel`、WinSock 回环、BCrypt 令牌、隐藏进程、Job Object、健康检查、一次重启重试和空闲退出；开发 CTest、Photoshop 真机闭环和配置型 Release Addon 到独立后端传输均通过。
- `legacy/`：原生图像处理器兼容动作脚本和 Python 启动桥已完成开发机闭环；发布暂存版关闭开发路径回退并读取机器级安装配置。
- `installer/`：独立运行时裁剪、GPU 检查、模型预检、机器级配置、PS 2025/2026 脚本部署、升级/卸载清理、逐文件清单和 Inno Setup 工程已完成；内部 `.dev` CCX 已由 UXP Developer Tools 打包成功。
- 已完成：Hybrid 数据桥、正式模型的 Photoshop 2026 真实 UXP 全链路、RGB/RGBA 活动层输入、普通像素层、智能对象、严格 ROI 热重放、可取消三段式事务、Action、Batch 成功/无对象失败、`.psjs`，以及图像处理器 3 张真实大图成功路径。
- 尚未完成：PS 2025、完整 A–F/图像处理器失败矩阵、图层蒙版/样式/下层隔离/不规则软 ROI/96 MP 的完整图层语义矩阵、4000×6000 端到端 P95、16 GB 实机、1000 张长跑、最终 Adobe ID、稳定依赖锁定、安装器编译/签名、干净机安装和公开发布材料。

## 10. 从现在开始的执行计划

### 阶段 1：生产骨架与协议（P0）

交付：`plugin/`、`native/`、`backend/` 的可构建骨架，协议 v1、错误码、请求幂等键和临时文件策略。

退出条件：无模型 mock 请求可从真实 Action 入口完整经过 `.uxpaddon` 到后端再写回选区；崩溃注入只重试一次；Photoshop 不弹插件自定义窗口。

当前进度：完成。SDK v6.5.0、Manifest v6、`.uxpaddon`、Mock 后端、正式 SAM 3.1 后端与 Photoshop 2026 真机闭环均已通过。发布安装版仍归阶段 6。

### 阶段 2：正式模型适配器（P0）

交付：不打包 ComfyUI GPL 代码的 SAM 3.1 适配器、固定权重校验、低显存 Top-1 流水线、取消与超时。

退出条件：同一固定样本集相对参考 oracle 的对象选择一致；二值掩码 IoU 和边界指标达到预设门槛；16 GB 显卡模拟/实机不 OOM；模型许可清单完整。

当前进度：官方 Meta 适配器、固定哈希、低分辨率 Top-1 和 1024/24 MP/96 MP 实测已完成；固定样本 Top-1 一致，IoU 0.988777–0.990298。16 GB 实机与最终许可清单仍未完成。

### 阶段 3：Photoshop 图像语义（P0）

交付：像素层、智能对象、图层蒙版、图层样式、透明度、ROI、坐标和大图传输实现；仅在最终成功时写回。

退出条件：普通层/智能对象矩阵通过；下方高对比图层不影响输入；矩形与不规则软选区严格裁切；失败/取消逐像素保持原选区；8000×12000 不错位。

当前进度：核心实现完成。普通像素层、智能对象、RGB/RGBA 归一化、整数坐标和缓冲区严格校验、矩形 ROI、成功原子提交、失败保护与运行中取消均已在自动测试或 Photoshop 2026 真机通过。尚需完成图层蒙版、图层样式、下方高对比隔离、不规则软 ROI 和 8000×12000 实际 UXP 传输矩阵；这些未通过前阶段 3 不关闭。

### 阶段 4：动作与批处理兼容（P0）

交付：中文面板、动作录入/再次录入、Action 参数迁移、无界面重放、脚本调用文档。

退出条件：Photoshop 2025 和 2026 中分别通过 Action、Batch、图像处理器和脚本矩阵；同一批次共用动作内提示词；无对象和技术错误行为与第 7 节一致。

当前进度：中文面板、动作参数冻结、全局 Action handler、v0→v1 显式迁移和未知版本拒绝已实现。Photoshop 2026 的动作面板、`.psjs`、Batch 成功路径与第 2 张无对象失败路径均已真机验证；原生图像处理器通过可录制 ExtendScript 兼容桥连续处理 3 张约 39 MP 真实图片。纯 UXP 动作在原生图像处理器的同步 `doAction()` 下会卡住，因此不再把它列为该入口的实现方案。四入口证据和后续矩阵见 `docs/PHOTOSHOP_BATCH_COMPATIBILITY.md`。完整 A–F、图像处理器失败路径与 Photoshop 2025 仍未执行，所以阶段 4 保持进行中。

### 阶段 5：性能、稳定性和体验（P1）

交付：文本缓存、后端常驻/空闲退出、进度/取消和无持久日志的简明错误状态。

退出条件：RTX 5090 热启动 4000×6000 端到端 P95 ≤ 8 秒；8000×12000 成功；1000 张长跑无资源泄漏；Photoshop 退出后后端按规则结束。

当前进度：正式后端的 24 MP/96 MP 核心性能已通过，独立运行时候选冷/热推理已通过；尚未执行 Photoshop 4000×6000 端到端 P95、1000 张长跑、16 GB 显卡和安装目录生命周期测试，因此阶段 5 保持进行中。

### 阶段 6：安装、签名与发布（P0）

交付：`.ccx`、Windows x64 安装程序、模型安装/校验、离线运行验证、升级/卸载、第三方通知和最终用户文档。

退出条件：全新 Windows 10/11 机器只安装 Photoshop、插件和后端即可离线工作；无 ComfyUI、系统 Python 或开发工具依赖；代码签名和恶意软件误报检查通过；许可复核签字完成。

当前进度：独立负载、配置型 Release Addon、发布版 ExtendScript、Inno Setup 工程、GPU/模型安装预检、逐文件哈希和内部 `.dev` CCX 已完成。尚需最终 Adobe Distribution ID、稳定 PyTorch/CUDA 锁定、Inno Setup 编译、Windows 签名、许可人工复核与干净机验收；阶段 6 未关闭。

## 11. 发布 Gate

只有以下项目全部满足才生成公开安装包：

- Photoshop 2025/2026 四个调用入口均通过；
- 16 GB NVIDIA 目标机通过，不依赖 5090 特性；
- 5090 热启动性能达到或由用户书面接受修订目标；
- 1000 张稳定性通过；
- 无对象、取消、崩溃、第二次失败均不破坏原选区；
- 安装后断网可运行；
- 不包含 ComfyUI GPL 实现；Meta/模型许可和第三方通知完成复核；
- Python/PyTorch/CUDA 使用稳定版本、固定来源与文件哈希，可从干净环境重复构建；
- 安装、升级、卸载、临时文件清理和模型校验均通过。

## 12. V1 不包含

- 多对象合并或逐对象多选区输出；
- 独立毛发、薄纱、透明材质 alpha matting 模型；
- macOS、AMD、CPU、Intel GPU；
- RGB 16/32 位、CMYK、Lab；
- 依赖 ComfyUI 服务或任意第三方模型热插拔；
- 插件自建的 1000 张批处理队列与失败报告。

模型接口、Action schema 和本地协议都必须版本化，使 V2 可以增加精细 alpha 模型，而不破坏 V1 已录制动作。

## 13. 已生成的原型证据

- `prototypes/action-layer-poc/`：可由 UXP Developer Tools 加载的 Action/Layer/ROI 插件与纯函数测试。
- `prototypes/backend-lifecycle-poc/`：C++20 生命周期原型及 Release 可执行文件。
- `prototypes/model-poc/results/checkpoint.json`：权重哈希和结构扫描。
- `prototypes/model-poc/results/fashion-8000x12000-optimized-report.json`：96 MP 优化路径报告。
- `prototypes/model-poc/results/fashion-8000x12000-mask-comparison.json`：优化路径与参考掩码 IoU。
- `prototypes/model-poc/results/fashion-official-meta-report.json`：官方 Meta 源码、状态字典、显存和 Top-1 证据。
- `prototypes/model-poc/results/fashion-official-meta-comparison.json`：官方适配器与 ComfyUI oracle 的 1024×1536 IoU。
- `prototypes/model-poc/results/backend-meta-smoke-4000x6000-report.json`：正式后端 24 MP 冷/热请求。
- `prototypes/model-poc/results/backend-meta-smoke-8000x12000-report.json`：正式后端 96 MP 冷/热请求。
- `prototypes/model-poc/results/backend-meta-smoke-8000x12000-comparison.json`：正式 96 MP 掩码与优化参考 IoU。
- `work/uxp-hybrid-plugin-sdk-v6.5.0.zip`：Adobe Hybrid Plugin SDK v6.5.0 原始下载及固定哈希。
- `native/build/Release/sam31_supervisor_smoke.exe`：Mock 生命周期/传输 CTest；`native/build-formal/Release/sam31-supervisor.uxpaddon`：正式模型开发二进制。
- `native/build-release/Release/sam31-supervisor.uxpaddon`：关闭开发回退的配置型 Release Addon。
- `installer/stage/release-manifest.json`：独立运行时、模型、官方源码、许可、桥与插件的逐文件哈希清单。
- `work/standalone-runtime-smoke-report.json`：独立候选运行时的正式模型冷/热推理报告，记录 `usesComfyUI: false`。
- `installer/dist/ccx/com.fr.sam31-selection.dev_PS.ccx`：UXP Developer Tools 校验成功的内部测试包；`.dev` ID，不是公开发布包。

## 14. 官方参考资料

- Adobe UXP Action Recording：<https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/action-recording/>
- Adobe Photoshop Imaging API：<https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging/>
- Adobe UXP Hybrid Plugins：<https://developer.adobe.com/photoshop/uxp/guides/hybrid-plugins>
- Meta Segment Anything 3：<https://ai.meta.com/sam3/>
- Meta SAM 3 官方仓库：<https://github.com/facebookresearch/sam3>
- Meta SAM License：<https://github.com/facebookresearch/sam3/blob/main/LICENSE>
- Meta SAM 3.1 Release：<https://github.com/facebookresearch/sam3/blob/main/RELEASE_SAM3p1.md>
- ComfyUI Changelog：<https://docs.comfy.org/changelog>
