#target photoshop
// Uses the real ExtendScript compiler without running inference or touching a document.
(function () {
    var root = new File($.fileName).parent.parent.parent;
    var files = [
        new File(root.fsName + "/legacy/SAM31 Image Processor Bridge.jsx"),
        new File(Folder.userData.fsName + "/Adobe/Adobe Photoshop 2026/Presets/Scripts/FR SAM Text Selection Image Processor.jsx")
    ];
    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        file.encoding = "UTF8";
        if (!file.open("r")) throw Error("Cannot read bridge script: " + file.name);
        var code = file.read();
        file.close();
        new Function(code.replace(/^#target[^\r\n]*/m, ""));
    }
    return "PASS: source and installed bridge compile in Photoshop ExtendScript.";
}());
