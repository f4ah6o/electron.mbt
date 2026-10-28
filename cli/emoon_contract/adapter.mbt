///|
fn object_field(value : Json, key : String) -> Json? {
  match value {
    Object(fields) => fields.get(key)
    _ => None
  }
}

///|
fn json_string_field(value : Json, key : String) -> String? {
  match object_field(value, key) {
    Some(String(text)) => Some(text)
    _ => None
  }
}

///|
fn json_array_field(value : Json, key : String) -> Array[Json]? {
  match object_field(value, key) {
    Some(Array(items)) => Some(items)
    _ => None
  }
}

///|
fn json_integer_value(value : Json?) -> Int? {
  match value {
    Some(Number(number, ..)) => {
      let truncated = number.to_int()
      if truncated.to_double() == number {
        Some(truncated)
      } else {
        None
      }
    }
    _ => None
  }
}

///|
fn bounded_string(value : String?, limit : Int) -> Bool {
  match value {
    Some(text) => text.length() > 0 && text.length() <= limit
    None => false
  }
}

///|
fn bounded_integer(value : Json?, limit : Int) -> Bool {
  match json_integer_value(value) {
    Some(number) => number > 0 && number <= limit
    None => false
  }
}

///|
fn valid_name(value : String) -> Bool {
  let length = value.length()
  if length == 0 {
    return false
  }
  let first = value.get(0).unwrap()
  let first_ok = (first >= 0x41 && first <= 0x5a) ||
    (first >= 0x61 && first <= 0x7a) ||
    first == 0x5f || first == 0x24
  if not(first_ok) {
    return false
  }
  let mut index : Int32 = 1
  while index < length {
    let unit = value.get(index).unwrap()
    let ok = (unit >= 0x41 && unit <= 0x5a) ||
      (unit >= 0x61 && unit <= 0x7a) ||
      (unit >= 0x30 && unit <= 0x39) ||
      unit == 0x5f || unit == 0x24
    if not(ok) {
      return false
    }
    index = index + 1
  }
  true
}

///|
fn adapter_fail(message : String) -> Result[String, String] {
  Err("ELECTRON_MBT_ADAPTED_ADAPTER: " + message)
}

///|
fn quote(value : String) -> String {
  CliJson::string(value).to_compact()
}

