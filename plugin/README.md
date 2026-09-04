# FR SAM 文本选区 UXP Hybrid 插件

Manifest v6 正式 ID 为 com.fangrui.sam-selection，最低 Photoshop 26.0.0（Photoshop 2025）。

插件提供中文面板和可录制 UXP 动作。捕获和提交位于两个短 Photoshop 模态中，模型推理在模态外执行，因此面板运行时可以取消。发布 Addon 只读取当前用户 runtime-v2.ini，不包含开发 Python、ComfyUI 或模型路径。

静态测试：

    node --test plugin/tests/pure.test.js plugin/tests/coordinator.test.js
    node --check plugin/index.js

Adobe UXP Developer Tool 对 installer/stage/plugin/manifest.json 校验和打包，输出 com.fangrui.sam-selection_PS.ccx。
