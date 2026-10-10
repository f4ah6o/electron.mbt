'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { EventEmitter } = require('node:events');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { runtimeError } = require('./errors.cjs');
const { createSessionGate, encodeEnvelope, MAX_BYTES } = require('./host-protocol.cjs');

const decoder = new TextDecoder('utf-8', { fatal: true });
const addonFile = path.resolve(__dirname, '../../dist/sync_channel.node');
const nativeBinary = path.resolve(__dirname, '../../dist/electron-mbt-native-host');

class NativeHost extends EventEmitter {
  constructor(appDir, options = {}) {
    super();
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
    // Each acquired descriptor is either retained on this instance or
    // closed if a subsequent pair, spawn, Worker or socket initialization fails.
    this.fd = null;
    this.loadFd = null;
    this.eventFd = null;
    this.eventSocket = null;
    this.loadWorker = null;
    this.loadWorkerExited = false;
    this.process = null;
    this.pendingAsync = new Map();
    this.eventBytes = Buffer.alloc(0);
    const inherited = [];
    const pairFactory = options.testingPairFactory || this.addon.pair.bind(this.addon);
    try {
      const [controlParent, controlChild] = pairFactory();
      this.fd = controlParent;
      inherited.push(controlChild);
      const [loadParent, loadChild] = pairFactory();
      this.loadFd = loadParent;
      inherited.push(loadChild);
      const [eventParent, eventChild] = pairFactory();
      this.eventFd = eventParent;
      inherited.push(eventChild);

      this.process = spawn(binary, options.testingArgs || [this.root], {
        stdio: ['ignore', 'ignore', 'pipe',
          controlChild, loadChild, eventChild],
        env: { ...process.env, ELECTRON_MBT_HOST_SESSION: this.session },
      });
      // spawn() can return a ChildProcess with pid === undefined. Its error
      // and close events are asynchronous, and may arrive after construction.
      // Install handlers before any user test hook or pid validation so a
      // post-constructor spawn error cannot become an unhandled Node error.
      this.process.on('error', error => this.abort(error));
      this.process.on('exit', () => { if (!this.dead) this.abort(); });
      this.process.on('close', () => { if (!this.dead) this.abort(); });
      if (!Number.isSafeInteger(this.process.pid) || this.process.pid <= 0) {
        throw runtimeError('ELECTRON_MBT_TRANSPORT_SPAWN',
          'Cannot launch native host executable');
      }
      // Test-only hooks are never exposed to an application's Electron facade.
      if (typeof options.testingOnSpawn === 'function') options.testingOnSpawn(this.process);
      this.process.stderr?.resume();

      // Child descriptors must not survive in the Node parent after spawn.
      while (inherited.length) this.addon.close(inherited.pop());

      this.loadWorker = new Worker(
        options.testingWorkerScript ?? path.join(__dirname, 'load-worker.cjs'),
        { workerData: { fd: this.loadFd, addon: addonFile } },
      );
      this.loadWorker.on('message', message => this.onLoadReply(message));
      this.loadWorker.on('error', () => this.abort());
      this.loadWorker.on('exit', () => {
        this.loadWorkerExited = true;
        if (!this.dead) this.abort();
      });

      this.eventSocket = new net.Socket({
        fd: this.eventFd, readable: true, writable: false,
      });
      this.eventFd = null; // Ownership moved to the Node socket wrapper.
      this.eventSocket.on('data', bytes => this.onEventChunk(bytes));
      this.eventSocket.on('error', () => this.abort());
      this.eventSocket.on('close', () => { if (!this.dead) this.abort(); });
    } catch (error) {
      this.abort();
      throw error;
    } finally {
      // The same rollback is required even when the third pair or spawn fails.
      for (const descriptor of inherited) {
        try { this.addon.close(descriptor); } catch {}
      }
    }
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
  onEventChunk(chunk) {
    if (this.dead) return;
    if (chunk.length + this.eventBytes.length > MAX_BYTES + 4) {
      this.abort();
      return;
    }
    this.eventBytes = Buffer.concat([this.eventBytes, chunk]);
    while (this.eventBytes.length >= 4) {
      const length = this.eventBytes.readUInt32BE(0);
      if (length === 0 || length > MAX_BYTES) { this.abort(); return; }
      if (this.eventBytes.length < length + 4) return;
      const bytes = this.eventBytes.subarray(4, length + 4);
      this.eventBytes = this.eventBytes.subarray(length + 4);
      try {
        const envelope = this.gate.observe(bytes);
        if (envelope.session !== this.session ||
            !['web-content-gone', 'native-close-request'].includes(envelope.operation)) {
          throw runtimeError('ELECTRON_MBT_PROTOCOL', 'Unauthenticated or unexpected native event');
        }
        this.emit(envelope.operation, {
          window: envelope.window, generation: envelope.generation,
        });
      } catch (error) { this.abort(); return; }
    }
  }
  requestAsync(operation, window = 0, generation = 0, payload = {}) {
    const startedNs = process.hrtime.bigint();
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
    const deadlineNs = startedNs + BigInt(this.watchdogMs) * 1000000n;
    const remainingNs = deadlineNs - process.hrtime.bigint();
    if (remainingNs <= 0n) {
      const error = runtimeError('ELECTRON_MBT_TRANSPORT_TIMEOUT',
        'Native load deadline expired before enqueue');
      this.gate.cancel(request.request);
      this.abort();
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const remainingMs = Math.max(1, Number((remainingNs + 999999n) / 1000000n));
      const timer = setTimeout(() => {
        const pending = this.pendingAsync.get(request.request);
        if (!pending) return;
        this.pendingAsync.delete(request.request);
        pending.reject(runtimeError('ELECTRON_MBT_TRANSPORT_TIMEOUT',
          'Native load watchdog expired including queue time'));
        this.abort();
      }, remainingMs);
      timer.unref();
      this.pendingAsync.set(request.request, { resolve, reject, timer });
      try {
        this.loadWorker.postMessage({
          request: request.request, raw, deadlineNs, timeout: this.watchdogMs,
        });
      } catch (error) {
        clearTimeout(timer);
        this.pendingAsync.delete(request.request);
        this.gate.cancel(request.request);
        reject(error);
        this.abort();
      }
    });
  }
  onLoadReply(message) {
    const pending = this.pendingAsync.get(message.request);
    if (!pending) return;
    this.pendingAsync.delete(message.request);
    clearTimeout(pending.timer);
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
      clearTimeout(pending.timer);
      pending.reject(runtimeError(code, 'Native load session ended'));
    }
    this.pendingAsync.clear();
  }
  disposeTransports(code) {
    this.rejectPending(code);
    this.gate.close();
    const control = this.fd;
    this.fd = null;
    if (Number.isInteger(control)) {
      try { this.addon.close(control); } catch {}
    }

    const load = this.loadFd;
    this.loadFd = null;
    if (Number.isInteger(load)) {
      // The fd table is process-wide. Wake the worker first and defer close
      // until its native request has left poll()/recv(), preventing fd reuse.
      try { this.addon.interrupt(load); } catch {}
    }
    const worker = this.loadWorker;
    this.loadWorker = null;
    if (worker) {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        if (Number.isInteger(load)) {
          try { this.addon.close(load); } catch {}
        }
      };
      if (this.loadWorkerExited) {
        release();
      } else {
        worker.once('exit', release);
        // If terminate rejects, keep ownership until the actual exit event.
        worker.terminate().then(release, () => {});
      }
    } else if (Number.isInteger(load)) {
      try { this.addon.close(load); } catch {}
    }
    if (this.eventSocket) {
      const socket = this.eventSocket;
      this.eventSocket = null;
      socket.destroy();
    } else if (Number.isInteger(this.eventFd)) {
      const descriptor = this.eventFd;
      this.eventFd = null;
      try { this.addon.close(descriptor); } catch {}
    }
  }
  ensureChildExit() {
    const child = this.process;
    if (!child || !Number.isInteger(child.pid) ||
        child.exitCode !== null || child.signalCode !== null) return;
    // SIGTERM is best effort. Bound orphan lifetime if the host fails to quit.
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }, 3000);
    timer.unref();
    child.once('exit', () => clearTimeout(timer));
  }
  abort(cause) {
    if (this.dead) return;
    this.dead = true;
    this.disposeTransports('ELECTRON_MBT_TRANSPORT_CLOSED');
    if (this.process && Number.isInteger(this.process.pid) &&
        this.process.exitCode === null && this.process.signalCode === null) {
      this.process.kill('SIGTERM');
      this.ensureChildExit();
    }
    // This is deliberately not the EventEmitter 'error' event: consumers
    // must be able to observe process loss without creating an unhandled
    // error exception. The session is already revoked when this fires.
    this.emit('lost', cause || runtimeError('ELECTRON_MBT_TRANSPORT_CLOSED',
      'Native host process or channel was lost'));
  }
  close() {
    if (this.dead) return;
    try { this.request('shutdown'); }
    catch (error) { this.abort(); throw error; }
    this.dead = true;
    this.disposeTransports('ELECTRON_MBT_CANCELLED');
    // A successful shutdown should let the native host exit voluntarily.
    // Only the expiry of this cleanup watchdog sends SIGKILL.
    this.ensureChildExit();
  }
}
module.exports = { NativeHost };
