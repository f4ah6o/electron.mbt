'use strict';
const path = require('node:path');
module.exports = {
  id: 'nodeless-scenario',
  entry: path.join('src', 'lib', 'scenario.js'),
  label: 'nodeless-app-ready',
};
