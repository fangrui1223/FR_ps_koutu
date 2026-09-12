#target photoshop
// Real-host comparison against the pre-update installed bridge. QA documents only.
(function () {
    if (app.documents.length) throw Error("Close documents before this QA test.");
    var root = new File($.fileName).parent.parent.parent;
    var output = new Folder(root.fsName + "/work/batch-ui-QA-" + new Date().getTime());
    if (output.exists || !output.create()) throw Error("Fresh output directory required.");
    function read(file) { file.encoding = "UTF8"; if (!file.open("r")) throw Error("Cannot read " + file); var text = file.read(); file.close(); return text; }
    function helpers(file) { var text = read(file); return text.substring(text.indexOf("    function hasSelection(doc)"), text.indexOf("    function splitPrompts(value)")); }
    function fail(message) { throw Error(message); }
    function check(value, message) { if (!value) fail(message); }
    var baseline = $.global.__frSamBaselineBridge || (Folder.userData.fsName + "/Adobe/Adobe Photoshop 2026/Presets/Scripts/FR SAM Text Selection Image Processor.jsx");
    var oldSource = helpers(new File(baseline));
    if (oldSource.indexOf("function canExportBackgroundDirectly") >= 0) throw Error("Supply the pre-update backup via __frSamBaselineBridge for a meaningful comparison.");
    var newSource = helpers(new File(root.fsName + "/legacy/SAM31 Image Processor Bridge.jsx"));
    var messages = ["OUTPUT=" + output.fsName], doc = null, dialogs = app.displayDialogs;
    var options = new PNGSaveOptions(); options.interlaced = false;
    function saveSelection(name) {
        var state = doc.activeHistoryState;
        try {
            var originalLayer = doc.activeLayer;
            var layer = doc.artLayers.add();
            if (originalLayer.visible) originalLayer.visible = false;
            doc.selection.fill(white(), ColorBlendMode.NORMAL, 100, false);
            doc.saveAs(new File(output.fsName + "/" + name + ".png"), options, true, Extension.LOWERCASE);
        } finally { doc.activeHistoryState = state; }
    }
    try {
        app.displayDialogs = DialogModes.NO;
        doc = app.open(new File("D:/1--拍摄/2026/08.10-无影墙模特十九-裤子/测试/182A7638.jpg"));
        eval(oldSource);
        var history = doc.activeHistoryState, layer = doc.activeLayer;
        var started = new Date().getTime();
        saveInputPlanes(doc, new File(output.fsName + "/export-old.png"), null);
        messages.push("OLD_EXPORT_MS=" + (new Date().getTime() - started));
        eval(newSource);
        check(canExportBackgroundDirectly(doc, false), "Plain background should use direct export");
        check(!canExportBackgroundDirectly(doc, true), "ROI must disable direct export");
        started = new Date().getTime();
        saveInputPlanes(doc, new File(output.fsName + "/export-new.png"), null);
        messages.push("NEW_EXPORT_MS=" + (new Date().getTime() - started));
        check(app.documents.length === 1 && doc.saved && doc.activeHistoryState === history && doc.activeLayer === layer, "Export changed document state");
        doc.close(SaveOptions.DONOTSAVECHANGES); doc = null;
        for (var dpiIndex = 0; dpiIndex < 2; dpiIndex += 1) {
            var dpi = dpiIndex ? 300 : 72;
            doc = app.documents.add(UnitValue(320, "px"), UnitValue(240, "px"), dpi, "FR-SAM-BATCH-UI-QA", NewDocumentMode.RGB, DocumentFill.WHITE);
            var background = doc.activeLayer;
            var maskLayer = doc.artLayers.add(); background.visible = false;
            doc.selection.select([[61, 47], [179, 47], [179, 191], [61, 191]], SelectionType.REPLACE, 9, true);
            doc.selection.fill(white(), ColorBlendMode.NORMAL, 100, false);
            var mask = new File(output.fsName + "/mask-" + dpi + ".png");
            doc.saveAs(mask, options, true, Extension.LOWERCASE);
            maskLayer.remove(); background = doc.layers[0];
            if (!background.visible) background.visible = true;
            doc.activeLayer = background; doc.selection.deselect();
            eval(oldSource); loadTransparencySelection(doc, mask); saveSelection("selection-old-" + dpi);
            doc.selection.select([[20, 20], [100, 20], [100, 100], [20, 100]]);
            var inspected = false;
            // Instrument only the QA source, immediately after actual Place.
            var instrumented = newSource.replace('selectionLayer = doc.activeLayer;', 'selectionLayer = doc.activeLayer; check(selectionLayer.parent.typename === "LayerSet" && !selectionLayer.parent.visible, "Mask was not hidden at creation"); inspected = true;');
            eval(instrumented); loadTransparencySelection(doc, mask); saveSelection("selection-new-" + dpi);
            check(inspected && doc.layers.length === 1 && doc.activeLayer === background, "Temporary layers/state leaked");
            messages.push("PASS_HIDDEN_MASK_AND_LAYER_RESTORE_DPI=" + dpi);
            doc.close(SaveOptions.DONOTSAVECHANGES); doc = null;
        }
        messages.push("PASS");
    } catch (error) { messages.push("FAIL=" + error + " LINE=" + error.line); throw error; }
    finally {
        if (doc) doc.close(SaveOptions.DONOTSAVECHANGES);
        app.displayDialogs = dialogs;
        var report = new File(root.fsName + "/work/batch-ui-regression.txt"); report.encoding = "UTF8";
        if (report.open("w")) { report.write(messages.join("\n")); report.close(); }
    }
}());
