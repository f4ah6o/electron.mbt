'use strict';
exports.name = 'b';
const a = require('./a');
exports.seen = a.name;
