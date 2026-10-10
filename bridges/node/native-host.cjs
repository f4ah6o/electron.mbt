'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { runtimeError } = require('./errors.cjs');
const { createSessionGate, encodeEnvelope } = require('./host-protocol.cjs');

const decoder = new TextDecoder('utf-8', { fatal: true });
const addonFile = path.resolve(__dirname, '../../dist/sync_channel.node');
const nativeBinary = path.resolve(__dirname, '../../dist/electron-mbt-native-host');

class NativeHost {
  constructor(appDir, options = {}) {
    if (process.platform !== 'darwin' && !options.testingExecutable) {
      throw runtimeError('ELECTRON_MBT_UNSUPPORTED_PLATFORM', 'Native host is macOS-only');
    }
    if (!fs.existsSync(addonFile)) throw runtimeError('ELECTRON_MBT_NOT_BUILT', 'Build the native Node-API channel');
    const binary = options.testingExecutable || nativeBinary;
    if (!fs.existsSync(binary)) throw runtimeError('ELECTRON_MBT_NOT_BUILT', 'Build the macOS native host');
    this.addon = require(addonFile);
    this.root = fs.realpathSync(appDir);
    if (!fs.statSync(this.root).isDirectory()) throw runtimeError('ELECTRON_MBT_APP_ROOT', 'Expected application directory');
    this.session = randomBytes(16).toString('hex');
    this.gate = createSessionGate(this.session);
    this.nextRequest = 0;
    this.dead = false;
    this.watchdogMs = options.watchdogMs || 12000;
    if (!Number.isSafeInteger(this.watchdogMs) || this.watchdogMs < 1 || this.watchdogMs > 60000) {
      throw runtimeError('ELECTRON_MBT_INVALID_ARGUMENT', 'Invalid native watchdog');
    }
    const [parent, child] = this.addon.pair();
    this.fd = parent;
    try {
      this.process = spawn(binary, options.testingArgs || [this.root], {
        stdio: ['ignore', 'ignore', 'pipe', child],
        env: { ...process.env, ELECTRON_MBT_HOST_SESSION: this.session },
      });
    } catch (error) {
      this.addon.close(parent);
      throw error;
    } finally {
      this.addon.close(child);
    }
    // The private socketpair is the only control ingress. stderr is never
    // parsed as a privileged message or granted a reply channel.
    this.process.stderr.resume();
    this.process.on('error', () => { this.dead = true; });
  }
  request(operation, window = 0, generation = 0, payload = {}) {
    if (this.dead) throw runtimeError('ELECTRON_MBT_TRANSPORT_CLOSED', 'Native host has stopped');
    if (this.nextRequest >= Number.MAX_SAFE_INTEGER) {
      throw runtimeError('ELECTRON_MBT_ID_EXHAUSTED', 'Native request identifiers exhausted');
    }
    const request = {
      version: 1, session: this.session, request: ++this.nextRequest,
      window, generation, operation, payload,
    };
    try {
      this.gate.register(request);
      const bytes = encodeEnvelope(request);
      const result = this.addon.request(this.fd, decoder.decode(bytes), this.watchdogMs);
      const response = this.gate.accept(result);
      if (response.terminal !== 'success') {
        const code = response.payload?.code;
        throw runtimeError(typeof code === 'string' ? code : 'ELECTRON_MBT_NATIVE_FAILURE',
          'Native host rejected the requested operation');
      }
      return response.payload;
    } catch (error) {
      // A typed host failure is terminal for this request but not the channel.
      // Transport, framing and correlation failures poison the entire session.
      if (error.code === 'ELECTRON_MBT_PROTOCOL' ||
          error.code?.startsWith('ELECTRON_MBT_TRANSPORT') ||
          error.code === 'ELECTRON_MBT_LIMIT') this.abort();
      else this.gate.cancel(request.request);
      throw error;
    }
  }
  abort() {
    if (this.dead) return;
    this.dead = true;
    this.gate.close();
    this.addon.close(this.fd);
    if (this.process && this.process.exitCode === null && this.process.signalCode === null) {
      this.process.kill('SIGTERM');
    }
  }
  close() {
    if (this.dead) return;
    try { this.request('shutdown'); } finally { this.abort(); }
  }
}
module.exports = { NativeHost };
