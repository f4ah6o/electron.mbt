'use strict';
function runtimeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
module.exports = { runtimeError };
