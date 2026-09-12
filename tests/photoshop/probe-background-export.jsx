#target photoshop
// Feasibility probe only. Does not alter the installed bridge or source image.
(function () {
    if (app.documents.length) throw Error("Run only when Photoshop has no open documents.");
    var root = new File($.fileName).parent.parent.parent;
    var dir = new Folder(root.fsName + "/work/export-probe-" + new Date().getTime());
    if (dir.exists || !dir.create()) throw Error("Cannot create fresh probe folder.");
    var source = new File(Folder.userData.fsName + "/Adobe/Adobe Photoshop 2026/Presets/Scripts/FR SAM Text Selection Image Processor.jsx");
    source.encoding = "UTF8";
    if (!source.open("r")) throw Error("Cannot read installed bridge.");
    var text;
    try { text = source.read(); } finally { source.close(); }
    var start = text.indexOf("    function hasSelection(doc)");
    var end = text.indexOf("    function placedCanvasFrame()");
    if (start < 0 || end <= start) throw Error("Unrecognized installed bridge.");
    eval(text.substring(start, end));
    var oldDialogs = app.displayDialogs, doc;
    var messages = ["OUTPUT=" + dir.fsName];
    try {
        app.displayDialogs = DialogModes.NO;
        doc = app.open(new File("D:/1--拍摄/2026/08.10-无影墙模特十九-裤子/测试/182A7638.jpg"));
        if (doc.layers.length !== 1 || !doc.activeLayer.isBackgroundLayer || hasSelection(doc)) throw Error("Not a single-background no-ROI image.");
        var history = doc.activeHistoryState, originalName = doc.name, layer = doc.activeLayer;
        var t = new Date().getTime();
        saveInputPlanes(doc, new File(dir.fsName + "/baseline.png"), new File(dir.fsName + "/unused-roi.png"));
        messages.push("BASELINE_MS=" + (new Date().getTime() - t));
        t = new Date().getTime();
        var options = new PNGSaveOptions(); options.interlaced = false;
        doc.saveAs(new File(dir.fsName + "/direct-copy.png"), options, true, Extension.LOWERCASE);
        messages.push("DIRECT_COPY_MS=" + (new Date().getTime() - t));
        if (app.documents.length !== 1 || app.activeDocument !== doc || doc.activeLayer !== layer || doc.name !== originalName || !doc.saved || doc.activeHistoryState !== history) throw Error("Direct export changed original document state.");
        messages.push("PASS: original document name, saved state, history, active layer, document count unchanged.");
    } catch (error) { messages.push("FAIL=" + error); throw error; }
    finally {
        if (doc) doc.close(SaveOptions.DONOTSAVECHANGES);
        app.displayDialogs = oldDialogs;
        var report = new File(root.fsName + "/work/export-probe-report.txt"); report.encoding = "UTF8";
        if (report.open("w")) { try { report.write(messages.join("\n")); } finally { report.close(); } }
    }
}());
