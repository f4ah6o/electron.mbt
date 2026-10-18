///|
pub(all) enum ResolveError {
  EmptySpecifier
  AbsoluteSpecifier
  EscapesRoot
  NotFound
  UnsupportedSpecifier
  UnsupportedExtension
  PackageLoop
} derive(Eq, Debug)

///|
// A path-only index over an immutable source snapshot. The host supplies the
// file list and package mains; resolution never reads the live filesystem.
pub struct FileIndex {
  files : Map[String, Bool]
  directories : Map[String, Bool]
  package_mains : Map[String, String]
  package_dirs : Map[String, Bool]
  package_exports : Map[String, Map[String, String]]
  package_exported : Map[String, Bool]
}

///|
pub fn FileIndex::new() -> FileIndex {
  {
    files: {},
    directories: {},
    package_mains: {},
    package_dirs: {},
    package_exports: {},
    package_exported: {},
  }
}

///|
fn resolve_normalize(path : String) -> String? {
  let parts : Array[String] = []
  for part in path.split("/") {
    let text = part.to_owned()
    if text.length() == 0 || text == "." {
      continue
    }
    if text == ".." {
      if parts.length() == 0 {
        return None
      }
      let _ = parts.pop()
    } else {
      parts.push(text)
    }
  }
  Some(parts.join("/"))
}

///|
fn FileIndex::register_parent_directories(self : FileIndex, path : String) -> Unit {
  let parts : Array[String] = []
  for part in path.split("/") {
    parts.push(part.to_owned())
  }
  let mut current = ""
  for i = 0; i < parts.length() - 1; i = i + 1 {
    if i == 0 {
      current = parts[0]
    } else {
      current = current + "/" + parts[i]
    }
    self.directories[current] = true
  }
}

///|
pub fn FileIndex::add_file(self : FileIndex, path : String) -> Result[Unit, ResolveError] {
  if path.length() == 0 || path.has_prefix("/") || path.has_prefix("\\") {
    return Err(UnsupportedSpecifier)
  }
  let normalized = match resolve_normalize(path) {
    Some(value) => value
    None => return Err(EscapesRoot)
  }
  if normalized.length() == 0 || self.files.contains(normalized) {
    return Err(UnsupportedSpecifier)
  }
  self.files[normalized] = true
  self.register_parent_directories(normalized)
  Ok(())
}

///|
// Package main is metadata, not a live package.json read. An empty main keeps
// the directory on the index/package path without inventing a resolution.
pub fn FileIndex::add_package_main(
  self : FileIndex,
  directory : String,
  main : String,
) -> Result[Unit, ResolveError] {
  let normalized = match resolve_normalize(directory) {
    Some(value) => value
    None => return Err(EscapesRoot)
  }
  if main.length() == 0 {
    return Err(UnsupportedSpecifier)
  }
  self.package_mains[normalized] = main
  self.package_dirs[normalized] = true
  if normalized.length() > 0 {
    self.directories[normalized] = true
  }
  Ok(())
}

///|
// Register a resolvable package directory. An empty main means the directory
// uses index resolution; it is not a missing package.
pub fn FileIndex::add_package(
  self : FileIndex,
  name : String,
  directory : String,
  main? : String = "",
) -> Result[Unit, ResolveError] {
  let parts : Array[String] = []
  for part in name.split("/") {
    let text = part.to_owned()
    if text.length() == 0 {
      return Err(UnsupportedSpecifier)
    }
    parts.push(text)
  }
  if parts.length() == 0 || name.has_prefix(".") || name.has_prefix("/") ||
    name.has_prefix("\\") {
    return Err(UnsupportedSpecifier)
  }
  let normalized = match resolve_normalize(directory) {
    Some(value) => value
    None => return Err(EscapesRoot)
  }
  if normalized.length() == 0 {
    return Err(UnsupportedSpecifier)
  }
  if main.length() > 0 {
    match self.add_package_main(normalized, main) {
      Ok(_) => ()
      Err(error) => return Err(error)
    }
  } else {
    self.package_dirs[normalized] = true
    self.directories[normalized] = true
  }
  Ok(())
}

///|
// Register a require-condition-selected package `exports` map. The caller has
// already rejected unsupported conditions and wildcard patterns; this index
// only owns encapsulation: an exports package never falls back to `main` or an
// unexported subpath.
pub fn FileIndex::add_package_exports(
  self : FileIndex,
  directory : String,
  exports : Map[String, String],
) -> Result[Unit, ResolveError] {
  let normalized = match resolve_normalize(directory) {
    Some(value) => value
    None => return Err(EscapesRoot)
  }
  if normalized.length() == 0 {
    return Err(UnsupportedSpecifier)
  }
  let copy : Map[String, String] = {}
  for key, target in exports {
    if !key.has_prefix(".") || target.length() == 0 || target.has_prefix("/") {
      return Err(UnsupportedSpecifier)
    }
    copy[key] = target
  }
  self.package_exports[normalized] = copy
  self.package_exported[normalized] = true
  self.package_dirs[normalized] = true
  self.directories[normalized] = true
  Ok(())
}

///|
fn resolve_parent_directory(path : String) -> String {
  let parts : Array[String] = []
  for part in path.split("/") {
    parts.push(part.to_owned())
  }
  if parts.length() <= 1 {
    return ""
  }
  let out : Array[String] = []
  for i = 0; i < parts.length() - 1; i = i + 1 {
    out.push(parts[i])
  }
  out.join("/")
}

