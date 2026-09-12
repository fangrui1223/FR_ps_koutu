#target photoshop

// Recovery helper for a missing runtime config in Photoshop's filesystem view.
// Caller supplies an explicit, installer-generated config source. This does not
// invent install/model paths, change permissions, or replace an existing config.
(function () {
    function fail(message) { throw new Error("FR SAM runtime repair: " + message); }
    var sourcePath = $.global.__frSamRepairConfigSource;
    if (!sourcePath) fail("An explicit configuration source is required.");
    var source = new File(sourcePath);
    source.encoding = "UTF8";
    if (!source.exists || !source.open("r")) fail("Cannot read the supplied configuration.");
    var content;
    try { content = source.read().replace(/^\uFEFF/, ""); } finally { source.close(); }
    var values = {}, lines = content.split(/\r?\n/);
    var allowed = { schemaVersion: true, installRoot: true, python: true, backend: true, model: true, officialSam3: true };
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/^\s+|\s+$/g, "");
        if (!line || line.charAt(0) === "#") continue;
        var equals = line.indexOf("=");
        if (equals < 1) fail("Malformed configuration.");
        var key = line.substring(0, equals).replace(/^\s+|\s+$/g, "");
        var value = line.substring(equals + 1).replace(/^\s+|\s+$/g, "");
        if (!allowed[key] || !value || typeof values[key] !== "undefined") fail("Invalid configuration field.");
        values[key] = value;
    }
    for (var required in allowed) {
        if (allowed.hasOwnProperty(required) && typeof values[required] === "undefined") fail("Missing " + required);
    }
    if (values.schemaVersion !== "2") fail("Only installer-generated v2 configurations are supported.");
    if (!/^[A-Za-z]:[\\\/]/.test(values.installRoot) || !/^[A-Za-z]:[\\\/]/.test(values.model)) fail("Absolute install/model paths are required.");
    var install = new Folder(values.installRoot);
    if (!install.exists || !(new File(values.model)).exists) fail("Installed runtime or external model is not visible in Photoshop.");
    var children = ["python", "backend", "officialSam3"];
    for (var c = 0; c < children.length; c++) {
        var relative = values[children[c]].replace(/\\/g, "/");
        if (/^\//.test(relative) || /:/.test(relative) || /(^|\/)\.\.($|\/)/.test(relative)) fail("Unsafe relative runtime path.");
        var childPath = install.fsName + "/" + relative;
        var child = children[c] === "python" ? new File(childPath) : new Folder(childPath);
        if (!child.exists) fail("Configured " + children[c] + " is not visible in Photoshop.");
    }
    var local = $.getenv("LOCALAPPDATA");
    if (!local || !(new Folder(local)).exists) fail("LocalAppData is unavailable.");
    var parent = new Folder(local + "/FR");
    var product = new Folder(parent.fsName + "/FR SAM Text Selection");
    var target = new File(product.fsName + "/runtime-v2.ini");
    if (target.exists) fail("Target already exists; refusing to overwrite it.");
    if (!parent.exists && !parent.create()) fail("Cannot create the current-user FR directory: " + parent.error);
    if (!product.exists && !product.create()) fail("Cannot create the product configuration directory: " + product.error);
    if (!source.copy(target.fsName)) fail("Cannot copy configuration: " + source.error);
    target = new File(target.fsName);
    target.encoding = "UTF8";
    if (!target.exists || !target.open("r")) fail("Configuration is still unreadable after copying.");
    var actual;
    try { actual = target.read().replace(/^\uFEFF/, ""); } finally { target.close(); }
    if (actual !== content) fail("Copied configuration differs from its source.");
    return "PASS: Photoshop can read " + target.fsName;
}());
