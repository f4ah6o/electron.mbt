///|
pub(all) struct ScanEntry {
  path : String
  bytes : Int
  text : String?
}

///|
pub(all) struct ScanResult {
  scanned_files : Int
  scanned_bytes : Int
  skipped_large_files : Int
  builtins : Array[String]
  packages : Array[String]
  local_imports : Array[String]
  completeness : String
}

///|
fn is_js_space(unit : UInt16) -> Bool {
  unit == 0x09 || unit == 0x0a || unit == 0x0b || unit == 0x0c || unit == 0x0d ||
  unit == 0x20 || unit == 0x00a0 || unit == 0x1680 ||
  (unit >= 0x2000 && unit <= 0x200a) ||
  unit == 0x2028 || unit == 0x2029 || unit == 0x202f || unit == 0x205f ||
  unit == 0x3000 || unit == 0xfeff
}

///|
fn is_word_unit(unit : UInt16) -> Bool {
  (unit >= 0x41 && unit <= 0x5a) ||
  (unit >= 0x61 && unit <= 0x7a) ||
  (unit >= 0x30 && unit <= 0x39) ||
  unit == 0x5f
}

///|
fn is_scan_candidate(path : String) -> Bool {
  path.has_suffix(".js") ||
  path.has_suffix(".cjs") ||
  path.has_suffix(".mjs") ||
  path.has_suffix(".ts") ||
  path.has_suffix(".tsx")
}

///|
fn skip_space(text : String, start : Int32) -> Int32 {
  let mut index = start
  while index < text.length() && is_js_space(text.get(index).unwrap()) {
    index = index + 1
  }
  index
}

///|
fn quote_at(text : String, index : Int32) -> Bool {
  index < text.length() &&
  (text.get(index).unwrap() == 0x22 || text.get(index).unwrap() == 0x27)
}

///|
/// Parse a quoted specifier. Mirrors `[^'"]+` (non-empty, neither quote can
/// appear inside). Returns (specifier, index after the closing quote).
fn parse_quoted(text : String, quote_index : Int32) -> (String, Int32)? {
  let quote = text.get(quote_index).unwrap()
  let mut index = quote_index + 1
  while index < text.length() {
    let unit = text.get(index).unwrap()
    if unit == quote {
      if index == quote_index + 1 {
        return None
      }
      return Some((text[quote_index + 1:index].to_owned(), index + 1))
    }
    if unit == 0x22 || unit == 0x27 {
      return None
    }
    index = index + 1
  }
  None
}

///|
fn match_require(text : String, position : Int32) -> (String, Int32)? {
  let keyword = "require"
  if position + keyword.length() > text.length() ||
    text[position:position + keyword.length()] != keyword {
    return None
  }
  let mut index = position + keyword.length()
  index = skip_space(text, index)
  if index >= text.length() || text.get(index).unwrap() != 0x28 {
    return None
  }
  index = skip_space(text, index + 1)
  if not(quote_at(text, index)) {
    return None
  }
  parse_quoted(text, index)
}

///|
fn match_from(text : String, position : Int32) -> (String, Int32)? {
  let keyword = "from"
  if position + keyword.length() > text.length() ||
    text[position:position + keyword.length()] != keyword {
    return None
  }
  let mut index = position + keyword.length()
  if index >= text.length() || not(is_js_space(text.get(index).unwrap())) {
    return None
  }
  index = skip_space(text, index)
  if not(quote_at(text, index)) {
    return None
  }
  parse_quoted(text, index)
}

///|
fn match_import_call(text : String, position : Int32) -> (String, Int32)? {
  let keyword = "import"
  if position + keyword.length() > text.length() ||
    text[position:position + keyword.length()] != keyword {
    return None
  }
  let mut index = skip_space(text, position + keyword.length())
  if index >= text.length() || text.get(index).unwrap() != 0x28 {
    return None
  }
  index = skip_space(text, index + 1)
  if not(quote_at(text, index)) {
    return None
  }
  parse_quoted(text, index)
}

///|
fn match_import_bare(text : String, position : Int32) -> (String, Int32)? {
  let keyword = "import"
  if position + keyword.length() > text.length() ||
    text[position:position + keyword.length()] != keyword {
    return None
  }
  let mut index = position + keyword.length()
  if index >= text.length() || not(is_js_space(text.get(index).unwrap())) {
    return None
  }
  index = skip_space(text, index)
  if not(quote_at(text, index)) {
    return None
  }
  parse_quoted(text, index)
}

