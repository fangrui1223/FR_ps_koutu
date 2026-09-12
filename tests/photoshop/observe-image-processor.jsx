#target photoshop
// Diagnostic-only runner: use Adobe's actual dialog and execution routine,
// redirect output to a fresh QA directory, and do not change saved IP settings.
(function () {
    if (app.documents.length) throw Error("Close documents before this batch observation test.");
    var sourceDir = new Folder("D:/1--拍摄/2026/08.10-无影墙模特十九-裤子/测试");
    if (!sourceDir.exists) throw Error("The approved source folder is missing.");
    var repo = new File($.fileName).parent.parent.parent;
    var work = new Folder(repo.fsName + "/work");
    if (!work.exists) throw Error("QA work folder is missing.");
    var output = new Folder(work.fsName + "/batch-focus-" + new Date().getTime());
    if (output.exists || !output.create()) throw Error("Cannot create a fresh QA output directory.");
    var script = new File(app.path.fsName + "/Presets/Scripts/Image Processor.jsx");
    script.encoding = "UTF8";
    if (!script.open("r")) throw Error("Cannot read Adobe Image Processor.");
    var code;
    try { code = script.read(); } finally { script.close(); }
    var dialogMarker = "gIP.CreateDialog();";
    var saveMarker = "gIP.SaveParamsToDisk( GetDefaultParamsFile() );";
    if (code.split(dialogMarker).length !== 2 || code.split(saveMarker).length !== 2) throw Error("Unrecognized Adobe script: do not patch.");
    function quote(value) { return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
    code = code.replace(/^#target photoshop\s*$/m, "");
    code = code.replace(dialogMarker,
        'gIP.params["source"]=' + quote(sourceDir.fsName) + ';' +
        'gIP.params["dest"]=' + quote(output.fsName) + ';' +
        'gIP.params["useopen"]=false;gIP.params["includesub"]=true;gIP.params["open"]=false;' +
        'gIP.params["saveinsame"]=false;gIP.params["keepstructure"]=true;' +
        'gIP.params["jpeg"]=true;gIP.params["q"]=12;gIP.params["jpegresize"]=false;' +
        'gIP.params["psd"]=false;gIP.params["tiff"]=false;gIP.params["converticc"]=false;gIP.params["icc"]=true;' +
        'gIP.params["runaction"]=true;gIP.params["actionset"]="自建动作";' +
        'gIP.params["action"]="绿色上衣SAM抠图调色-脚本";' + dialogMarker);
    code = code.replace(saveMarker, "/* QA: preserve the user Image Processor settings. */");
    var result = new File(work.fsName + "/batch-focus-observation.txt");
    result.encoding = "UTF8";
    if (!result.open("w")) throw Error("Cannot write QA report.");
    try { result.writeln("OUTPUT=" + output.fsName); result.writeln("START=" + new Date().toString()); } finally { result.close(); }
    var before = new Date().getTime();
    try { eval(code); } finally {
        if (result.open("a")) {
            try { result.writeln("END=" + new Date().toString()); result.writeln("ELAPSED_MS=" + (new Date().getTime() - before)); } finally { result.close(); }
        }
    }
}());
