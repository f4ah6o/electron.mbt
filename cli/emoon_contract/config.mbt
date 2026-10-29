///|
pub(all) struct CliConfig {
  schema : Int
  main : String
  renderer : String
  page : String
  include : Array[String]
  api : String?
  asset_schemes : Array[String]
  config_file : String
  workspace : String
}

///|
fn config_text_field(value : Json, key : String) -> String? {
  match value {
    Object(fields) =>
      match fields.get(key) {
        Some(String(text)) => Some(text)
        _ => None
      }
    _ => None
  }
}

///|
///|
fn config_int_field(value : Json, key : String) -> Int? {
  match value {
    Object(fields) =>
      match fields.get(key) {
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
    _ => None
  }
}

///|
fn config_string_array(value : Json, key : String) -> Array[String]? {
  match value {
    Object(fields) =>
      match fields.get(key) {
        Some(Array(items)) => {
          let result : Array[String] = []
          for item in items {
            match item {
              String(text) => result.push(text)
              _ => return None
            }
          }
          Some(result)
        }
        _ => None
      }
    _ => None
  }
}

///|
fn config_api(value : Json) -> Result[String?, CliError] {
  match value {
    Object(fields) =>
      match fields.get("api") {
        Some(Null) | None => Ok(None)
        Some(String(text)) => {
          if text == "" {
            Ok(None)
          } else {
            match normalize_relative(text, "api") {
              Ok(path) => Ok(Some(path))
              Err(error) => Err(error)
            }
          }
        }
        Some(_) =>
          Err(CliError::new(
            "ELECTRON_MBT_MIGRATE_CONFIG",
            "api must be a string or null",
          ))
      }
    _ =>
      Err(CliError::new(
        "ELECTRON_MBT_MIGRATE_CONFIG",
        "unsupported .emoon/config.json schema",
      ))
  }
}

///|
/// Parse the on-disk config. The caller supplies the already-normalized config
/// file and workspace paths so the pure merge step stays testable.
pub fn config_from_json(
  value : Json,
  config_file : String,
  workspace : String,
) -> Result[CliConfig, CliError] {
  let schema = match config_int_field(value, "schema") {
    Some(number) => number
    None => {
      return Err(CliError::new(
        "ELECTRON_MBT_MIGRATE_CONFIG",
        "unsupported .emoon/config.json schema",
      ))
    }
  }
  if schema != 1 {
    return Err(CliError::new(
      "ELECTRON_MBT_MIGRATE_CONFIG",
      "unsupported .emoon/config.json schema",
    ))
  }
  let main = match config_text_field(value, "main") {
    Some(text) =>
      match normalize_relative(text, "main") {
        Ok(path) => path
        Err(error) => return Err(error)
      }
    None =>
      return Err(CliError::new(
        "ELECTRON_MBT_MIGRATE_CONFIG",
        "main is required",
      ))
  }
  let renderer = match config_text_field(value, "renderer") {
    Some(text) =>
      match normalize_relative(text, "renderer") {
        Ok(path) => path
        Err(error) => return Err(error)
      }
    None =>
      return Err(CliError::new(
        "ELECTRON_MBT_MIGRATE_CONFIG",
        "renderer is required",
      ))
  }
  let include = match config_string_array(value, "include") {
    Some(items) => {
      let result : Array[String] = []
      for item in items {
        match normalize_relative(item, "include") {
          Ok(path) => result.push(path)
          Err(error) => return Err(error)
        }
      }
      result
    }
    None => []
  }
  let page_text = match config_text_field(value, "page") {
    Some(text) => text
    None => renderer + "/index.html"
  }
  let page = match normalize_relative(page_text, "page") {
    Ok(path) => path
    Err(error) => return Err(error)
  }
  let api = match config_api(value) {
    Ok(path) => path
    Err(error) => return Err(error)
  }
  let asset_schemes = match value {
    Object(fields) =>
      match fields.get("assetSchemes") {
        Some(items) =>
          match @core.protocol_manifest_asset_schemes(items) {
            Ok(schemes) => schemes
            Err(code) =>
              return Err(CliError::new(code, "invalid .emoon/config.json assetSchemes"))
          }
        None => []
      }
    _ => []
  }
  Ok({
    schema: 1,
    main: main,
    renderer: renderer,
    page: page,
    include: include,
    api: api,
    asset_schemes: asset_schemes,
    config_file: config_file,
    workspace: workspace,
  })
}

///|
fn config_push_unique(target : Array[String], value : String) -> Unit {
  if not(target.contains(value)) {
    target.push(value)
  }
}

///|
/// Apply the CLI overrides exactly as `loadConfig` does: the CLI renderer, page
/// and API win; include lists are concatenated with the on-disk entries first
/// and de-duplicated in order.
pub fn merge_config(
  config : CliConfig,
  args : CliArgs,
) -> Result[CliConfig, CliError] {
  let renderer = match args.value("renderer") {
    Some(text) =>
      match normalize_relative(text, "renderer") {
        Ok(path) => path
        Err(error) => return Err(error)
      }
    None => config.renderer
  }
  let page = match args.value("page") {
    Some(text) =>
      match normalize_relative(text, "page") {
        Ok(path) => path
        Err(error) => return Err(error)
      }
    None => {
      if config.page != "" {
        config.page
      } else {
        renderer + "/index.html"
      }
    }
  }
  let api = match args.value("api") {
    Some(text) => {
      if text == "" {
        None
      } else {
        match normalize_relative(text, "api") {
          Ok(path) => Some(path)
          Err(error) => return Err(error)
        }
      }
    }
    None => config.api
  }
  let include : Array[String] = []
  for item in config.include {
    config_push_unique(include, item)
  }
  for item in args.include {
    match normalize_relative(item, "include") {
      Ok(path) => push_unique(include, path)
      Err(error) => return Err(error)
    }
  }
  let asset_schemes = match args.value("asset-scheme") {
    Some(text) => {
      let schemes : Array[String] = []
      for item in text.split(",") {
        let trimmed = item.trim_space().to_owned()
        if trimmed != "" {
          schemes.push(trimmed)
        }
      }
      match @core.admit_asset_schemes(schemes) {
        Ok(_) => schemes
        Err(code) => return Err(CliError::new(code, "invalid --asset-scheme"))
      }
    }
    None => config.asset_schemes
  }
  Ok({
    schema: 1,
    main: config.main,
    renderer: renderer,
    page: page,
    include: include,
    api: api,
    asset_schemes: asset_schemes,
    config_file: config.config_file,
    workspace: config.workspace,
  })
}

///|
/// The config file text, matching `JSON.stringify(config, null, 2) + "\n"`.
pub fn config_text(config : CliConfig) -> String {
  let fields : Array[(String, CliJson)] = [
    ("schema", CliJson::int(1)),
    ("main", CliJson::string(config.main)),
    ("renderer", CliJson::string(config.renderer)),
    ("page", CliJson::string(config.page)),
    ("include", CliJson::array(config.include.map(item => CliJson::string(item)))),
    ("api", match config.api {
      Some(path) => CliJson::string(path)
      None => CliJson::null()
    }),
  ]
  if config.asset_schemes.length() > 0 {
    fields.push((
      "assetSchemes",
      CliJson::array(config.asset_schemes.map(item => CliJson::string(item))),
    ))
  }
  CliJson::object(fields).to_file_text()
}

///|
/// Config used when no `.emoon/config.json` exists. `init` requires a renderer;
/// the caller enforces that before calling this.
pub fn config_default(
  main : String,
  renderer : String,
  page : String?,
  include : Array[String],
  api : String?,
  asset_schemes : Array[String],
  config_file : String,
  workspace : String,
) -> Result[CliConfig, CliError] {
  let normalized_renderer = match normalize_relative(renderer, "renderer") {
    Ok(path) => path
    Err(error) => return Err(error)
  }
  let normalized_page = match page {
    Some(text) =>
      match normalize_relative(text, "page") {
        Ok(path) => path
        Err(error) => return Err(error)
      }
    None => normalized_renderer + "/index.html"
  }
  let normalized_include : Array[String] = []
  for item in include {
    match normalize_relative(item, "include") {
      Ok(path) => normalized_include.push(path)
      Err(error) => return Err(error)
    }
  }
  let normalized_api = match api {
    Some(text) => {
      if text == "" {
        None
      } else {
        match normalize_relative(text, "api") {
          Ok(path) => Some(path)
          Err(error) => return Err(error)
        }
      }
    }
    None => None
  }
  match @core.admit_asset_schemes(asset_schemes) {
    Ok(_) => ()
    Err(code) => return Err(CliError::new(code, "invalid assetSchemes"))
  }
  Ok({
    schema: 1,
    main: main,
    renderer: normalized_renderer,
    page: normalized_page,
    include: normalized_include,
    api: normalized_api,
    asset_schemes: asset_schemes,
    config_file: config_file,
    workspace: workspace,
  })
}

///|
pub fn config_file_text(config : CliConfig) -> String {
  config_text(config)
}