///|
fn pattern_matches(text : String, keyword : String, kind : Int) -> Array[String] {
  let found : Array[String] = []
  let mut start : Int32 = 0
  while start < text.length() {
    let relative = text[start:].find(keyword)
    let position = match relative {
      Some(offset) => start + offset
      None => break
    }
    let matched = if kind == 0 {
      match_require(text, position)
    } else if kind == 1 {
      match_from(text, position)
    } else if kind == 2 {
      match_import_call(text, position)
    } else {
      match_import_bare(text, position)
    }
    match matched {
      Some((specifier, next)) => {
        found.push(specifier)
        start = next
      }
      None => start = position + 1
    }
  }
  found
}

///|
fn push_unique(target : Array[String], value : String) -> Unit {
  if not(target.contains(value)) {
    target.push(value)
  }
}

///|
fn classify(specifier : String, builtins : Array[String], packages : Array[String],
  locals : Array[String]) -> Unit {
  if specifier.has_prefix(".") || specifier.has_prefix("/") {
    push_unique(locals, specifier)
    return
  }
  let normalized = if specifier.has_prefix("node:") {
    specifier[5:].to_owned()
  } else {
    specifier
  }
  if specifier.has_prefix("node:") || @modules.is_builtin(normalized) {
    push_unique(builtins, specifier)
  } else {
    push_unique(packages, specifier)
  }
}

///|
pub fn references_preload(text : String) -> Bool {
  let mut start : Int32 = 0
  while start < text.length() {
    let relative = text[start:].find("preload")
    let position = match relative {
      Some(offset) => start + offset
      None => break
    }
    let boundary = position == 0 || not(is_word_unit(text.get(position - 1).unwrap()))
    if boundary {
      let mut index = position + 7
      index = skip_space(text, index)
      if index < text.length() && text.get(index).unwrap() == 0x3a {
        return true
      }
    }
    start = position + 1
  }
  false
}

///|
/// Indices of entries the scanner will read, in order. The native layer reads
/// exactly these files so a large candidate after the 4 MiB cut is never
/// loaded.
pub fn scan_read_indices(entries : Array[(String, Int)]) -> Array[Int] {
  let indices : Array[Int] = []
  let mut scanned_bytes = 0
  for index = 0; index < entries.length(); index = index + 1 {
    let (path, bytes) = entries[index]
    if not(is_scan_candidate(path)) {
      continue
    }
    if bytes > 1048576 {
      continue
    }
    if scanned_bytes + bytes > 4194304 {
      break
    }
    indices.push(index)
    scanned_bytes = scanned_bytes + bytes
  }
  indices
}

///|
pub fn scan_symbols(entries : Array[ScanEntry]) -> Result[ScanResult, CliError] {
  let builtins : Array[String] = []
  let packages : Array[String] = []
  let locals : Array[String] = []
  let mut scanned_files = 0
  let mut scanned_bytes = 0
  let mut skipped_large_files = 0
  for entry in entries {
    if not(is_scan_candidate(entry.path)) {
      continue
    }
    scanned_files = scanned_files + 1
    if entry.bytes > 1048576 {
      skipped_large_files = skipped_large_files + 1
      continue
    }
    if scanned_bytes + entry.bytes > 4194304 {
      break
    }
    let text = match entry.text {
      Some(value) => value
      None =>
        return Err(CliError::new(
          "ELECTRON_MBT_MIGRATE_SCAN",
          "cannot read source file: " + entry.path,
        ))
    }
    scanned_bytes = scanned_bytes + entry.bytes
    let specifiers = pattern_matches(text, "require", 0)
    for specifier in specifiers {
      classify(specifier, builtins, packages, locals)
    }
    let from_matches = pattern_matches(text, "from", 1)
    for specifier in from_matches {
      classify(specifier, builtins, packages, locals)
    }
    let import_calls = pattern_matches(text, "import", 2)
    for specifier in import_calls {
      classify(specifier, builtins, packages, locals)
    }
    let import_bares = pattern_matches(text, "import", 3)
    for specifier in import_bares {
      classify(specifier, builtins, packages, locals)
    }
  }
  sort_utf16(builtins)
  sort_utf16(packages)
  sort_utf16(locals)
  Ok({
    scanned_files: scanned_files,
    scanned_bytes: scanned_bytes,
    skipped_large_files: skipped_large_files,
    builtins: builtins,
    packages: packages,
    local_imports: locals,
    completeness: "static-source-only",
  })
}
