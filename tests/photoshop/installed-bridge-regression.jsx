#target photoshop
// Run only on an explicitly named disposable QA duplicate. Never saves images.
(function () {
    if (!app.documents.length || app.activeDocument.name.indexOf("FR-SAM-0.9.2-QA") !== 0) {
        throw Error("Open a disposable FR-SAM-0.9.2-QA duplicate first.");
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
    function run(promptText) {
        var descriptor = new ActionDescriptor();
        descriptor.putString(stringIDToTypeID("sam31Prompt"), promptText);
        descriptor.putDouble(stringIDToTypeID("sam31Threshold"), 0.5);
        app.playbackParameters = descriptor;
        $.evalFile(script);
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
        var before = source.selection.bounds.toString();
        var historyBefore = source.activeHistoryState.name;
        var channelsBefore = source.channels.length;
        var failed = false;
        try { run("airplane"); } catch (error) {
            if (!/No candidate met|NO_OBJECT|No object/i.test(error.message)) throw error;
            failed = true;
            results.push("expected-no-object: " + error.message);
        }
        if (!failed) throw Error("Expected no-object error for airplane.");
        if (source.selection.bounds.toString() !== before || source.activeHistoryState.name !== historyBefore || source.channels.length !== channelsBefore) {
            throw Error("Failure changed the original selection/history.");
        }
        run("pants");
        var restricted = source.selection.bounds;
        if (restricted[0].as("px") < 2800 || restricted[1].as("px") < 2200 || restricted[2].as("px") > 4200 || restricted[3].as("px") > 4800) {
            throw Error("Bridge output escaped the original selection: " + restricted + "; script=" + script.fsName);
        }
        results.push("strict-ROI: " + restricted);
        source.selection.feather(1); // A following Photoshop command must be able to use the result.
        results.push("PASS: 3 consecutive calls; no-object preserves selection/active history; strict ROI and following command succeed.");
    } finally {
        app.playbackParameters = previousParameters;
        app.displayDialogs = previousDialogs;
        app.activeDocument = source;
    }
    return results.join("\n");
}());
