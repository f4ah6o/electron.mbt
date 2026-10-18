'use strict';
exports.name = 'a';
const b = require('./b');
exports.seen = b.name;
