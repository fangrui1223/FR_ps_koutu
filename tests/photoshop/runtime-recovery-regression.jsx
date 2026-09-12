#target photoshop
(function () {
    if (!app.documents.length || app.activeDocument.name !== "FR-SAM-RUNTIME-QA-20260912") throw Error("Use the runtime QA duplicate only.");
    var doc = app.activeDocument, results = [];
    var report = new File(new File($.fileName).parent.parent.parent.fsName + "/work/runtime-recovery-regression.txt");
    function record(message) {
        results.push(message);
        report.encoding = "UTF8";
        if (!report.open("w")) throw Error("Cannot write QA report: " + report.error);
        try { report.write(results.join("\n")); } finally { report.close(); }
    }
    record("START: " + new Date().toString());
    var previousDialogs = app.displayDialogs, previousParameters = app.playbackParameters;
    var initialState = doc.activeHistoryState, initialLayer = doc.activeLayer;
    var initialChannels = doc.activeChannels;
    var docCount = app.documents.length, layerCount = doc.layers.length, channelCount = doc.channels.length;
    function parameters(prompt, threshold) {
        var desc = new ActionDescriptor();
        desc.putString(stringIDToTypeID("sam31Prompt"), prompt);
        desc.putDouble(stringIDToTypeID("sam31Threshold"), threshold);
        return desc;
    }
    function assertNoLeaks() {
        if (app.activeDocument !== doc || app.documents.length !== docCount || doc.layers.length !== layerCount || doc.channels.length !== channelCount) throw Error("Leaked document/layer/channel.");
    }
    function fullCount() {
        var state = doc.activeHistoryState, channels = doc.activeChannels;
        try {
            var channel = doc.channels.add();
            doc.selection.store(channel);
            doc.selection.deselect();
            return channel.histogram[255];
        } finally { doc.activeHistoryState = state; doc.activeChannels = channels; }
    }
    try {
        app.displayDialogs = DialogModes.NO;
        doc.selection.deselect();
        executeAction(stringIDToTypeID("sam31ImageProcessorBridge"), parameters("green top", 0.5), DialogModes.NO);
        var b = doc.selection.bounds;
        if (fullCount() === doc.width.as("px") * doc.height.as("px")) throw Error("Normal detection unexpectedly returned full canvas.");
        assertNoLeaks();
        record("Registered menu event: green top selected, not full-canvas fallback.");

        doc.selection.select([[100,100],[300,100],[300,300],[100,300]]);
        executeAction(stringIDToTypeID("sam31ImageProcessorBridge"), parameters("airplane", 0.95), DialogModes.NO);
        var total = doc.width.as("px") * doc.height.as("px");
        if (fullCount() !== total) throw Error("Registered menu event did not select every pixel on NO_OBJECT.");
        assertNoLeaks();
        var beforeCopy = doc.activeHistoryState;
        executeAction(stringIDToTypeID("copyToLayer"), undefined, DialogModes.NO);
        if (doc.layers.length !== layerCount + 1) throw Error("Following copy-to-layer failed.");
        record("Registered menu event: NO_OBJECT -> all " + total + " pixels; following copy-to-layer succeeded.");
        doc.activeHistoryState = beforeCopy;
        doc.activeLayer = initialLayer;

        doc.selection.deselect();
        app.playbackParameters = parameters("airplane", 0.95);
        $.evalFile(new File(Folder.userData.fsName + "/Adobe/Adobe Photoshop 2026/Presets/Scripts/FR SAM Text Selection Image Processor.jsx"));
        if (fullCount() !== total) throw Error("Formal bridge did not select every pixel on NO_OBJECT.");
        assertNoLeaks();
        record("Formal installed bridge: NO_OBJECT -> full canvas.");
    } catch (error) {
        record("FAIL: " + error.toString() + " / line " + error.line);
        throw error;
    } finally {
        app.activeDocument = doc;
        doc.activeHistoryState = initialState;
        doc.activeLayer = initialLayer;
        doc.activeChannels = initialChannels;
        app.displayDialogs = previousDialogs;
        app.playbackParameters = previousParameters;
    }
    record("PASS");
    return results.join("\n");
}());
