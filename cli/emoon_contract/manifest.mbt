///|
pub(all) struct ManifestFile {
  path : String
  sha256 : String
  bytes : Int
}

///|
/// Order files as `buildSourceManifest` does: the page entry first, then the
/// caller's order with the entry removed.
pub fn manifest_order(
  entry : String,
  requested : Array[String],
) -> Result[Array[String], CliError] {
  if requested.length() == 0 || requested.length() > 4096 {
    return Err(CliError::new(
      "ELECTRON_MBT_MIGRATE_MANIFEST",
      "ELECTRON_MBT_SOURCE_MANIFEST: files must be a non-empty bounded array",
    ))
  }
  let seen : Array[String] = []
  for item in requested {
    if seen.contains(item) {
      return Err(CliError::new(
        "ELECTRON_MBT_MIGRATE_MANIFEST",
        "ELECTRON_MBT_SOURCE_MANIFEST: duplicate file",
      ))
    }
    seen.push(item)
  }
  if not(seen.contains(entry)) {
    return Err(CliError::new(
      "ELECTRON_MBT_MIGRATE_MANIFEST",
      "ELECTRON_MBT_SOURCE_MANIFEST: entry must be listed in files",
    ))
  }
  let ordered : Array[String] = [entry]
  for item in requested {
    if item != entry {
      ordered.push(item)
    }
  }
  Ok(ordered)
}

///|
pub fn manifest_text(
  app : String,
  entry : String,
  files : Array[ManifestFile],
) -> Result[String, CliError] {
  if files.length() == 0 || files.length() > 4096 {
    return Err(CliError::new(
      "ELECTRON_MBT_MIGRATE_MANIFEST",
      "ELECTRON_MBT_SOURCE_MANIFEST: files must be a non-empty bounded array",
    ))
  }
  let mut total = 0
  let entries : Array[CliJson] = []
  for file in files {
    if file.path.length() == 0 || file.path.length() > 256 ||
      path_is_absolute(file.path) || file.path.split("/").contains("..") {
      return Err(CliError::new(
        "ELECTRON_MBT_MIGRATE_MANIFEST",
        "ELECTRON_MBT_SOURCE_MANIFEST: invalid file path",
      ))
    }
    if file.bytes <= 0 || file.bytes > 16777216 {
      return Err(CliError::new(
        "ELECTRON_MBT_MIGRATE_MANIFEST",
        "ELECTRON_MBT_SOURCE_MANIFEST: file size out of bounds",
      ))
    }
    total = total + file.bytes
    if total > 67108864 {
      return Err(CliError::new(
        "ELECTRON_MBT_MIGRATE_MANIFEST",
        "ELECTRON_MBT_SOURCE_MANIFEST: total file bytes out of bounds",
      ))
    }
    entries.push(CliJson::object([
      ("path", CliJson::string(file.path)),
      ("sha256", CliJson::string(file.sha256)),
      ("bytes", CliJson::int(file.bytes)),
    ]))
  }
  Ok(
    CliJson::object([
      ("schema", CliJson::int(2)),
      ("app", CliJson::string(app)),
      ("entry", CliJson::string(entry)),
      ("files", CliJson::array(entries)),
    ]).to_file_text(),
  )
}
