///|
pub(all) struct PackageInfo {
  name : String
  version : String
  main : String
}

///|
pub fn package_from_json(value : Json, fallback_name : String) -> Result[PackageInfo, CliError] {
  match value {
    Object(fields) => {
      let main = match fields.get("main") {
        Some(String(text)) => text
        _ =>
          return Err(CliError::new(
            "ELECTRON_MBT_INVALID_APP",
            "pkg.json main must be an app-relative path",
          ))
      }
      if main.length() == 0 || path_is_absolute(main) {
        return Err(CliError::new(
          "ELECTRON_MBT_INVALID_APP",
          "pkg.json main must be an app-relative path",
        ))
      }
      let normalized_main = match normalize_relative(main, "main") {
        Ok(text) => text
        Err(error) => return Err(error)
      }
      let name = match fields.get("name") {
        Some(String(text)) => text
        _ => fallback_name
      }
      let version = match fields.get("version") {
        Some(String(text)) => text
        _ => "0.0.0"
      }
      Ok({ name: name, version: version, main: normalized_main })
    }
    _ =>
      Err(CliError::new(
        "ELECTRON_MBT_INVALID_APP",
        "pkg.json must contain an object",
      ))
  }
}

///|
fn basename_has_extension(value : String) -> Bool {
  let base = path_basename(value)
  let mut index = base.length() - 1
  while index >= 0 {
    if base.get(index).unwrap() == 0x2e {
      return index > 0
    }
    index = index - 1
  }
  false
}

///|
/// File candidates for `require.resolve` on an absolute app path. Directory
/// resolution (`pkg.json` main, then index files) is handled by the FS
/// layer because it needs to read the nested pkg.json.
pub fn entry_candidates(main : String) -> Array[String] {
  let candidates : Array[String] = [main]
  if not(basename_has_extension(main)) {
    candidates.push(main + ".js")
    candidates.push(main + ".json")
    candidates.push(main + ".node")
  }
  candidates
}

///|
pub fn entry_type(entry : String, package_type : String?) -> String {
  if entry.has_suffix(".mjs") {
    "module"
  } else if entry.has_suffix(".cjs") {
    "commonjs"
  } else if not(entry.has_suffix(".js")) {
    "unsupported"
  } else {
    match package_type {
      Some(value) => if value == "module" { "module" } else { "commonjs" }
      None => "commonjs"
    }
  }
}

///|
pub(all) struct ScanReport {
  builtins : Array[String]
  packages : Array[String]
  local_imports : Array[String]
  scanned_files : Int
  scanned_bytes : Int
  skipped_large_files : Int
}

///|
pub(all) struct InspectInput {
  app_dir : String
  pkg : PackageInfo
  entry : String
  entry_type : String
  config : CliConfig
  scan : ScanReport
  preload_referenced : Bool
  native_addons : Bool
  asar : Bool
  implementation : String
}

///|
fn json_string_array(values : Array[String]) -> CliJson {
  CliJson::array(values.map(value => CliJson::string(value)))
}

///|
fn json_optional_string(value : String?) -> CliJson {
  match value {
    Some(text) => CliJson::string(text)
    None => CliJson::null()
  }
}

///|
fn tool_json(implementation : String) -> CliJson {
  CliJson::object([
    ("name", CliJson::string("emoon")),
    ("version", CliJson::string("0.1.0")),
    ("impl", CliJson::string(implementation)),
  ])
}

///|
fn not_claimed_inspect() -> CliJson {
  json_string_array([
    "compatibility", "security", "packaging", "production consent",
  ])
}

///|
pub fn inspect_tier(input : InspectInput) -> String {
  if input.native_addons || input.asar || input.entry_type != "commonjs" {
    "blocked"
  } else if input.preload_referenced || input.config.api is Some(_) {
    "adapted"
  } else {
    "plain"
  }
}

