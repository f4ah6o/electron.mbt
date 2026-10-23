///|
/// Ordered JSON value used for the CLI reports and the generated files. The
/// core `Json` object is an unordered map, so it cannot reproduce Node's
/// `JSON.stringify` key order. Every key that reaches a file or stdout goes
/// through this type instead.
pub(all) enum CliJson {
  JNull
  JBool(Bool)
  JInt(Int)
  JString(String)
  JArray(Array[CliJson])
  JObject(Array[(String, CliJson)])
}

///|
pub fn CliJson::null() -> CliJson {
  JNull
}

///|
pub fn CliJson::bool(value : Bool) -> CliJson {
  JBool(value)
}

///|
pub fn CliJson::int(value : Int) -> CliJson {
  JInt(value)
}

///|
pub fn CliJson::string(value : String) -> CliJson {
  JString(value)
}

///|
pub fn CliJson::array(value : Array[CliJson]) -> CliJson {
  JArray(value)
}

///|
pub fn CliJson::object(value : Array[(String, CliJson)]) -> CliJson {
  JObject(value)
}

///|
fn write_indent(buffer : StringBuilder, level : Int) -> Unit {
  let mut index = 0
  while index < level {
    buffer.write_string("  ")
    index = index + 1
  }
}

///|
fn write_hex4(buffer : StringBuilder, unit : UInt16) -> Unit {
  let value = unit.to_int()
  let hex = "0123456789abcdef"
  buffer.write_string("\\u")
  buffer.write_char(hex[(value >> 12) & 0xf].unsafe_to_char())
  buffer.write_char(hex[(value >> 8) & 0xf].unsafe_to_char())
  buffer.write_char(hex[(value >> 4) & 0xf].unsafe_to_char())
  buffer.write_char(hex[value & 0xf].unsafe_to_char())
}

///|
/// Escape a UTF-16 string the way `JSON.stringify` does. Valid surrogate pairs
/// are emitted as-is; lone surrogates are escaped (well-formed JSON.stringify).
fn write_json_string(buffer : StringBuilder, value : String) -> Unit {
  buffer.write_string("\"")
  let length = value.length()
  let mut index : Int32 = 0
  while index < length {
    let unit = value.get(index).unwrap()
    if unit == 0x22 {
      buffer.write_string("\\\"")
      index = index + 1
    } else if unit == 0x5c {
      buffer.write_string("\\\\")
      index = index + 1
    } else if unit == 0x08 {
      buffer.write_string("\\b")
      index = index + 1
    } else if unit == 0x09 {
      buffer.write_string("\\t")
      index = index + 1
    } else if unit == 0x0a {
      buffer.write_string("\\n")
      index = index + 1
    } else if unit == 0x0c {
      buffer.write_string("\\f")
      index = index + 1
    } else if unit == 0x0d {
      buffer.write_string("\\r")
      index = index + 1
    } else if unit < 0x20 {
      write_hex4(buffer, unit)
      index = index + 1
    } else if unit >= 0xd800 && unit <= 0xdbff {
      if index + 1 < length && value.get(index + 1).unwrap() >= 0xdc00 &&
        value.get(index + 1).unwrap() <= 0xdfff {
        buffer.write_stringview(value[index:index + 2])
        index = index + 2
      } else {
        write_hex4(buffer, unit)
        index = index + 1
      }
    } else if unit >= 0xdc00 && unit <= 0xdfff {
      write_hex4(buffer, unit)
      index = index + 1
    } else {
      buffer.write_stringview(value[index:index + 1])
      index = index + 1
    }
  }
  buffer.write_string("\"")
}

///|
fn write_value(
  buffer : StringBuilder,
  value : CliJson,
  indent : Int,
  level : Int,
) -> Unit {
  match value {
    JNull => buffer.write_string("null")
    JBool(flag) => buffer.write_string(if flag { "true" } else { "false" })
    JInt(number) => buffer.write_string(number.to_string())
    JString(text) => write_json_string(buffer, text)
    JArray(items) => {
      if items.length() == 0 {
        buffer.write_string("[]")
      } else {
        buffer.write_string("[")
        for index = 0; index < items.length(); index = index + 1 {
          if index > 0 {
            buffer.write_string(",")
          }
          if indent > 0 {
            buffer.write_string("\n")
            write_indent(buffer, level + 1)
          }
          write_value(buffer, items[index], indent, level + 1)
        }
        if indent > 0 {
          buffer.write_string("\n")
          write_indent(buffer, level)
        }
        buffer.write_string("]")
      }
    }
    JObject(fields) => {
      if fields.length() == 0 {
        buffer.write_string("{}")
      } else {
        buffer.write_string("{")
        for index = 0; index < fields.length(); index = index + 1 {
          let (key, item) = fields[index]
          if index > 0 {
            buffer.write_string(",")
          }
          if indent > 0 {
            buffer.write_string("\n")
            write_indent(buffer, level + 1)
          }
          write_json_string(buffer, key)
          buffer.write_string(if indent > 0 { ": " } else { ":" })
          write_value(buffer, item, indent, level + 1)
        }
        if indent > 0 {
          buffer.write_string("\n")
          write_indent(buffer, level)
        }
        buffer.write_string("}")
      }
    }
  }
}

///|
/// Compact form, matching `JSON.stringify(value)`.
pub fn CliJson::to_compact(self : CliJson) -> String {
  let buffer = StringBuilder::new()
  write_value(buffer, self, 0, 0)
  buffer.to_string()
}

///|
/// Two-space form, matching `JSON.stringify(value, null, 2)` without the
/// trailing newline.
pub fn CliJson::to_pretty(self : CliJson) -> String {
  let buffer = StringBuilder::new()
  write_value(buffer, self, 2, 0)
  buffer.to_string()
}

///|
/// File form, matching `${JSON.stringify(value, null, 2)}\n`.
pub fn CliJson::to_file_text(self : CliJson) -> String {
  self.to_pretty() + "\n"
}
