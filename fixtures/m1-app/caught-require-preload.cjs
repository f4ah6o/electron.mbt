'use strict';
try {
  require('electron');
} catch (error) {
  module.exports = { optionalImportFailed: true };
}
