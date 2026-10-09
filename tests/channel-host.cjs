'use strict';
const fs = require('node:fs');
const mode = process.argv[2];
const fd = 3;
function readExactly(size) {
  const out = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = fs.readSync(fd, out, offset, size - offset, null);
    if (!count) process.exit(0);
    offset += count;
  }
  return out;
}
function send(payload) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  fs.writeSync(fd, header);
  for (const byte of payload) fs.writeSync(fd, Buffer.from([byte]));
}
for (;;) {
  const length = readExactly(4).readUInt32BE();
  const payload = readExactly(length);
  if (mode === 'crash') process.exit(9);
  if (mode === 'stall') { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000); }
  else if (mode === 'oversized') { fs.writeSync(fd, Buffer.from([0, 16, 0, 1])); process.exit(0); }
  else if (mode === 'truncated') { fs.writeSync(fd, Buffer.from([0, 0, 0, 5, 65])); process.exit(0); }
  else if (mode === 'invalid-utf8') send(Buffer.from([0xff]));
  else send(payload);
}
