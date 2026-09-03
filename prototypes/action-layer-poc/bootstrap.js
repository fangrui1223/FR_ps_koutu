"use strict";

const { entrypoints } = require("uxp");

entrypoints.setup({
  panels: {
    sam31PocPanel: {
      show() {}
    }
  },
  commands: {
    runLayerAlphaPoc() {},
    runForcedFailurePoc() {
      throw new Error("PoC forced failure");
    }
  }
});
