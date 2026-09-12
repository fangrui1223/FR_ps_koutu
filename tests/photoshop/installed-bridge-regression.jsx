#target photoshop
// Run only on an explicitly named disposable QA duplicate. Never saves images.
(function () {
    if (!app.documents.length || app.activeDocument.name.indexOf("FR-SAM-0.9.3-QA") !== 0) {
        throw Error("Open a disposable FR-SAM-0.9.3-QA duplicate first.");
    }
    var source = app.activeDocument;
    var script = new File(Folder.userData.fsName + "/Adobe/Adobe Photoshop 2026/Presets/Scripts/FR SAM Text Selection Image Processor.jsx");
    if ($.global.frSamTestSourceBridge === true) {
        script = new File(new File($.fileName).parent.parent.parent.fsName + "/legacy/SAM31 Image Processor Bridge.jsx");
    }
    if (!script.exists) throw Error("Installed Image Processor bridge is missing.");
    var previousParameters = app.playbackParameters;
    var previousDialogs = app.displayDialogs;
    var results = ["bridge=" + script.fsName];
    function run(promptText, threshold) {
        var descriptor = new ActionDescriptor();
        descriptor.putString(stringIDToTypeID("sam31Prompt"), promptText);
        descriptor.putDouble(stringIDToTypeID("sam31Threshold"), threshold || 0.5);
        app.playbackParameters = descriptor;
        $.evalFile(script);
    }
    function assertFullCanvas(label) {
        var w = source.width.as("px"), h = source.height.as("px");
        var b = source.selection.bounds;
        if (b[0].as("px") !== 0 || b[1].as("px") !== 0 || b[2].as("px") !== w || b[3].as("px") !== h) throw Error("Not full canvas: " + b);
        var oldState = source.activeHistoryState;
        var oldChannels = source.activeChannels;
        try {
            var channel = source.channels.add();
            source.selection.store(channel);
            source.selection.deselect();
            if (channel.histogram[255] !== w * h) throw Error("Full bounds but not all 255 pixels.");
        } finally {
            source.activeHistoryState = oldState;
            source.activeChannels = oldChannels;
        }
        results.push(label + ": full canvas, 255 pixels=" + w * h);
    }
    try {
        app.displayDialogs = DialogModes.NO;
        for (var i = 0; i < 3; i++) {
            source.selection.deselect();
            var count = app.documents.length;
            var layerCount = source.layers.length;
            var activeLayer = source.activeLayer.name;
            run("pants, trousers");
            if (app.activeDocument !== source || app.documents.length !== count || source.layers.length !== layerCount || source.activeLayer.name !== activeLayer) {
                throw Error("Bridge leaked a document/layer or changed the active layer.");
            }
            var bounds = source.selection.bounds;
            results.push("success-" + (i + 1) + ": selection=" + bounds);
        }
        source.selection.select([[2800,2200],[4200,2200],[4200,4800],[2800,4800]]);
        var channelsBefore = source.channels.length;
        run("airplane");
        assertFullCanvas("no-object with original ROI");
        source.selection.feather(1);
        if (source.channels.length !== channelsBefore || source.layers.length !== layerCount || app.documents.length !== count) {
            throw Error("Fallback leaked a channel/layer/document.");
        }
        source.selection.deselect();
        run("airplane", 0.95);
        assertFullCanvas("no-object without ROI at threshold 0.95");
        source.selection.select([[2800,2200],[4200,2200],[4200,4800],[2800,4800]]);
        var before = source.selection.bounds.toString();
        var invalidFailed = false;
        try { run("裤子"); } catch (error) { invalidFailed = true; }
        if (!invalidFailed || source.selection.bounds.toString() !== before) throw Error("Invalid prompt must error and preserve ROI.");
        run("pants");
        var restricted = source.selection.bounds;
        if (restricted[0].as("px") < 2800 || restricted[1].as("px") < 2200 || restricted[2].as("px") > 4200 || restricted[3].as("px") > 4800) {
            throw Error("Bridge output escaped the original selection: " + restricted + "; script=" + script.fsName);
        }
        results.push("strict-ROI: " + restricted);
        source.selection.feather(1); // A following Photoshop command must be able to use the result.
        results.push("PASS: 3 successes; no-object selects all with/without ROI; input error preserves ROI; strict successful ROI and following commands succeed.");
    } finally {
        app.playbackParameters = previousParameters;
        app.displayDialogs = previousDialogs;
        app.activeDocument = source;
    }
    return results.join("\n");
}());