///|
fn inspect_blockers(input : InspectInput) -> CliJson {
  let blockers : Array[CliJson] = []
  if input.native_addons {
    blockers.push(CliJson::object([
      ("code", CliJson::string("ELECTRON_MBT_MIGRATE_NATIVE_ADDON")),
      ("message", CliJson::string("native addons are not supported")),
    ]))
  }
  if input.asar {
    blockers.push(CliJson::object([
      ("code", CliJson::string("ELECTRON_MBT_MIGRATE_ASAR")),
      ("message", CliJson::string("ASAR archives are not supported")),
    ]))
  }
  if input.entry_type != "commonjs" {
    blockers.push(CliJson::object([
      ("code", CliJson::string("ELECTRON_MBT_MIGRATE_MODULE_TYPE")),
      ("message", CliJson::string(
        "entry type " + input.entry_type + " is not supported",
      )),
    ]))
  }
  CliJson::array(blockers)
}

///|
fn inspect_warnings(input : InspectInput) -> CliJson {
  let warnings : Array[CliJson] = []
  if input.preload_referenced && input.config.api is None {
    warnings.push(CliJson::object([
      ("code", CliJson::string("WARN_PRELOAD_NOT_EXECUTED")),
      ("message", CliJson::string(
        "the original preload is not executed; provide --api adapted-preload.json for an adapted build",
      )),
    ]))
  }
  CliJson::array(warnings)
}

///|
fn source_json(
  app_dir : String,
  pkg : PackageInfo,
  config : CliConfig,
) -> CliJson {
  CliJson::object([
    ("appDir", CliJson::string(app_dir)),
    ("packageName", CliJson::string(pkg.name)),
    ("packageVersion", CliJson::string(pkg.version)),
    ("entry", CliJson::string(config.main)),
    ("page", CliJson::string(config.page)),
    ("renderer", CliJson::string(config.renderer)),
  ])
}

///|
fn observations_json(input : InspectInput) -> CliJson {
  CliJson::object([
    ("entryType", CliJson::string(input.entry_type)),
    ("nativeAddons", CliJson::bool(input.native_addons)),
    ("asar", CliJson::bool(input.asar)),
    ("preloadReferenced", CliJson::bool(input.preload_referenced)),
    ("page", CliJson::string(input.config.page)),
    ("api", json_optional_string(input.config.api)),
    ("builtins", json_string_array(input.scan.builtins)),
    ("packages", json_string_array(input.scan.packages)),
    ("localImports", json_string_array(input.scan.local_imports)),
    ("scan", CliJson::object([
      ("scannedFiles", CliJson::int(input.scan.scanned_files)),
      ("scannedBytes", CliJson::int(input.scan.scanned_bytes)),
      ("skippedLargeFiles", CliJson::int(input.scan.skipped_large_files)),
      ("completeness", CliJson::string("static-source-only")),
    ])),
  ])
}

///|
pub fn inspect_report(input : InspectInput) -> CliJson {
  CliJson::object([
    ("schema", CliJson::int(1)),
    ("tool", tool_json(input.implementation)),
    ("command", CliJson::string("inspect")),
    ("status", CliJson::string("inspected")),
    ("compatible", CliJson::bool(false)),
    ("claim", CliJson::string("not-a-compatibility-result")),
    ("tier", CliJson::string(inspect_tier(input))),
    ("source", source_json(input.app_dir, input.pkg, input.config)),
    ("stage", CliJson::null()),
    ("observations", observations_json(input)),
    ("blockers", inspect_blockers(input)),
    ("warnings", inspect_warnings(input)),
    ("generated", CliJson::array([])),
    ("notClaimed", not_claimed_inspect()),
  ])
}

///|
pub(all) struct InitInput {
  app_dir : String
  pkg : PackageInfo
  config : CliConfig
  config_display : String
  implementation : String
}

///|
pub fn init_report(input : InitInput) -> CliJson {
  CliJson::object([
    ("schema", CliJson::int(1)),
    ("tool", tool_json(input.implementation)),
    ("command", CliJson::string("init")),
    ("status", CliJson::string("initialized")),
    ("compatible", CliJson::bool(false)),
    ("claim", CliJson::string("not-a-compatibility-result")),
    ("config", CliJson::string(input.config_display)),
    ("source", CliJson::object([
      ("appDir", CliJson::string(input.app_dir)),
      ("packageName", CliJson::string(input.pkg.name)),
      ("entry", CliJson::string(input.config.main)),
      ("page", CliJson::string(input.config.page)),
      ("renderer", CliJson::string(input.config.renderer)),
    ])),
    ("blockers", CliJson::array([])),
    ("notClaimed", json_string_array([
      "compatibility", "security", "packaging",
    ])),
  ])
}

