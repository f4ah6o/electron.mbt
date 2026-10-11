'use strict';
const fs = require('node:fs');
const fd = 4;
const word = new Int32Array(new SharedArrayBuffer(4));
function readExact(size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = fs.readSync(fd, bytes, offset, size - offset, null);
    if (count === 0) process.exit(0);
    offset += count;
  }
  return bytes;
}
for (;;) {
  const size = readExact(4).readUInt32BE();
  if (size === 0 || size > 1048576) process.exit(2);
  readExact(size);
  // Deliberately never reply. The native worker's watchdog and abort path
  // must reclaim the session even when the child remains unresponsive.
  Atomics.wait(word, 0, 0, 10000);
}
