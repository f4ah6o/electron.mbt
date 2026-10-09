'use strict';
const electron = require('electron');
const dependency = require('./dependency/index.cjs');
module.exports = { identity: electron === dependency, electron };
