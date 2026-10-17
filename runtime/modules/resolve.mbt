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
}

///|
pub fn FileIndex::new() -> FileIndex {
  {
    files: {},
    directories: {},
    package_mains: {},
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
  if normalized.length() > 0 {
    self.directories[normalized] = true
  }
  Ok(())
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
          Some(target) => self.resolve_candidate(target, depth + 1)
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
  if !specifier.has_prefix(".") {
    return Err(UnsupportedSpecifier)
  }
  let parent_normalized = match resolve_normalize(parent) {
    Some(value) => value
    None => return Err(EscapesRoot)
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
