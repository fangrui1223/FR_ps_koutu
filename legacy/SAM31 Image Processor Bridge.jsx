/*
<javascriptresource>
<name>SAM 3.1 图像处理器桥接</name>
<category>SAM 3.1</category>
<eventid>sam31ImageProcessorBridge</eventid>
<terminology><![CDATA[<< /Version 1 /Events <<
/sam31ImageProcessorBridge [(SAM 3.1 Image Processor Bridge) <<
/sam31Prompt [(Prompt) /string]
/sam31Threshold [(Threshold) /double]
>>]
>> >>]]></terminology>
</javascriptresource>
*/

#target photoshop

(function () {
    var KEY_PROMPT = stringIDToTypeID("sam31Prompt");
    var KEY_THRESHOLD = stringIDToTypeID("sam31Threshold");
    var SESSION_ROOT = new Folder(Folder.temp.fsName + "/sam31-selection-legacy");
    // Prepare-Release.ps1 changes this marker to false in the installer payload.
    var ALLOW_DEV_FALLBACK = true; // @sam31-release-dev-fallback
    // @sam31-dev-runtime-begin
    var DEV_RUNTIME = {
        python: "C:/FR_comfyui/python/python.exe",
        backend: "D:/FR_AI/FR_ps_koutu/backend",
        model: "D:/FR_AI/FR_ps_koutu/models/sam3.1_multiplex_fp16.safetensors",
        officialSam3: "D:/FR_AI/FR_ps_koutu/work/sam3-official"
    };
    // @sam31-dev-runtime-end

    function fail(message) {
        throw new Error("SAM 3.1: " + message);
    }

    function actionParameters() {
        var playback = app.playbackParameters;
        var promptValue;
        var thresholdValue;
        if (playback && playback.count > 0 && playback.hasKey(KEY_PROMPT)) {
            promptValue = playback.getString(KEY_PROMPT);
            thresholdValue = playback.hasKey(KEY_THRESHOLD) ? playback.getDouble(KEY_THRESHOLD) : 0.5;
        } else {
            promptValue = prompt("请输入英文提示词（多个候选用逗号分隔）：", "pants", "SAM 3.1 图像处理器动作");
            if (promptValue === null) fail("已取消录制。");
            var thresholdText = prompt("请输入最低置信度（0.05–0.95）：", "0.50", "SAM 3.1 图像处理器动作");
            if (thresholdText === null) fail("已取消录制。");
            thresholdValue = Number(thresholdText);
            var descriptor = new ActionDescriptor();
            descriptor.putString(KEY_PROMPT, promptValue);
            descriptor.putDouble(KEY_THRESHOLD, thresholdValue);
            app.playbackParameters = descriptor;
        }
        promptValue = String(promptValue).replace(/^\s+|\s+$/g, "");
        if (!promptValue || !/^[A-Za-z0-9][A-Za-z0-9 '\-\/,]*$/.test(promptValue)) {
            fail("提示词只支持英文、数字、空格、逗号、连字符和斜杠。");
        }
        if (!(thresholdValue >= 0.05 && thresholdValue <= 0.95)) fail("最低置信度必须在 0.05–0.95 之间。");
        return { prompt: promptValue, threshold: Math.round(thresholdValue * 100) / 100 };
    }

    function ensureFolder(folder) {
        if (!folder.exists && !folder.create()) fail("无法创建临时目录。");
    }

    function removeTree(folder) {
        if (!folder || !folder.exists) return;
        var files = folder.getFiles();
        for (var i = 0; i < files.length; i += 1) {
            if (files[i] instanceof Folder) removeTree(files[i]);
            else files[i].remove();
        }
        folder.remove();
    }

    function writeText(file, value) {
        file.encoding = "UTF8";
        if (!file.open("w")) fail("无法写入本地请求。");
        file.write(value);
        file.close();
    }

    function readText(file) {
        file.encoding = "UTF8";
        if (!file.open("r")) fail("无法读取本地响应。");
        var value = file.read();
        file.close();
        return value;
    }

    function jsonString(value) {
        var source = String(value);
        var result = '"';
        for (var i = 0; i < source.length; i += 1) {
            var code = source.charCodeAt(i);
            var ch = source.charAt(i);
            if (ch === '"') result += '\\"';
            else if (ch === "\\") result += "\\\\";
            else if (code === 8) result += "\\b";
            else if (code === 9) result += "\\t";
            else if (code === 10) result += "\\n";
            else if (code === 12) result += "\\f";
            else if (code === 13) result += "\\r";
            else if (code < 32) result += "\\u" + ("000" + code.toString(16)).slice(-4);
            else result += ch;
        }
        return result + '"';
    }

    function jsonStringify(value) {
        if (value === null) return "null";
        var kind = typeof value;
        if (kind === "string") return jsonString(value);
        if (kind === "number") return isFinite(value) ? String(value) : "null";
        if (kind === "boolean") return value ? "true" : "false";
        if (value instanceof Array) {
            var items = [];
            for (var i = 0; i < value.length; i += 1) items.push(jsonStringify(value[i]));
            return "[" + items.join(",") + "]";
        }
        if (kind === "object") {
            var fields = [];
            for (var key in value) {
                if (value.hasOwnProperty(key) && typeof value[key] !== "undefined" && typeof value[key] !== "function") {
                    fields.push(jsonString(key) + ":" + jsonStringify(value[key]));
                }
            }
            return "{" + fields.join(",") + "}";
        }
        fail("无法序列化本地请求。");
    }

    function jsonParse(value) {
        return eval("(" + value + ")");
    }

    function trim(value) {
        return String(value).replace(/^\s+|\s+$/g, "");
    }

    function safeInstalledPath(value, label) {
        value = trim(value);
        if (!value || /[\r\n\"%!^&|<>]/.test(value)) {
            fail("运行时配置中的 " + label + " 路径无效。");
        }
        return value;
    }

    function relativeInstalledPath(root, value, label, folderExpected) {
        value = safeInstalledPath(value, label).replace(/\\/g, "/");
        if (/^[A-Za-z]:\//.test(value) || /^\/\//.test(value) || /(^|\/)\.\.($|\/)/.test(value)) {
            fail("运行时配置中的 " + label + " 必须位于安装目录内。");
        }
        var entry = folderExpected ? new Folder(root + "/" + value) : new File(root + "/" + value);
        if (!entry.exists) fail("运行时配置中的 " + label + " 不存在。");
        return entry.fsName;
    }

    function loadRuntimeConfig() {
        var programData = $.getenv("PROGRAMDATA");
        var configFile = programData ?
            new File(programData + "/FR/SAM31 Photoshop Selection/runtime-v1.ini") : null;
        if (!configFile || !configFile.exists) {
            if (ALLOW_DEV_FALLBACK) return DEV_RUNTIME;
            fail("未安装 SAM 3.1 本地运行时，请先运行 Windows 后端安装程序。");
        }
        var content = readText(configFile).replace(/^\uFEFF/, "");
        var lines = content.split(/\r?\n/);
        var values = {};
        var allowed = {
            schemaVersion: true,
            installRoot: true,
            python: true,
            backend: true,
            model: true,
            officialSam3: true
        };
        for (var i = 0; i < lines.length; i += 1) {
            var line = trim(lines[i]);
            if (!line || line.charAt(0) === "#") continue;
            var equals = line.indexOf("=");
            if (equals < 1) fail("运行时配置第 " + (i + 1) + " 行无效。");
            var key = trim(line.substring(0, equals));
            var value = trim(line.substring(equals + 1));
            if (!allowed[key] || !value || typeof values[key] !== "undefined") {
                fail("运行时配置第 " + (i + 1) + " 行包含未知、重复或空字段。");
            }
            values[key] = value;
        }
        for (var required in allowed) {
            if (allowed.hasOwnProperty(required) && typeof values[required] === "undefined") {
                fail("运行时配置缺少字段：" + required + "。");
            }
        }
        if (values.schemaVersion !== "1") fail("不支持的 SAM 3.1 运行时配置版本。");
        var rootText = safeInstalledPath(values.installRoot, "installRoot");
        if (!/^[A-Za-z]:[\\\/]/.test(rootText)) fail("installRoot 必须是绝对路径。");
        var root = new Folder(rootText);
        if (!root.exists) fail("SAM 3.1 安装目录不存在。");
        return {
            python: relativeInstalledPath(root.fsName, values.python, "Python", false),
            backend: relativeInstalledPath(root.fsName, values.backend, "backend", true),
            model: relativeInstalledPath(root.fsName, values.model, "model", false),
            officialSam3: relativeInstalledPath(root.fsName, values.officialSam3, "officialSam3", true)
        };
    }

    function q(value) {
        value = String(value);
        if (/[\r\n\"%!^&|<>]/.test(value)) fail("本地命令路径包含不支持的字符。");
        return '"' + value + '"';
    }

    function saveActiveLayer(doc, file) {
        var original = app.activeDocument;
        var exportDoc = null;
        try {
            var sourceLayer = doc.activeLayer;
            exportDoc = app.documents.add(
                doc.width,
                doc.height,
                doc.resolution,
                "SAM31-input",
                NewDocumentMode.RGB,
                DocumentFill.TRANSPARENT,
                1,
                BitsPerChannelType.EIGHT
            );
            var placeholder = exportDoc.activeLayer;
            app.activeDocument = doc;
            var copied = sourceLayer.duplicate(exportDoc, ElementPlacement.PLACEATBEGINNING);
            app.activeDocument = exportDoc;
            copied.visible = true;
            copied.blendMode = BlendMode.NORMAL;
            try { copied.grouped = false; } catch (ignored) {}
            placeholder.remove();
            var options = new PNGSaveOptions();
            options.interlaced = false;
            exportDoc.saveAs(file, options, true, Extension.LOWERCASE);
        } finally {
            if (exportDoc) exportDoc.close(SaveOptions.DONOTSAVECHANGES);
            app.activeDocument = original;
        }
    }

    function hasSelection(doc) {
        try {
            var bounds = doc.selection.bounds;
            return bounds && bounds.length === 4;
        } catch (ignored) {
            return false;
        }
    }

    function white() {
        var color = new SolidColor();
        color.rgb.red = 255;
        color.rgb.green = 255;
        color.rgb.blue = 255;
        return color;
    }

    function saveSelection(doc, file) {
        if (!hasSelection(doc)) return false;
        var original = app.activeDocument;
        var roiDoc = null;
        try {
            roiDoc = doc.duplicate("SAM31-roi", false);
            var layers = [];
            for (var i = 0; i < roiDoc.layers.length; i += 1) layers.push(roiDoc.layers[i]);
            var maskLayer = roiDoc.artLayers.add();
            maskLayer.name = "SAM31 temporary ROI";
            for (var j = 0; j < layers.length; j += 1) layers[j].visible = false;
            roiDoc.selection.fill(white(), ColorBlendMode.NORMAL, 100, false);
            var options = new PNGSaveOptions();
            options.interlaced = false;
            roiDoc.saveAs(file, options, true, Extension.LOWERCASE);
            return true;
        } finally {
            if (roiDoc) roiDoc.close(SaveOptions.DONOTSAVECHANGES);
            app.activeDocument = original;
        }
    }

    function loadTransparencySelection(doc, maskFile) {
        var maskDoc = null;
        var selectionLayer = null;
        try {
            maskDoc = app.open(maskFile);
            maskDoc.activeLayer.duplicate(doc, ElementPlacement.PLACEATBEGINNING);
            maskDoc.close(SaveOptions.DONOTSAVECHANGES);
            maskDoc = null;
            app.activeDocument = doc;
            selectionLayer = doc.activeLayer;
            var setDescriptor = new ActionDescriptor();
            var destination = new ActionReference();
            destination.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
            setDescriptor.putReference(charIDToTypeID("null"), destination);
            var transparency = new ActionReference();
            transparency.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("Trsp"));
            setDescriptor.putReference(charIDToTypeID("T   "), transparency);
            executeAction(charIDToTypeID("setd"), setDescriptor, DialogModes.NO);
        } finally {
            if (maskDoc) maskDoc.close(SaveOptions.DONOTSAVECHANGES);
            app.activeDocument = doc;
            if (selectionLayer) selectionLayer.remove();
        }
    }

    function splitPrompts(value) {
        var raw = value.split(",");
        var prompts = [];
        var seen = {};
        for (var i = 0; i < raw.length; i += 1) {
            var item = raw[i].replace(/^\s+|\s+$/g, "").replace(/\s+/g, " ");
            var key = item.toLowerCase();
            if (item && !seen[key]) {
                seen[key] = true;
                prompts.push(item);
            }
        }
        if (prompts.length < 1 || prompts.length > 5) fail("提示词候选必须为 1–5 个。");
        return prompts;
    }

    var runtime = loadRuntimeConfig();
    var parameters = actionParameters();
    if (!app.documents.length) fail("没有活动文档。");
    var doc = app.activeDocument;
    if (doc.mode !== DocumentMode.RGB || doc.bitsPerChannel !== BitsPerChannelType.EIGHT) {
        fail("只支持 RGB 8 位文档。");
    }
    if (doc.activeLayer.kind !== LayerKind.NORMAL && doc.activeLayer.kind !== LayerKind.SMARTOBJECT) {
        fail("只支持普通像素图层和智能对象。");
    }

    ensureFolder(SESSION_ROOT);
    var requestId = "jsx-" + new Date().getTime() + "-" + Math.floor(Math.random() * 100000000);
    var requestFolder = new Folder(SESSION_ROOT.fsName + "/" + requestId);
    ensureFolder(requestFolder);
    var inputFile = new File(requestFolder.fsName + "/input.png");
    var roiFile = new File(requestFolder.fsName + "/roi.png");
    var maskFile = new File(requestFolder.fsName + "/mask.png");
    var requestFile = new File(requestFolder.fsName + "/request.json");
    var responseFile = new File(requestFolder.fsName + "/response.json");

    try {
        saveActiveLayer(doc, inputFile);
        var hasRoi = saveSelection(doc, roiFile);
        var width = Math.round(doc.width.as("px"));
        var height = Math.round(doc.height.as("px"));
        var bounds = { left: 0, top: 0, right: width, bottom: height };
        var request = {
            schemaVersion: 1,
            requestId: requestId,
            modelId: "sam3.1-multiplex-fp16",
            prompts: splitPrompts(parameters.prompt),
            threshold: parameters.threshold,
            document: { width: width, height: height },
            input: { file: requestId + "/input.png", encoding: "png-rgba8", width: width, height: height, bounds: bounds },
            roi: hasRoi ? { file: requestId + "/roi.png", encoding: "png-alpha8", width: width, height: height, bounds: bounds } : null,
            output: { file: requestId + "/mask.png", encoding: "png-alpha8" }
        };
        try { request.document.sourcePath = doc.fullName.fsName; } catch (ignored) {}
        writeText(requestFile, jsonStringify(request));

        var bridgeScript = runtime.backend + "/sam31_backend/legacy_bridge.py";
        var commandLine = q(runtime.python) + " " + q(bridgeScript) +
            " --session-root " + q(SESSION_ROOT.fsName) +
            " --request-file " + q(requestFile.fsName) +
            " --response-file " + q(responseFile.fsName) +
            " --model-checkpoint " + q(runtime.model) +
            " --official-sam3-root " + q(runtime.officialSam3);
        var command = 'cmd.exe /d /s /c "' + commandLine + '"';
        var exitCode = app.system(command);
        if (exitCode !== 0 || !responseFile.exists) {
            fail("本地后端技术故障，自动重试后仍失败（退出码 " + exitCode + "）。");
        }
        var response = jsonParse(readText(responseFile));
        if (response.status !== "ok") {
            fail(response.error && response.error.message ? response.error.message : "本地推理失败。");
        }
        if (response.requestId !== requestId || !response.mask || response.mask.file !== request.output.file ||
            response.mask.encoding !== "png-alpha8" || !maskFile.exists) {
            fail("本地后端返回了不匹配的响应。");
        }
        loadTransparencySelection(doc, maskFile);
    } finally {
        app.activeDocument = doc;
        removeTree(requestFolder);
    }
}());