///|
pub(all) struct GeneratedFile {
  path : String
  sha256 : String
  bytes : Int
}

///|
pub(all) struct MigrateInput {
  inspect : InspectInput
  stage_root : String
  stage_files : Int
  stage_bytes : Int
  manifest_sha256 : String
  adapted : String?
  generated : Array[GeneratedFile]
}

///|
fn generated_json(files : Array[GeneratedFile]) -> CliJson {
  CliJson::array(
    files.map(file =>
      CliJson::object([
        ("path", CliJson::string(file.path)),
        ("sha256", CliJson::string(file.sha256)),
        ("bytes", CliJson::int(file.bytes)),
      ])
    ),
  )
}

///|
pub fn migrate_blocked_report(input : InspectInput) -> CliJson {
  CliJson::object([
    ("schema", CliJson::int(1)),
    ("tool", tool_json(input.implementation)),
    ("command", CliJson::string("migrate")),
    ("status", CliJson::string("blocked")),
    ("compatible", CliJson::bool(false)),
    ("claim", CliJson::string("not-a-compatibility-result")),
    ("tier", CliJson::string("blocked")),
    ("source", source_json(input.app_dir, input.pkg, input.config)),
    ("stage", CliJson::null()),
    ("observations", observations_json(input)),
    ("blockers", inspect_blockers(input)),
    ("warnings", inspect_warnings(input)),
    ("generated", CliJson::array([])),
    ("notClaimed", not_claimed_inspect()),
  ])
}

///|
pub fn migrate_dry_report(
  input : InspectInput,
  stage_root : String,
  files : Int,
  bytes : Int,
) -> CliJson {
  CliJson::object([
    ("schema", CliJson::int(1)),
    ("tool", tool_json(input.implementation)),
    ("command", CliJson::string("migrate")),
    ("status", CliJson::string("inspected")),
    ("compatible", CliJson::bool(false)),
    ("claim", CliJson::string("not-a-compatibility-result")),
    ("tier", CliJson::string(inspect_tier(input))),
    ("source", source_json(input.app_dir, input.pkg, input.config)),
    ("stage", CliJson::object([
      ("root", CliJson::string(stage_root)),
      ("files", CliJson::int(files)),
      ("bytes", CliJson::int(bytes)),
      ("manifestSha256", CliJson::null()),
    ])),
    ("observations", observations_json(input)),
    ("blockers", inspect_blockers(input)),
    ("warnings", inspect_warnings(input)),
    ("generated", CliJson::array([])),
    ("notClaimed", not_claimed_inspect()),
  ])
}

///|
pub fn migrate_report(input : MigrateInput) -> CliJson {
  let inspected = input.inspect
  CliJson::object([
    ("schema", CliJson::int(1)),
    ("tool", tool_json(inspected.implementation)),
    ("command", CliJson::string("migrate")),
    ("status", CliJson::string("staged")),
    ("compatible", CliJson::bool(false)),
    ("claim", CliJson::string("not-a-compatibility-result")),
    ("tier", CliJson::string(inspect_tier(inspected))),
    ("source", source_json(inspected.app_dir, inspected.pkg, inspected.config)),
    ("stage", CliJson::object([
      ("root", CliJson::string(input.stage_root)),
      ("files", CliJson::int(input.stage_files)),
      ("bytes", CliJson::int(input.stage_bytes)),
      ("manifestSha256", CliJson::string(input.manifest_sha256)),
    ])),
    ("observations", observations_json(inspected)),
    ("blockers", inspect_blockers(inspected)),
    ("warnings", inspect_warnings(inspected)),
    ("generated", generated_json(input.generated)),
    ("notClaimed", not_claimed_inspect()),
    ("adapted", match input.adapted {
      Some(adapter) => CliJson::object([("adapter", CliJson::string(adapter))])
      None => CliJson::null()
    }),
    ("sourceUnchanged", CliJson::bool(true)),
  ])
}