///|
fn split_package_specifier(specifier : String) -> (String, String)? {
  let parts : Array[String] = []
  for part in specifier.split("/") {
    parts.push(part.to_owned())
  }
  if parts.length() == 0 {
    return None
  }
  let name_length = if parts[0].has_prefix("@") { 2 } else { 1 }
  if parts.length() < name_length {
    return None
  }
  let name_parts : Array[String] = []
  for i = 0; i < name_length; i = i + 1 {
    if parts[i].length() == 0 {
      return None
    }
    name_parts.push(parts[i])
  }
  let sub_parts : Array[String] = []
  for i = name_length; i < parts.length(); i = i + 1 {
    if parts[i].length() > 0 {
      sub_parts.push(parts[i])
    }
  }
  Some((name_parts.join("/"), sub_parts.join("/")))
}

///|
fn FileIndex::resolve_package(
  self : FileIndex,
  parent : String,
  specifier : String,
) -> Result[String, ResolveError] {
  let (name, subpath) = match split_package_specifier(specifier) {
    Some(value) => value
    None => return Err(UnsupportedSpecifier)
  }
  let mut current = parent
  while true {
    let candidate = if current.length() == 0 {
      "node_modules/" + name
    } else {
      current + "/node_modules/" + name
    }
    if self.package_dirs.contains(candidate) {
      if self.package_exported.contains(candidate) {
        let key = if subpath.length() == 0 {
          "."
        } else {
          "./" + subpath
        }
        let exports = match self.package_exports.get(candidate) {
          Some(value) => value
          None => return Err(NotFound)
        }
        let exported = match exports.get(key) {
          Some(value) => value
          None => return Err(NotFound)
        }
        let cleaned = if exported.has_prefix("./") {
          exported[2:].to_owned()
        } else {
          exported
        }
        let combined = candidate + "/" + cleaned
        let target = match resolve_normalize(combined) {
          Some(value) => value
          None => return Err(EscapesRoot)
        }
        if !target.has_prefix(candidate + "/") {
          return Err(EscapesRoot)
        }
        return self.resolve_candidate(target, 0)
      }
      if subpath.length() == 0 {
        return self.resolve_candidate(candidate, 0)
      }
      let combined = candidate + "/" + subpath
      let target = match resolve_normalize(combined) {
        Some(value) => value
        None => return Err(EscapesRoot)
      }
      if !target.has_prefix(candidate + "/") {
        return Err(EscapesRoot)
      }
      return self.resolve_candidate(target, 0)
    }
    if current.length() == 0 {
      break
    }
    current = resolve_parent_directory(current)
  }
  Err(NotFound)
}

///|
fn FileIndex::resolve_supported_file(self : FileIndex, path : String) -> Bool {
  if self.files.contains(path) {
    if path.has_suffix(".js") || path.has_suffix(".cjs") || path.has_suffix(".json") {
      true
    } else {
      false
    }
  } else {
    false
  }
}

///|
fn FileIndex::resolve_candidate(
  self : FileIndex,
  base : String,
  depth : Int32,
) -> Result[String, ResolveError] {
  if depth > 16 {
    return Err(PackageLoop)
  }
  if base.length() == 0 {
    return Err(NotFound)
  }
  if base.has_suffix(".node") {
    return Err(UnsupportedExtension)
  }
  if self.files.contains(base) {
    if self.resolve_supported_file(base) {
      return Ok(base)
    } else {
      return Err(UnsupportedExtension)
    }
  }
  for extension in [".js", ".cjs", ".json"] {
    let candidate = base + extension
    if self.files.contains(candidate) {
      return Ok(candidate)
    }
  }
  if self.files.contains(base + ".node") {
    return Err(UnsupportedExtension)
  }
  if self.directories.contains(base) {
    match self.package_mains.get(base) {
      Some(main) =>
        return match resolve_normalize(base + "/" + main) {
          Some(target) =>
            if target.has_prefix(base + "/") {
              self.resolve_candidate(target, depth + 1)
            } else {
              Err(EscapesRoot)
            }
          None => Err(EscapesRoot)
        }
      None => ()
    }
    for index in ["index.js", "index.cjs", "index.json", "index.node"] {
      let candidate = base + "/" + index
      if self.files.contains(candidate) {
        if index == "index.node" {
          return Err(UnsupportedExtension)
        }
        return Ok(candidate)
      }
    }
  }
  Err(NotFound)
}

///|
// Resolve a relative specifier from a normalized parent directory. Package
// specifiers and URL/absolute paths are intentionally unsupported in this
// increment; they are not silently mapped to a relative file.
pub fn FileIndex::resolve(
  self : FileIndex,
  parent : String,
  specifier : String,
) -> Result[String, ResolveError] {
  if specifier.length() == 0 {
    return Err(EmptySpecifier)
  }
  if specifier.has_prefix("/") || specifier.has_prefix("\\") {
    return Err(AbsoluteSpecifier)
  }
  let parent_normalized = match resolve_normalize(parent) {
    Some(value) => value
    None => return Err(EscapesRoot)
  }
  if specifier.has_prefix("node:") {
    return Err(UnsupportedSpecifier)
  }
  if !specifier.has_prefix(".") {
    return self.resolve_package(parent_normalized, specifier)
  }
  let combined = if parent_normalized.length() == 0 {
    specifier
  } else {
    parent_normalized + "/" + specifier
  }
  match resolve_normalize(combined) {
    Some(normalized) => self.resolve_candidate(normalized, 0)
    None => Err(EscapesRoot)
  }
}
