'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Worker } = require('node:worker_threads');
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
    const [loadParent, loadChild] = this.addon.pair();
    this.fd = parent;
    this.loadFd = loadParent;
    this.pendingAsync = new Map();
    try {
      this.process = spawn(binary, options.testingArgs || [this.root], {
        stdio: ['ignore', 'ignore', 'pipe', child, loadChild],
        env: { ...process.env, ELECTRON_MBT_HOST_SESSION: this.session },
      });
    } catch (error) {
      this.addon.close(parent);
      this.addon.close(loadParent);
      throw error;
    } finally {
      this.addon.close(child);
      this.addon.close(loadChild);
    }
    // The private socketpair is the only control ingress. stderr is never
    // parsed as a privileged message or granted a reply channel.
    this.process.stderr.resume();
    this.process.on('error', () => { this.abort(); });
    this.process.on('exit', () => { if (!this.dead) this.abort(); });
    this.loadWorker = new Worker(path.join(__dirname, 'load-worker.cjs'), {
      workerData: { fd: loadParent, addon: addonFile },
    });
    this.loadWorker.on('message', message => this.onLoadReply(message));
    this.loadWorker.on('error', () => this.abort());
    this.loadWorker.on('exit', () => { if (!this.dead) this.abort(); });
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
  requestAsync(operation, window = 0, generation = 0, payload = {}) {
    if (this.dead) {
      return Promise.reject(runtimeError('ELECTRON_MBT_TRANSPORT_CLOSED', 'Native host has stopped'));
    }
    if (this.nextRequest >= Number.MAX_SAFE_INTEGER) {
      return Promise.reject(runtimeError('ELECTRON_MBT_ID_EXHAUSTED', 'Native request identifiers exhausted'));
    }
    const request = {
      version: 1, session: this.session, request: ++this.nextRequest,
      window, generation, operation, payload,
    };
    let raw;
    try {
      this.gate.register(request);
      raw = decoder.decode(encodeEnvelope(request));
    } catch (error) {
      this.gate.cancel(request.request);
      if (error.code === 'ELECTRON_MBT_PROTOCOL') this.abort();
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      this.pendingAsync.set(request.request, { resolve, reject });
      this.loadWorker.postMessage({
        request: request.request, raw, timeout: this.watchdogMs,
      });
    });
  }
  onLoadReply(message) {
    const pending = this.pendingAsync.get(message.request);
    if (!pending) return;
    this.pendingAsync.delete(message.request);
    if (message.code) {
      this.gate.cancel(message.request);
      const error = runtimeError(message.code, message.detail || 'Native load request failed');
      pending.reject(error);
      if (message.code.startsWith('ELECTRON_MBT_TRANSPORT')) this.abort();
      return;
    }
    try {
      const response = this.gate.accept(Buffer.from(message.bytes));
      if (response.terminal !== 'success') {
        const code = response.payload && response.payload.code;
        pending.reject(runtimeError(typeof code === 'string' ? code :
          'ELECTRON_MBT_NATIVE_FAILURE', 'Native load operation failed'));
      } else pending.resolve(response.payload);
    } catch (error) {
      pending.reject(error);
      this.abort();
    }
  }
  rejectPending(code) {
    for (const pending of this.pendingAsync.values()) {
      pending.reject(runtimeError(code, 'Native load session ended'));
    }
    this.pendingAsync.clear();
  }
  abort() {
    if (this.dead) return;
    this.dead = true;
    this.rejectPending('ELECTRON_MBT_TRANSPORT_CLOSED');
    this.gate.close();
    this.addon.close(this.fd);
    this.addon.close(this.loadFd);
    if (this.loadWorker) this.loadWorker.terminate().catch(() => {});
    if (this.process && this.process.exitCode === null && this.process.signalCode === null) {
      this.process.kill('SIGTERM');
    }
  }
  close() {
    if (this.dead) return;
    try { this.request('shutdown'); }
    catch (error) { this.abort(); throw error; }
    this.dead = true;
    this.rejectPending('ELECTRON_MBT_CANCELLED');
    this.gate.close();
    this.addon.close(this.fd);
    this.addon.close(this.loadFd);
    if (this.loadWorker) this.loadWorker.terminate().catch(() => {});
    // A successful shutdown should let the native host exit voluntarily;
    // force-kill only if the child fails to terminate after its ACK.
    const timeout = setTimeout(() => {
      if (this.process.exitCode === null && this.process.signalCode === null) {
        this.process.kill('SIGKILL');
      }
    }, 3000);
    timeout.unref();
    this.process.once('exit', () => clearTimeout(timeout));
  }
}
module.exports = { NativeHost };
