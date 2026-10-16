'use strict';
const session = require('./runtime-session.cjs');
const { bindContextBridgeCore } = require('./context-bridge-registry.cjs');
class ExperimentalRuntime extends session.ExperimentalRuntime {
  constructor(appInfo, options = {}) {
    super(appInfo, options);
    try {
      this.core = bindContextBridgeCore(this.core);
      this.contextHandles = this.core.context_registry(this.runtime);
    } catch (error) { this.abort(); throw error; }
  }
}
module.exports = { ...session, ExperimentalRuntime };