///|
/// Port of `scripts/adapted-adapter.cjs`. The returned string must be
/// byte-identical to the Node oracle; the parity test compares both bytes and
/// SHA-256.
pub fn build_adapter(manifest : Json) -> Result[String, String] {
  let schema = match object_field(manifest, "schema") {
    Some(Number(number, ..)) => {
      let truncated = number.to_int()
      if truncated.to_double() != number {
        return adapter_fail("expected schema 2 or 3")
      }
      truncated
    }
    _ => return adapter_fail("expected schema 2 or 3")
  }
  if schema != 2 && schema != 3 {
    return adapter_fail("expected schema 2 or 3")
  }
  let name = match json_string_field(manifest, "name") {
    Some(value) => value
    None => return adapter_fail("invalid API name")
  }
  if not(valid_name(name)) {
    return adapter_fail("invalid API name")
  }
  let version = match json_string_field(manifest, "version") {
    Some(value) => value
    None => return adapter_fail("invalid API version")
  }
  if not(bounded_string(Some(version), 128)) {
    return adapter_fail("invalid API version")
  }
  let topics = match json_array_field(manifest, "topics") {
    Some(items) => items
    None => return adapter_fail("topics must be a non-empty bounded array")
  }
  if topics.length() == 0 || topics.length() > 16 {
    return adapter_fail("topics must be a non-empty bounded array")
  }
  let topic_entries : Array[(String, String)] = []
  let topic_names : Array[String] = []
  let method_names : Array[String] = []
  for entry in topics {
    let topic = json_string_field(entry, "topic")
    let method = json_string_field(entry, "method")
    if not(bounded_string(topic, 128)) || method is None ||
      not(valid_name(method.unwrap())) {
      return adapter_fail("invalid topic")
    }
    let topic_text = topic.unwrap()
    let method_text = method.unwrap()
    if topic_names.contains(topic_text) {
      return adapter_fail("duplicate topic")
    }
    if method_names.contains(method_text) {
      return adapter_fail("duplicate topic method")
    }
    topic_names.push(topic_text)
    method_names.push(method_text)
    topic_entries.push((topic_text, method_text))
  }
  let calls = match json_array_field(manifest, "calls") {
    Some(items) => items
    None => return adapter_fail("calls must be a non-empty bounded array")
  }
  if calls.length() == 0 || calls.length() > 32 {
    return adapter_fail("calls must be a non-empty bounded array")
  }
  // (name, operation, args, arity)
  let call_entries : Array[(String, String, String, Int)] = []
  let call_names : Array[String] = []
  let operations : Array[String] = []
  for entry in calls {
    let call_name = json_string_field(entry, "name")
    if not(bounded_string(call_name, 128)) || not(valid_name(call_name.unwrap())) {
      return adapter_fail("invalid call")
    }
    let operation = json_string_field(entry, "operation")
    if not(bounded_string(operation, 128)) {
      return adapter_fail("invalid call operation")
    }
    let args = match object_field(entry, "args") {
      None => "none"
      Some(String(text)) => text
      _ => return adapter_fail("invalid call args")
    }
    if args != "none" && args != "json" && args != "json-list" {
      return adapter_fail("invalid call args")
    }
    let arity = match object_field(entry, "arity") {
      None => 0
      Some(value) =>
        match json_integer_value(Some(value)) {
          Some(number) => number
          None => return adapter_fail("invalid call arity")
        }
    }
    if args == "json-list" {
      if schema != 3 {
        return adapter_fail("json-list requires schema 3")
      }
      if arity < 1 || arity > 4 {
        return adapter_fail("invalid call arity")
      }
    } else if arity != 0 {
      return adapter_fail("call arity requires json-list")
    }
    let call_text = call_name.unwrap()
    let operation_text = operation.unwrap()
    if call_names.contains(call_text) {
      return adapter_fail("duplicate call")
    }
    if operations.contains(operation_text) {
      return adapter_fail("duplicate operation")
    }
    call_names.push(call_text)
    operations.push(operation_text)
    call_entries.push((call_text, operation_text, args, arity))
  }
  let unsupported_entries : Array[(String, String, String)] = []
  let unsupported_names : Array[String] = []
  match object_field(manifest, "unsupported") {
    None => ()
    Some(value) => {
      if schema != 3 {
        return adapter_fail("unsupported requires schema 3")
      }
      let items = match value {
        Array(values) => values
        _ => return adapter_fail("invalid unsupported list")
      }
      if items.length() > 32 {
        return adapter_fail("invalid unsupported list")
      }
      for entry in items {
        let entry_name = json_string_field(entry, "name")
        let code = json_string_field(entry, "code")
        let reason = json_string_field(entry, "reason")
        if not(bounded_string(entry_name, 128)) ||
          not(valid_name(entry_name.unwrap())) ||
          not(bounded_string(code, 128)) ||
          not(bounded_string(reason, 256)) {
          return adapter_fail("invalid unsupported call")
        }
        let unsupported_name = entry_name.unwrap()
        if unsupported_names.contains(unsupported_name) {
          return adapter_fail("duplicate unsupported call")
        }
        unsupported_names.push(unsupported_name)
        unsupported_entries.push((unsupported_name, code.unwrap(), reason.unwrap()))
      }
    }
  }
  let queue = match object_field(manifest, "queue") {
    Some(value) => value
    None => return adapter_fail("invalid queue limits")
  }
  if not(bounded_integer(object_field(queue, "maxCalls"), 256)) ||
    not(bounded_integer(object_field(queue, "maxBytes"), 1048576)) ||
    not(bounded_integer(object_field(queue, "readyTimeoutMs"), 60000)) {
    return adapter_fail("invalid queue limits")
  }
  for member in method_names {
    if member == "version" {
      return adapter_fail("reserved API name")
    }
  }
  for member in call_names {
    if member == "version" {
      return adapter_fail("reserved API name")
    }
    if method_names.contains(member) {
      return adapter_fail("duplicate API member")
    }
  }
  for member in unsupported_names {
    if member == "version" {
      return adapter_fail("reserved API name")
    }
    if method_names.contains(member) {
      return adapter_fail("duplicate API member")
    }
    if call_names.contains(member) {
      return adapter_fail("duplicate API member")
    }
  }
  let max_calls = json_integer_value(object_field(queue, "maxCalls")).unwrap()
  let max_bytes = json_integer_value(object_field(queue, "maxBytes")).unwrap()
  let ready_timeout = json_integer_value(object_field(queue, "readyTimeoutMs")).unwrap()
  let members : Array[String] = []
  members.push(
    "    version: function () { return " + quote(version) + "; }",
  )
  for (topic, method) in topic_entries {
    members.push(
      "    " + method + ": function (callback) { return addListener(" +
      quote(topic) + ", callback); }",
    )
  }
  for (call_name, operation, args, arity) in call_entries {
    if args == "none" {
      members.push(
        "    " + call_name +
        ": function () { return invoke(" + quote(operation) +
        ", null, false); }",
      )
    } else if args == "json" {
      members.push(
        "    " + call_name +
        ": function (value) { return invoke(" + quote(operation) +
        ", value, true); }",
      )
    } else {
      let params : Array[String] = []
      for index = 0; index < arity; index = index + 1 {
        params.push("arg" + index.to_string())
      }
      members.push(
        "    " + call_name + ": function (" + params.join(", ") +
        ") { return invoke(" + quote(operation) +
        ", Array.prototype.slice.call(arguments), true); }",
      )
    }
  }
  for (unsupported_name, code, reason) in unsupported_entries {
    members.push(
      "    " + unsupported_name +
      ": function () { return Promise.reject(adapterError(" + quote(code) +
      ", " + quote(reason) + ")); }",
    )
  }
  let topic_list = topic_entries.map(entry => quote(entry.0)).join(", ")
  let buffer = StringBuilder::new()
  buffer.write_string("'use strict';\n")
  buffer.write_string("(function () {\n")
  buffer.write_string("  const TOPICS = Object.freeze([")
  buffer.write_string(topic_list)
  buffer.write_string("]);\n")
  buffer.write_string("  const MAX_CALLS = ")
  buffer.write_string(max_calls.to_string())
  buffer.write_string(";\n")
  buffer.write_string("  const MAX_BYTES = ")
  buffer.write_string(max_bytes.to_string())
  buffer.write_string(";\n")
  buffer.write_string("  const READY_TIMEOUT_MS = ")
  buffer.write_string(ready_timeout.to_string())
  buffer.write_string(";\n")
  buffer.write_string("  const listeners = new Map();\n")
  buffer.write_string("  const pending = [];\n")
  buffer.write_string("  let pendingBytes = 0;\n")
  buffer.write_string("  let ready = false;\n")
  buffer.write_string("  let terminated = false;\n")
  buffer.write_string("  let timer = null;\n")
  buffer.write_string("  let host = null;\n")
  buffer.write_string("  try {\n")
  buffer.write_string("    const candidate = window.__electronMbtIngress;\n")
  buffer.write_string("    if (candidate && typeof candidate === 'object') host = candidate;\n")
  buffer.write_string("  } catch (_) {}\n")
  buffer.write_string("  try { delete window.__electronMbtIngress; } catch (_) {}\n")
  buffer.write_string("  const adapterError = function (code, message) {\n")
  buffer.write_string("    const error = new Error(message);\n")
  buffer.write_string("    error.code = code;\n")
  buffer.write_string("    return error;\n")
  buffer.write_string("  };\n")
  buffer.write_string("  const utf8Bytes = function (text) {\n")
  buffer.write_string("    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;\n")
  buffer.write_string("    let bytes = 0;\n")
  buffer.write_string("    for (let index = 0; index < text.length; index += 1) {\n")
  buffer.write_string("      const code = text.charCodeAt(index);\n")
  buffer.write_string("      if (code < 0x80) bytes += 1;\n")
  buffer.write_string("      else if (code < 0x800) bytes += 2;\n")
  buffer.write_string("      else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; index += 1; }\n")
  buffer.write_string("      else bytes += 3;\n")
  buffer.write_string("    }\n")
  buffer.write_string("    return bytes;\n")
  buffer.write_string("  };\n")
  buffer.write_string("  const settle = function (record, ok, value) {\n")
  buffer.write_string("    if (record.settled) return;\n")
  buffer.write_string("    record.settled = true;\n")
  buffer.write_string("    if (ok) record.resolve(value);\n")
  buffer.write_string("    else record.reject(value);\n")
  buffer.write_string("  };\n")
  buffer.write_string("  const dispatch = function (record) {\n")
  buffer.write_string("    if (record.settled) return;\n")
  buffer.write_string("    if (!host || typeof host.dispatch !== 'function') {\n")
  buffer.write_string("      settle(record, false, adapterError('ELECTRON_MBT_ADAPTER_INGRESS_UNAVAILABLE', 'document ingress is not wired'));\n")
  buffer.write_string("      return;\n")
  buffer.write_string("    }\n")
  buffer.write_string("    let result;\n")
  buffer.write_string("    try {\n")
  buffer.write_string("      result = host.dispatch(record.operation, record.args);\n")
  buffer.write_string("    } catch (error) {\n")
  buffer.write_string("      settle(record, false, error);\n")
  buffer.write_string("      return;\n")
  buffer.write_string("    }\n")
  buffer.write_string("    if (result && typeof result.then === 'function') {\n")
  buffer.write_string("      result.then(function (value) { settle(record, true, value); },\n")
  buffer.write_string("                  function (error) { settle(record, false, error); });\n")
  buffer.write_string("    } else {\n")
  buffer.write_string("      settle(record, true, result);\n")
  buffer.write_string("    }\n")
  buffer.write_string("  };\n")
  buffer.write_string("  const expire = function () {\n")
  buffer.write_string("    if (terminated || ready) return;\n")
  buffer.write_string("    terminated = true;\n")
  buffer.write_string("    timer = null;\n")
  buffer.write_string("    const batch = pending.splice(0, pending.length);\n")
  buffer.write_string("    pendingBytes = 0;\n")
  buffer.write_string("    for (let index = 0; index < batch.length; index += 1) {\n")
  buffer.write_string("      settle(batch[index], false, adapterError('ELECTRON_MBT_ADAPTER_INGRESS_TIMEOUT', 'document ingress did not become ready'));\n")
  buffer.write_string("    }\n")
  buffer.write_string("  };\n")
  buffer.write_string("  const flush = function () {\n")
  buffer.write_string("    if (terminated || ready) return;\n")
  buffer.write_string("    ready = true;\n")
  buffer.write_string("    if (timer !== null) { clearTimeout(timer); timer = null; }\n")
  buffer.write_string("    const batch = pending.splice(0, pending.length);\n")
  buffer.write_string("    pendingBytes = 0;\n")
  buffer.write_string("    for (let index = 0; index < batch.length; index += 1) dispatch(batch[index]);\n")
  buffer.write_string("  };\n")
  buffer.write_string("  const invoke = function (operation, value, hasValue) {\n")
  buffer.write_string("    if (terminated) {\n")
  buffer.write_string("      return Promise.reject(adapterError('ELECTRON_MBT_ADAPTER_INGRESS_UNAVAILABLE', 'document ingress is not available'));\n")
  buffer.write_string("    }\n")
  buffer.write_string("    let args = null;\n")
  buffer.write_string("    let bytes = 0;\n")
  buffer.write_string("    if (hasValue) {\n")
  buffer.write_string("      try {\n")
  buffer.write_string("        args = JSON.stringify(value);\n")
  buffer.write_string("        if (typeof args !== 'string') throw new Error('not JSON');\n")
  buffer.write_string("      } catch (_) {\n")
  buffer.write_string("        return Promise.reject(adapterError('ELECTRON_MBT_ADAPTER_VALUE', 'arguments are not JSON serializable'));\n")
  buffer.write_string("      }\n")
  buffer.write_string("      bytes = utf8Bytes(args);\n")
  buffer.write_string("    }\n")
  buffer.write_string("    if (ready) {\n")
  buffer.write_string("      return new Promise(function (resolve, reject) {\n")
  buffer.write_string("        dispatch({ operation: operation, args: args, resolve: resolve, reject: reject, settled: false });\n")
  buffer.write_string("      });\n")
  buffer.write_string("    }\n")
  buffer.write_string("    return new Promise(function (resolve, reject) {\n")
  buffer.write_string("      if (pending.length >= MAX_CALLS || pendingBytes + bytes > MAX_BYTES) {\n")
  buffer.write_string("        reject(adapterError('ELECTRON_MBT_ADAPTER_QUEUE_FULL', 'document ingress queue is full'));\n")
  buffer.write_string("        return;\n")
  buffer.write_string("      }\n")
  buffer.write_string("      pending.push({ operation: operation, args: args, resolve: resolve, reject: reject, settled: false });\n")
  buffer.write_string("      pendingBytes += bytes;\n")
  buffer.write_string("      if (timer === null) timer = setTimeout(expire, READY_TIMEOUT_MS);\n")
  buffer.write_string("    });\n")
  buffer.write_string("  };\n")
  buffer.write_string("  const addListener = function (topic, callback) {\n")
  buffer.write_string("    if (typeof callback !== 'function') throw new TypeError('adapted listener must be a function');\n")
  buffer.write_string("    let table = listeners.get(topic);\n")
  buffer.write_string("    if (!table) { table = []; listeners.set(topic, table); }\n")
  buffer.write_string("    const record = { callback: callback };\n")
  buffer.write_string("    table.push(record);\n")
  buffer.write_string("    let disposed = false;\n")
  buffer.write_string("    return function () {\n")
  buffer.write_string("      if (disposed) return;\n")
  buffer.write_string("      disposed = true;\n")
  buffer.write_string("      const current = listeners.get(topic);\n")
  buffer.write_string("      if (!current) return;\n")
  buffer.write_string("      const index = current.indexOf(record);\n")
  buffer.write_string("      if (index >= 0) current.splice(index, 1);\n")
  buffer.write_string("    };\n")
  buffer.write_string("  };\n")
  buffer.write_string("  const emit = function (topic, payload) {\n")
  buffer.write_string("    if (TOPICS.indexOf(topic) < 0) throw adapterError('ELECTRON_MBT_ADAPTER_TOPIC', 'unknown adapted topic');\n")
  buffer.write_string("    const table = listeners.get(topic);\n")
  buffer.write_string("    if (!table || table.length === 0) return;\n")
  buffer.write_string("    const snapshot = table.slice();\n")
  buffer.write_string("    for (let index = 0; index < snapshot.length; index += 1) snapshot[index].callback(payload);\n")
  buffer.write_string("  };\n")
  buffer.write_string("  if (host && typeof host.whenReady === 'function') {\n")
  buffer.write_string("    try { host.whenReady(flush); } catch (_) {}\n")
  buffer.write_string("  } else if (host && host.ready === true) {\n")
  buffer.write_string("    flush();\n")
  buffer.write_string("  }\n")
  buffer.write_string("  if (host && typeof host.onEvent === 'function') {\n")
  buffer.write_string("    try { host.onEvent(emit); } catch (_) {}\n")
  buffer.write_string("  }\n")
  buffer.write_string("  const api = Object.freeze({\n")
  buffer.write_string(members.join(",\n"))
  buffer.write_string("\n  });\n")
  buffer.write_string("  Object.defineProperty(window, ")
  buffer.write_string(quote(name))
  buffer.write_string(", {\n")
  buffer.write_string("    value: api, enumerable: true, configurable: false, writable: false\n")
  buffer.write_string("  });\n")
  buffer.write_string("})();\n")
  Ok(buffer.to_string())
}
