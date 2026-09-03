"use strict";

const backend = require("./backend-client.js");
const { buildInferRequest, validateSuccessResponse } = require("./protocol.js");
const photoshopIo = require("./photoshop-io.js");
const sessionIo = require("./session-io.js");
const { createCoordinator } = require("./coordinator-core.js");

const { cancelActive, runSelection } = createCoordinator({
  backend,
  buildInferRequest,
  photoshopIo,
  sessionIo,
  validateSuccessResponse
});

module.exports = { cancelActive, runSelection };
