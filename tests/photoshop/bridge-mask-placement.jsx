#target photoshop
// Isolated full-canvas alpha-mask round trip; creates and discards only QA docs.
(function () {
    var original = app.documents.length ? app.activeDocument : null;
    var previousUnits = app.preferences.rulerUnits;
    var previousDialogs = app.displayDialogs;
    var source = new File(new File($.fileName).parent.parent.parent.fsName + "/legacy/SAM31 Image Processor Bridge.jsx");
    source.encoding = "UTF8";
    if (!source.open("r")) throw Error("Missing bridge source.");
    var code = source.read(); source.close();
    function fail(message) { throw Error(message); }
    eval(code.substring(code.indexOf("    function placedCanvasFrame("), code.indexOf("    function splitPrompts(")));
    var fixture = new File(Folder.temp.fsName + "/fr-sam-mask-test-" + new Date().getTime() + ".png");
    var doc = null;
    var rows = [];
    try {
        app.preferences.rulerUnits = Units.PIXELS;
        app.displayDialogs = DialogModes.NO;
        doc = app.documents.add(7637, 5094, 300, "FR-SAM-mask-QA", NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
        doc.selection.select([[80,90],[160,90],[160,220],[80,220]]);
        var color = new SolidColor(); color.rgb.red = 255; color.rgb.green = 255; color.rgb.blue = 255;
        doc.selection.fill(color);
        doc.saveAs(fixture, new PNGSaveOptions(), true, Extension.LOWERCASE);
        // The destination must differ from the mask, otherwise loading the
        // original layer's transparency could falsely pass this regression.
        doc.selection.selectAll();
        color.rgb.red = 100; color.rgb.green = 100; color.rgb.blue = 100;
        doc.selection.fill(color);
        for (var i = 0; i < 2; i++) {
            if (i === 0) doc.selection.deselect();
            else doc.selection.select([[25,35],[200,35],[200,250],[25,250]]);
            loadTransparencySelection(doc, fixture);
            var b = doc.selection.bounds;
            var actual = [b[0].as("px"), b[1].as("px"), b[2].as("px"), b[3].as("px")].join(",");
            if (actual !== "80,90,160,220") throw Error("Mask moved with ROI=" + i + ": " + actual);
            if (doc.layers.length !== 1) throw Error("Temporary mask layer leaked.");
            rows.push("ROI=" + i + ": " + actual);
        }
        var before = doc.selection.bounds.toString();
        var beforeState = doc.activeHistoryState.name;
        var realPlace = placeMaskAsHiddenLayer;
        placeMaskAsHiddenLayer = function (target) { target.selection.deselect(); throw Error("Injected place failure"); };
        var failed = false;
        try { loadTransparencySelection(doc, fixture); } catch (error) {
            if (error.message.indexOf("Injected place failure") < 0) throw error;
            failed = true;
        } finally { placeMaskAsHiddenLayer = realPlace; }
        if (!failed || doc.selection.bounds.toString() !== before || doc.activeHistoryState.name !== beforeState) {
            throw Error("Mask import failure did not restore the original selection.");
        }
        rows.push("import failure rolls back selection");
        return "PASS mask coordinate round trip: " + rows.join("; ");
    } finally {
        if (doc) doc.close(SaveOptions.DONOTSAVECHANGES);
        if (fixture.exists) fixture.remove();
        app.preferences.rulerUnits = previousUnits;
        app.displayDialogs = previousDialogs;
        if (original) app.activeDocument = original;
    }
}());
