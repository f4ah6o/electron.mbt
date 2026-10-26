///|
fn command_fail(code : String, message : String) -> Unit {
  println(
    @cli.CliJson::object([
      ("ok", @cli.CliJson::bool(false)),
      ("compatible", @cli.CliJson::bool(false)),
      ("code", @cli.CliJson::string(code)),
      ("message", @cli.CliJson::string(message)),
    ]).to_compact(),
  )
  nodeless_exit(1)
}

///|
fn command_error(error : @cli.CliError) -> Unit {
  command_fail(error.code, error.message)
}

///|
fn command_app_dir(path : String) -> String {
  match fs_realpath(path) {
    Some(value) => {
      if fs_kind(value, "") == 2 {
        value
      } else {
        command_fail(
          "ELECTRON_MBT_INVALID_APP",
          "app root must be a directory",
        )
        ""
      }
    }
    None => {
      command_fail(
        "ELECTRON_MBT_INVALID_APP",
        "cannot resolve the app directory",
      )
      ""
    }
  }
}

///|
fn command_relative_to(root : String, target : String) -> String? {
  if target == root {
    return Some("")
  }
  if @cli.path_inside(root, target) {
    Some(target[root.length() + 1:].to_owned())
  } else {
    None
  }
}

///|
fn command_read_json(
  root : String,
  relative : String,
  io_code : String,
  json_code : String,
) -> Result[Json, @cli.CliError] {
  let text = match fs_read_text(root, relative, 16777216) {
    Some(value) => value
    None =>
      return Err(@cli.CliError::new(
        io_code,
        "cannot read " + relative,
      ))
  }
  let parsed = @json.parse(text) catch {
    _ =>
      return Err(@cli.CliError::new(
        json_code,
        "invalid JSON: " + relative,
      ))
  }
  Ok(parsed)
}

///|
fn command_package(root : String) -> @cli.PackageInfo {
  if fs_kind(root, "package.json") == 3 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_SYMLINK",
      "package.json is a symlink",
    )
  }
  let parsed = match command_read_json(
    root,
    "package.json",
    "ELECTRON_MBT_MIGRATE_IO",
    "ELECTRON_MBT_MIGRATE_JSON",
  ) {
    Ok(value) => value
    Err(error) => {
      command_error(error)
      Json(null)
    }
  }
  match @cli.package_from_json(parsed, @cli.path_basename(root)) {
    Ok(value) => value
    Err(error) => {
      command_error(error)
      { name: "", version: "0.0.0", main: "" }
    }
  }
}

///|
fn command_config_path(root : String, args : @cli.CliArgs) -> String {
  let relative = match args.value("config") {
    Some(value) => {
      match @cli.normalize_relative(value, "config") {
        Ok(path) => path
        Err(error) => {
          command_error(error)
          ".emoon/config.json"
        }
      }
    }
    None => ".emoon/config.json"
  }
  @cli.join_path(root, relative)
}

///|
fn command_detect_renderer(root : String) -> String? {
  for candidate in ["out/renderer", "dist/renderer", "build/renderer"] {
    if fs_kind(root, candidate) == 2 {
      return Some(candidate)
    }
  }
  None
}

///|
fn command_require_main(root : String, main : String) -> Unit {
  let kind = fs_kind(root, main)
  if kind == 3 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_SYMLINK",
      "symlink is not admitted: " + main,
    )
  }
  if kind == 0 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_BUILD_MISSING",
      "package.json main \"" + main +
      "\" does not exist; build the app first (npm run build) or pass emoon dev --build",
    )
  }
  if kind != 1 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_CONFIG",
      "main must be a non-empty regular file",
    )
  }
  if fs_size(root, main) <= 0 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_CONFIG",
      "main must be a non-empty regular file",
    )
  }
}

///|
fn command_build_script(root : String) -> String? {
  let parsed = match command_read_json(
    root,
    "package.json",
    "ELECTRON_MBT_MIGRATE_IO",
    "ELECTRON_MBT_MIGRATE_JSON",
  ) {
    Ok(value) => value
    Err(error) => {
      command_error(error)
      Json(null)
    }
  }
  match parsed {
    Object(fields) =>
      match fields.get("scripts") {
        Some(Object(scripts)) =>
          match scripts.get("build") {
            Some(String(text)) => Some(text)
            _ => None
          }
        _ => None
      }
    _ => None
  }
}

///|
fn command_build_app(root : String) -> Unit {
  let script = match command_build_script(root) {
    Some(value) => value
    None => {
      command_fail(
        "ELECTRON_MBT_MIGRATE_BUILD",
        "package.json has no build script; build the app manually",
      )
      ""
    }
  }
  if script.trim_space().to_owned() == "" {
    command_fail(
      "ELECTRON_MBT_MIGRATE_BUILD",
      "package.json has no build script; build the app manually",
    )
  }
  if fs_kind(root, "node_modules") != 2 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_BUILD_DEPS",
      "dependencies are not installed; run npm install in " + root,
    )
  }
  eprintln("[emoon] npm run build in " + root)
  let status = run_build(root)
  if status != 0 {
    let message = if status == 127 {
      "npm was not found or the build script could not start"
    } else {
      "npm run build exited with " + status.to_string()
    }
    command_fail("ELECTRON_MBT_MIGRATE_BUILD", message)
  }
}

///|
fn command_require_file(root : String, relative : String, label : String) -> Int {
  let kind = fs_kind(root, relative)
  if kind == 3 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_SYMLINK",
      "symlink is not admitted: " + relative,
    )
  }
  if kind == 0 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_CONFIG",
      label + " does not exist: " + relative,
    )
  }
  if kind != 1 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_TYPE",
      label + " must be a regular file: " + relative,
    )
  }
  let size = fs_size(root, relative)
  if size <= 0 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_CONFIG",
      label + " must be a non-empty regular file: " + relative,
    )
  }
  size
}

///|
fn command_init_with_args(root : String, args : @cli.CliArgs) -> Unit {
  let pkg = command_package(root)
  command_require_main(root, pkg.main)
  let renderer = match args.value("renderer") {
    Some(value) =>
      match @cli.normalize_relative(value, "renderer") {
        Ok(path) => path
        Err(error) => {
          command_error(error)
          ""
        }
      }
    None =>
      match command_detect_renderer(root) {
        Some(value) => value
        None => {
          command_fail(
            "ELECTRON_MBT_MIGRATE_CONFIG",
            "could not detect a renderer directory (checked out/renderer, dist/renderer, build/renderer); build the app or pass --renderer <dir>",
          )
          ""
        }
      }
  }
  if renderer == "" {
    return
  }
  let renderer_kind = fs_kind(root, renderer)
  if renderer_kind == 3 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_SYMLINK",
      "symlink is not admitted: " + renderer,
    )
  }
  if renderer_kind != 2 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_CONFIG",
      "renderer must be a directory: " + renderer,
    )
  }
  let page = match args.value("page") {
    Some(value) =>
      match @cli.normalize_relative(value, "page") {
        Ok(path) => path
        Err(error) => {
          command_error(error)
          ""
        }
      }
    None => renderer + "/index.html"
  }
  if page == "" {
    return
  }
  command_require_file(root, page, "page") |> ignore
  let include : Array[String] = []
  for item in args.include {
    let path = match @cli.normalize_relative(item, "include") {
      Ok(value) => value
      Err(error) => {
        command_error(error)
        ""
      }
    }
    if path == "" {
      return
    }
    let kind = fs_kind(root, path)
    if kind == 3 {
      command_fail(
        "ELECTRON_MBT_MIGRATE_SYMLINK",
        "symlink is not admitted: " + path,
      )
    }
    if kind == 0 {
      command_fail(
        "ELECTRON_MBT_MIGRATE_CONFIG",
        "include does not exist: " + path,
      )
    }
    include.push(path)
  }
  let api = match args.value("api") {
    Some(value) => {
      if value == "" {
        None
      } else {
        match @cli.normalize_relative(value, "api") {
          Ok(path) => {
            command_require_file(root, path, "api manifest") |> ignore
            Some(path)
          }
          Err(error) => {
            command_error(error)
            None
          }
        }
      }
    }
    None => None
  }
  let config_file = command_config_path(root, args)
  let config_relative = match command_relative_to(root, config_file) {
    Some(value) => value
    None => {
      command_fail(
        "ELECTRON_MBT_PATH_ESCAPE",
        "--config must stay inside the app root",
      )
      ""
    }
  }
  if config_relative == "" {
    command_fail("ELECTRON_MBT_MIGRATE_USAGE", "--config requires a file path")
    return
  }
  let config_kind = fs_kind(root, config_relative)
  if config_kind == 3 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_SYMLINK",
      "config is a symlink: " + config_relative,
    )
  }
  if config_kind != 0 && not(args.has("force")) {
    command_fail(
      "ELECTRON_MBT_MIGRATE_EXISTS",
      ".emoon/config.json already exists; pass --force to replace it",
    )
  }
  let workspace = @cli.path_dirname(config_relative)
  let config = match @cli.config_default(
    pkg.main,
    renderer,
    Some(page),
    include,
    api,
    config_file,
    if workspace == "." { root } else { @cli.join_path(root, workspace) },
  ) {
    Ok(value) => value
    Err(error) => {
      command_error(error)
      return
    }
  }
  let workspace_relative = @cli.path_dirname(config_relative)
  if workspace_relative != "." {
    let created = fs_mkdir_p(root, workspace_relative)
    if created != 0 {
      command_fail(
        "ELECTRON_MBT_MIGRATE_IO",
        "cannot create " + workspace_relative,
      )
    }
  }
  let written = fs_write_atomic(root, config_relative, @cli.config_text(config))
  if written != 0 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_IO",
      "cannot write " + config_relative,
    )
  }
  let gitignore = if workspace_relative == "." {
    ".gitignore"
  } else {
    workspace_relative + "/.gitignore"
  }
  let gitignore_kind = fs_kind(root, gitignore)
  if gitignore_kind == 3 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_SYMLINK",
      "gitignore is a symlink: " + gitignore,
    )
  }
  if gitignore_kind == 0 {
    if fs_write_atomic(root, gitignore, "app/\n") != 0 {
      command_fail(
        "ELECTRON_MBT_MIGRATE_IO",
        "cannot write " + gitignore,
      )
    }
  }
  let display = if workspace_relative == "." {
    @cli.path_basename(config_relative)
  } else {
    config_relative
  }
  println(
    @cli.init_report({
      app_dir: root,
      pkg: pkg,
      config: config,
      config_display: display,
      implementation: "native",
    }).to_compact(),
  )
}

///|
struct WalkLimits {
  files : Int
  total_bytes : Int
  file_bytes : Int
  entries : Int
  depth : Int
}

///|
struct WalkState {
  files : Array[(String, Int)]
  mut entries : Int
  mut total_bytes : Int
}

///|
fn command_limit_error(message : String) -> @cli.CliError {
  @cli.CliError::new("ELECTRON_MBT_MIGRATE_LIMIT", message)
}

///|
fn command_skip_entry(relative : String, name : String) -> Bool {
  ignore(relative)
  name == ".git" || name == ".emoon" || name == "node_modules"
}

///|
fn command_walk(
  root : String,
  relative : String,
  depth : Int,
  limits : WalkLimits,
  skip_entries : Bool,
  skip_empty : Bool,
  state : WalkState,
) -> Result[Unit, @cli.CliError] {
  state.entries = state.entries + 1
  if state.entries > limits.entries {
    return Err(command_limit_error("app tree exceeds the entry limit"))
  }
  if depth > limits.depth {
    return Err(command_limit_error("app tree exceeds the depth limit"))
  }
  let kind = fs_kind(root, relative)
  if kind == 3 {
    return Err(@cli.CliError::new(
      "ELECTRON_MBT_MIGRATE_SYMLINK",
      "symlink is not admitted: " + relative,
    ))
  }
  if kind == 0 {
    return Err(@cli.CliError::new(
      "ELECTRON_MBT_MIGRATE_IO",
      "app entry disappeared: " + relative,
    ))
  }
  if kind == 2 {
    let names = match fs_list(root, relative) {
      Ok(values) => values
      Err(error) => return Err(error)
    }
    for name in names {
      if skip_entries && command_skip_entry(relative, name) {
        continue
      }
      let child = if relative == "" { name } else { relative + "/" + name }
      match command_walk(root, child, depth + 1, limits, skip_entries, skip_empty, state) {
        Ok(_) => ()
        Err(error) => return Err(error)
      }
    }
    return Ok(())
  }
  if kind == 1 {
    let size = fs_size(root, relative)
    if size < 0 {
      return Err(@cli.CliError::new(
        "ELECTRON_MBT_MIGRATE_IO",
        "cannot stat: " + relative,
      ))
    }
    if size == 0 {
      if skip_empty {
        return Ok(())
      }
      state.files.push((relative, 0))
      if state.files.length() > limits.files {
        return Err(command_limit_error("app tree exceeds the file limit"))
      }
      return Ok(())
    }
    if size > limits.file_bytes {
      return Err(command_limit_error(
        "file exceeds the per-file limit: " + relative,
      ))
    }
    state.total_bytes = state.total_bytes + size
    if state.total_bytes > limits.total_bytes {
      return Err(command_limit_error("app tree exceeds the total byte limit"))
    }
    state.files.push((relative, size))
    if state.files.length() > limits.files {
      return Err(command_limit_error("app tree exceeds the file limit"))
    }
    return Ok(())
  }
  Err(@cli.CliError::new(
    "ELECTRON_MBT_MIGRATE_TYPE",
    "not a regular file or directory: " + relative,
  ))
}

///|
fn command_load_config(
  root : String,
  args : @cli.CliArgs,
  require_renderer : Bool,
) -> @cli.CliConfig {
  let config_file = command_config_path(root, args)
  let config_relative = match command_relative_to(root, config_file) {
    Some(value) => value
    None => {
      command_fail(
        "ELECTRON_MBT_PATH_ESCAPE",
        "--config must stay inside the app root",
      )
      ""
    }
  }
  if config_relative == "" {
    command_fail("ELECTRON_MBT_MIGRATE_USAGE", "--config requires a file path")
    return @cli.config_default(
      "",
      "",
      None,
      [],
      None,
      config_file,
      root,
    ).unwrap()
  }
  let kind = fs_kind(root, config_relative)
  if kind == 3 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_SYMLINK",
      "config is a symlink: " + config_relative,
    )
  }
  let workspace = @cli.path_dirname(config_file)
  if kind == 1 {
    let parsed = match command_read_json(
      root,
      config_relative,
      "ELECTRON_MBT_MIGRATE_IO",
      "ELECTRON_MBT_MIGRATE_JSON",
    ) {
      Ok(value) => value
      Err(error) => {
        command_error(error)
        Json(null)
      }
    }
    let config = match @cli.config_from_json(parsed, config_file, workspace) {
      Ok(value) => value
      Err(error) => {
        command_error(error)
        return @cli.config_default("", "", None, [], None, config_file, workspace).unwrap()
      }
    }
    match @cli.merge_config(config, args) {
      Ok(value) => value
      Err(error) => {
        command_error(error)
        config
      }
    }
  } else {
    let pkg = command_package(root)
    let renderer = match args.value("renderer") {
      Some(value) => value
      None => {
        command_fail(
          "ELECTRON_MBT_MIGRATE_CONFIG",
          "no .emoon/config.json; run `emoon init --renderer <dir>` first",
        )
        ""
      }
    }
    if renderer == "" && require_renderer {
      return @cli.config_default(
        pkg.main,
        "",
        None,
        [],
        None,
        config_file,
        workspace,
      ).unwrap()
    }
    match @cli.config_default(
      pkg.main,
      renderer,
      args.value("page"),
      args.include,
      args.value("api"),
      config_file,
      workspace,
    ) {
      Ok(value) => value
      Err(error) => {
        command_error(error)
        return @cli.config_default("", "", None, [], None, config_file, workspace).unwrap()
      }
    }
  }
}

///|
fn command_stage_path(
  root : String,
  config : @cli.CliConfig,
  args : @cli.CliArgs,
) -> (String, String) {
  let out = match args.value("out") {
    Some(value) => value
    None => ".emoon/app"
  }
  let absolute = if @cli.path_is_absolute(out) {
    for part in out.split("/") {
      if part == ".." {
        command_fail("ELECTRON_MBT_MIGRATE_OUT", "stage must stay inside the app root")
      }
    }
    out
  } else {
    let relative = match @cli.normalize_relative(out, "out") {
      Ok(value) => value
      Err(error) => {
        command_error(error)
        ".emoon/app"
      }
    }
    @cli.join_path(root, relative)
  }
  if absolute == root || not(@cli.path_inside(root, absolute)) {
    command_fail(
      "ELECTRON_MBT_MIGRATE_OUT",
      "stage must be inside the app root and not the root itself",
    )
  }
  let relative = match command_relative_to(root, absolute) {
    Some(value) => value
    None => {
      command_fail("ELECTRON_MBT_MIGRATE_OUT", "stage must stay inside the app root")
      ""
    }
  }
  (absolute, relative)
}

///|
fn command_scan(
  root : String,
  all_files : Array[(String, Int)],
  stage_relative : String,
) -> Result[@cli.ScanReport, @cli.CliError] {
  let candidates : Array[(String, Int)] = []
  for (path, bytes) in all_files {
    if stage_relative != "" &&
      (path == stage_relative || path.has_prefix(stage_relative + "/")) {
      continue
    }
    candidates.push((path, bytes))
  }
  let read_indices = @cli.scan_read_indices(candidates)
  let entries : Array[@cli.ScanEntry] = []
  for index = 0; index < candidates.length(); index = index + 1 {
    let (path, bytes) = candidates[index]
    let mut text : String? = None
    if read_indices.contains(index) {
      if bytes == 0 {
        text = Some("")
      } else {
        match fs_read_text(root, path, 1048576) {
          Some(value) => text = Some(value)
          None =>
            return Err(@cli.CliError::new(
              "ELECTRON_MBT_MIGRATE_SCAN",
              "cannot read source file: " + path,
            ))
        }
      }
    }
    entries.push({ path: path, bytes: bytes, text: text })
  }
  match @cli.scan_symbols(entries) {
    Ok(result) =>
      Ok({
        builtins: result.builtins,
        packages: result.packages,
        local_imports: result.local_imports,
        scanned_files: result.scanned_files,
        scanned_bytes: result.scanned_bytes,
        skipped_large_files: result.skipped_large_files,
      })
    Err(error) => Err(error)
  }
}

///|
fn command_resolve_entry(
  root : String,
  main : String,
) -> Result[String, @cli.CliError] {
  command_resolve_entry_inner(root, main, 0)
}

///|
fn command_resolve_entry_inner(
  root : String,
  main : String,
  depth : Int,
) -> Result[String, @cli.CliError] {
  if depth > 8 {
    return Err(@cli.CliError::new(
      "ELECTRON_MBT_ENTRY_MISSING",
      "cannot resolve the app main entry",
    ))
  }
  let kind = fs_kind(root, main)
  if kind == 3 {
    return Err(@cli.CliError::new(
      "ELECTRON_MBT_MIGRATE_SYMLINK",
      "symlink is not admitted: " + main,
    ))
  }
  if kind == 1 {
    return Ok(main)
  }
  if kind == 2 {
    let package_relative = if main == "" { "package.json" } else { main + "/package.json" }
    let package_kind = fs_kind(root, package_relative)
    if package_kind == 3 {
      return Err(@cli.CliError::new(
        "ELECTRON_MBT_MIGRATE_SYMLINK",
        "symlink is not admitted: " + package_relative,
      ))
    }
    if package_kind == 1 {
      let parsed = match command_read_json(
        root,
        package_relative,
        "ELECTRON_MBT_MIGRATE_IO",
        "ELECTRON_MBT_INVALID_APP",
      ) {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      let package_main = match parsed {
        Object(fields) =>
          match fields.get("main") {
            Some(String(text)) => Some(text)
            _ => None
          }
        _ =>
          return Err(@cli.CliError::new(
            "ELECTRON_MBT_INVALID_APP",
            "package.json must contain an object",
          ))
      }
      match package_main {
        Some(text) => {
          if text != "" && text != "." {
            let relative = match @cli.normalize_relative(text, "package main") {
              Ok(value) => value
              Err(error) => return Err(error)
            }
            let candidate = if main == "" { relative } else { main + "/" + relative }
            match command_resolve_entry_inner(root, candidate, depth + 1) {
              Ok(value) => return Ok(value)
              Err(_) => ()
            }
          }
        }
        None => ()
      }
    }
    for name in ["index.js", "index.json", "index.node"] {
      let candidate = if main == "" { name } else { main + "/" + name }
      let candidate_kind = fs_kind(root, candidate)
      if candidate_kind == 3 {
        return Err(@cli.CliError::new(
          "ELECTRON_MBT_MIGRATE_SYMLINK",
          "symlink is not admitted: " + candidate,
        ))
      }
      if candidate_kind == 1 {
        return Ok(candidate)
      }
    }
    return Err(@cli.CliError::new(
      "ELECTRON_MBT_ENTRY_MISSING",
      "cannot resolve the app main entry",
    ))
  }
  if kind == 0 {
    let base = @cli.path_basename(main)
    let has_extension = base.contains(".") && not(base.has_prefix("."))
    if not(has_extension) {
      for suffix in [".js", ".json", ".node"] {
        let candidate = main + suffix
        let candidate_kind = fs_kind(root, candidate)
        if candidate_kind == 3 {
          return Err(@cli.CliError::new(
            "ELECTRON_MBT_MIGRATE_SYMLINK",
            "symlink is not admitted: " + candidate,
          ))
        }
        if candidate_kind == 1 {
          return Ok(candidate)
        }
      }
    }
  }
  Err(@cli.CliError::new(
    "ELECTRON_MBT_ENTRY_MISSING",
    "cannot resolve the app main entry",
  ))
}

///|
fn command_nearest_package_type(
  root : String,
  entry : String,
) -> Result[String?, @cli.CliError] {
  let mut current = @cli.path_dirname(entry)
  if current == "." {
    current = ""
  }
  let mut pass = 0
  while pass < 64 {
    pass = pass + 1
    let package_relative = if current == "" { "package.json" } else { current + "/package.json" }
    let kind = fs_kind(root, package_relative)
    if kind == 3 {
      return Err(@cli.CliError::new(
        "ELECTRON_MBT_MIGRATE_SYMLINK",
        "symlink is not admitted: " + package_relative,
      ))
    }
    if kind == 1 {
      let text = match fs_read_text(root, package_relative, 65536) {
        Some(value) => value
        None =>
          return Err(@cli.CliError::new(
            "ELECTRON_MBT_MIGRATE_IO",
            "cannot read " + package_relative,
          ))
      }
      let parsed = @json.parse(text) catch {
        _ =>
          return Err(@cli.CliError::new(
            "ELECTRON_MBT_INVALID_APP",
            "Cannot parse package.json",
          ))
      }
      let package_type = match parsed {
        Object(fields) =>
          match fields.get("type") {
            Some(String(value)) => value
            _ => "commonjs"
          }
        _ =>
          return Err(@cli.CliError::new(
            "ELECTRON_MBT_INVALID_APP",
            "package.json must contain an object",
          ))
      }
      return Ok(if package_type == "module" { Some("module") } else { Some("commonjs") })
    }
    if kind != 0 {
      return Err(@cli.CliError::new(
        "ELECTRON_MBT_MIGRATE_TYPE",
        "package.json is not a regular file: " + package_relative,
      ))
    }
    if current == "" {
      break
    }
    let parent = @cli.path_dirname(current)
    current = if parent == "." { "" } else { parent }
  }
  Ok(None)
}

///|
fn command_inspect_input(
  root : String,
  args : @cli.CliArgs,
) -> @cli.InspectInput {
  let pkg = command_package(root)
  let config = command_load_config(root, args, true)
  let state : WalkState = { files: [], entries: 0, total_bytes: 0 }
  let limits : WalkLimits = {
    files: 8192,
    total_bytes: 268435456,
    file_bytes: 33554432,
    entries: 16384,
    depth: 64,
  }
  match command_walk(root, "", 0, limits, true, false, state) {
    Ok(_) => ()
    Err(error) => command_error(error)
  }
  let (_, stage_relative) = command_stage_path(root, config, args)
  let scan = match command_scan(root, state.files, stage_relative) {
    Ok(value) => value
    Err(error) => {
      command_error(error)
      { builtins: [], packages: [], local_imports: [], scanned_files: 0, scanned_bytes: 0, skipped_large_files: 0 }
    }
  }
  // The reference uses inspectApp()/package.json main for entryType and the
  // resolved config main for the preload scan. Keep that split: the report's
  // source.entry is config.main, while entryType reflects package.json main.
  let package_entry = match command_resolve_entry(root, pkg.main) {
    Ok(value) => value
    Err(error) => {
      command_error(error)
      ""
    }
  }
  if package_entry == "" {
    return {
      app_dir: root,
      pkg: pkg,
      entry: "",
      entry_type: "unsupported",
      config: config,
      scan: scan,
      preload_referenced: false,
      native_addons: false,
      asar: false,
      implementation: "native",
    }
  }
  let package_type = match command_nearest_package_type(root, package_entry) {
    Ok(value) => value
    Err(error) => {
      command_error(error)
      None
    }
  }
  let entry_type = @cli.entry_type(package_entry, package_type)
  let main_kind = fs_kind(root, config.main)
  if main_kind == 3 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_SYMLINK",
      "symlink is not admitted: " + config.main,
    )
  }
  if main_kind != 1 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_IO",
      "cannot read " + config.main,
    )
  }
  let size = fs_size(root, config.main)
  let preload_referenced = if size > 0 && size <= 1048576 {
    match fs_read_text(root, config.main, 1048576) {
      Some(text) => @cli.references_preload(text)
      None => false
    }
  } else {
    false
  }
  let mut native_addons = false
  let mut asar = false
  for (path, _) in state.files {
    if path.has_suffix(".node") {
      native_addons = true
    }
    if path.has_suffix(".asar") {
      asar = true
    }
  }
  {
    app_dir: root,
    pkg: pkg,
    entry: package_entry,
    entry_type: entry_type,
    config: config,
    scan: scan,
    preload_referenced: preload_referenced,
    native_addons: native_addons,
    asar: asar,
    implementation: "native",
  }
}

///|
fn command_inspect_with_args(root : String, args : @cli.CliArgs) -> Int {
  let input = command_inspect_input(root, args)
  let report = @cli.inspect_report(input)
  println(report.to_compact())
  if @cli.inspect_tier(input) == "blocked" {
    2
  } else {
    0
  }
}

///|
fn command_hash(root : String, relative : String) -> String {
  match cli_sha256(root, relative) {
    Some(value) => value
    None => {
      command_fail(
        "ELECTRON_MBT_MIGRATE_IO",
        "cannot hash " + relative,
      )
      ""
    }
  }
}

///|
fn command_size(root : String, relative : String) -> Int {
  let size = fs_size(root, relative)
  if size < 0 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_IO",
      "cannot stat " + relative,
    )
  }
  size
}

///|
fn command_add_file(
  root : String,
  files : Array[String],
  state : WalkState,
  relative : String,
) -> Result[Unit, @cli.CliError] {
  let kind = fs_kind(root, relative)
  if kind == 3 {
    return Err(@cli.CliError::new(
      "ELECTRON_MBT_MIGRATE_SYMLINK",
      "symlink is not admitted: " + relative,
    ))
  }
  if kind != 1 {
    return Err(@cli.CliError::new(
      "ELECTRON_MBT_MIGRATE_TYPE",
      "main entry must be a non-empty regular file",
    ))
  }
  let size = fs_size(root, relative)
  if size <= 0 {
    return Err(@cli.CliError::new(
      "ELECTRON_MBT_MIGRATE_TYPE",
      "file must be non-empty: " + relative,
    ))
  }
  if size > 16777216 {
    return Err(command_limit_error("file exceeds 16 MiB: " + relative))
  }
  state.total_bytes = state.total_bytes + size
  if state.total_bytes > 67108864 {
    return Err(command_limit_error("stage exceeds the 64 MiB limit"))
  }
  if not(files.contains(relative)) {
    files.push(relative)
  }
  state.files.push((relative, size))
  if files.length() > 4096 {
    return Err(command_limit_error("stage exceeds the 4096 file limit"))
  }
  Ok(())
}

///|
fn command_collect_files(
  root : String,
  config : @cli.CliConfig,
  args : @cli.CliArgs,
) -> Result[Array[String], @cli.CliError] {
  let files : Array[String] = []
  let state : WalkState = { files: [], entries: 0, total_bytes: 0 }
  let limits : WalkLimits = {
    files: 4096,
    total_bytes: 67108864,
    file_bytes: 16777216,
    entries: 16384,
    depth: 64,
  }
  match command_add_file(root, files, state, "package.json") {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  match command_add_file(root, files, state, config.main) {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  match command_add_file(root, files, state, config.page) {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  let main_directory = @cli.path_dirname(config.main)
  if main_directory != "." && main_directory != "" {
    let main_start = state.files.length()
    match command_walk(root, main_directory, 0, limits, true, true, state) {
      Ok(_) => ()
      Err(error) => return Err(error)
    }
    for (path, _) in state.files[main_start:] {
      if not(files.contains(path)) {
        files.push(path)
      }
    }
  }
  let before = state.files.length()
  match command_walk(root, config.renderer, 0, limits, true, true, state) {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  let renderer_files = state.files[before:]
  for (path, _) in renderer_files {
    if not(files.contains(path)) {
      files.push(path)
    }
  }
  for include in config.include {
    let kind = fs_kind(root, include)
    if kind == 3 {
      return Err(@cli.CliError::new(
        "ELECTRON_MBT_MIGRATE_SYMLINK",
        "symlink is not admitted: " + include,
      ))
    }
    if kind == 0 {
      return Err(@cli.CliError::new(
        "ELECTRON_MBT_MIGRATE_CONFIG",
        "include does not exist: " + include,
      ))
    }
    let start = state.files.length()
    match command_walk(root, include, 0, limits, true, true, state) {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
    for (path, _) in state.files[start:] {
      if not(files.contains(path)) {
        files.push(path)
      }
    }
  }
  let (_, stage_relative) = command_stage_path(root, config, args)
  let filtered : Array[String] = []
  for path in files {
    if stage_relative == "" ||
      (path != stage_relative && not(path.has_prefix(stage_relative + "/"))) {
      filtered.push(path)
    }
  }
  Ok(filtered)
}

///|
fn command_data_present(root : String, stage : String) -> Bool {
  for name in [".appData", ".userData"] {
    let relative = stage + "/" + name
    let kind = fs_kind(root, relative)
    if kind == 1 || kind == 4 {
      return true
    }
    if kind == 2 {
      let count = emoon_fs_dir_count(@utf8.encode(root), @utf8.encode(relative))
      if count > 0 {
        return true
      }
    }
  }
  false
}

///|
fn command_prepare_stage(
  root : String,
  stage : String,
  args : @cli.CliArgs,
) -> Unit {
  let kind = fs_kind(root, stage)
  if kind == 3 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_SYMLINK",
      "stage is a symlink",
    )
  }
  if kind == 4 {
    command_fail("ELECTRON_MBT_MIGRATE_TYPE", "stage is not a directory")
  }
  if kind == 2 {
    if not(args.has("force")) {
      command_fail(
        "ELECTRON_MBT_MIGRATE_EXISTS",
        "stage already exists; pass --force to replace it",
      )
    }
    if command_data_present(root, stage) && not(args.has("reset-data")) {
      command_fail(
        "ELECTRON_MBT_MIGRATE_DATA_PRESENT",
        "stage contains app data; pass --reset-data to delete it",
      )
    }
    if fs_remove_tree(root, stage) != 0 {
      command_fail("ELECTRON_MBT_MIGRATE_IO", "cannot remove the existing stage")
    }
  }
  if fs_mkdir_p(root, stage) != 0 {
    command_fail("ELECTRON_MBT_MIGRATE_IO", "cannot create the stage")
  }
}

///|
fn command_write_adapter(
  root : String,
  stage_root : String,
  stage : String,
  config : @cli.CliConfig,
  manifest_files : Array[String],
  generated : Array[@cli.GeneratedFile],
) -> String? {
  let api = match config.api {
    Some(value) => value
    None => return None
  }
  if fs_kind(root, api) == 3 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_SYMLINK",
      "api manifest is a symlink: " + api,
    )
  }
  let parsed = match command_read_json(
    root,
    api,
    "ELECTRON_MBT_MIGRATE_IO",
    "ELECTRON_MBT_MIGRATE_JSON",
  ) {
    Ok(value) => value
    Err(error) => {
      command_error(error)
      return None
    }
  }
  let source = match @cli.build_adapter(parsed) {
    Ok(value) => value
    Err(message) => {
      command_fail("ELECTRON_MBT_MIGRATE_ADAPTER", message)
      ""
    }
  }
  if source == "" {
    return None
  }
  if @utf8.encode(source).length() > 65536 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_ADAPTER",
      "generated adapter exceeds 64 KiB",
    )
  }
  let adapter = "adapted/page-api.js"
  let profile = "nodeless-app.json"
  if fs_mkdir_p(root, stage + "/adapted") != 0 {
    command_fail("ELECTRON_MBT_MIGRATE_IO", "cannot create the adapted directory")
  }
  if fs_write_atomic(stage_root, adapter, source) != 0 {
    command_fail("ELECTRON_MBT_MIGRATE_IO", "cannot write " + adapter)
  }
  let profile_text = @cli.CliJson::object([
    ("schema", @cli.CliJson::int(1)),
    ("profile", @cli.CliJson::string("electron-nodeless-adapted-v1")),
    ("adapter", @cli.CliJson::string(adapter)),
  ]).to_file_text()
  if fs_write_atomic(stage_root, profile, profile_text) != 0 {
    command_fail("ELECTRON_MBT_MIGRATE_IO", "cannot write " + profile)
  }
  manifest_files.push(adapter)
  manifest_files.push(profile)
  generated.push({
    path: adapter,
    sha256: command_hash(stage_root, adapter),
    bytes: command_size(stage_root, adapter),
  })
  generated.push({
    path: profile,
    sha256: command_hash(stage_root, profile),
    bytes: command_size(stage_root, profile),
  })
  Some(adapter)
}

///|
fn command_migrate_with_args(root : String, args : @cli.CliArgs) -> Int {
  let input = command_inspect_input(root, args)
  if @cli.inspect_tier(input) == "blocked" {
    println(@cli.migrate_blocked_report(input).to_compact())
    return 2
  }
  let files = match command_collect_files(root, input.config, args) {
    Ok(value) => value
    Err(error) => {
      command_error(error)
      return 1
    }
  }
  if files.length() == 0 {
    command_fail("ELECTRON_MBT_MIGRATE_EMPTY", "no files to stage")
    return 1
  }
  let (stage_root, stage) = command_stage_path(root, input.config, args)
  if args.has("dry-run") {
    let mut bytes = 0
    for path in files {
      bytes = bytes + command_size(root, path)
    }
    println(
      @cli.migrate_dry_report(input, stage, files.length(), bytes).to_compact(),
    )
    return 0
  }
  command_prepare_stage(root, stage, args)
  let generated : Array[@cli.GeneratedFile] = []
  for path in files {
    let destination = stage + "/" + path
    let directory = @cli.path_dirname(destination)
    if directory != "." && fs_mkdir_p(root, directory) != 0 {
      command_fail("ELECTRON_MBT_MIGRATE_IO", "cannot create " + directory)
    }
    if fs_copy(root, path, destination) != 0 {
      command_fail("ELECTRON_MBT_MIGRATE_IO", "cannot stage " + path)
    }
    generated.push({
      path: path,
      sha256: command_hash(stage_root, path),
      bytes: command_size(stage_root, path),
    })
  }
  let manifest_files = files.copy()
  let adapted = command_write_adapter(
    root,
    stage_root,
    stage,
    input.config,
    manifest_files,
    generated,
  )
  let ordered = match @cli.manifest_order(input.config.page, manifest_files) {
    Ok(value) => value
    Err(error) => {
      command_error(error)
      return 1
    }
  }
  let manifest_entries : Array[@cli.ManifestFile] = []
  let mut stage_bytes = 0
  for path in ordered {
    let hash = command_hash(stage_root, path)
    let size = command_size(stage_root, path)
    stage_bytes = stage_bytes + size
    manifest_entries.push({ path: path, sha256: hash, bytes: size })
  }
  let app_name = if input.pkg.name == "" {
    @cli.path_basename(stage)
  } else {
    input.pkg.name
  }
  let manifest_text = match @cli.manifest_text(
    app_name,
    input.config.page,
    manifest_entries,
  ) {
    Ok(value) => value
    Err(error) => {
      command_error(error)
      return 1
    }
  }
  if fs_write_atomic(stage_root, "source-manifest.json", manifest_text) != 0 {
    command_fail(
      "ELECTRON_MBT_MIGRATE_IO",
      "cannot write source-manifest.json",
    )
  }
  let manifest_sha256 = command_hash(stage_root, "source-manifest.json")
  let manifest_size = command_size(stage_root, "source-manifest.json")
  let ordered_generated : Array[@cli.GeneratedFile] = [{
    path: "source-manifest.json",
    sha256: manifest_sha256,
    bytes: manifest_size,
  }]
  for file in generated {
    ordered_generated.push(file)
  }
  let report = @cli.migrate_report({
    inspect: input,
    stage_root: stage,
    stage_files: manifest_entries.length(),
    stage_bytes: stage_bytes,
    manifest_sha256: manifest_sha256,
    adapted: adapted,
    generated: ordered_generated,
  })
  let workspace = match command_relative_to(root, input.config.workspace) {
    Some(value) => value
    None => {
      command_fail(
        "ELECTRON_MBT_PATH_ESCAPE",
        "the migration report must stay inside the app root",
      )
      "."
    }
  }
  let report_relative = if workspace == "" || workspace == "." {
    "migration-report.json"
  } else {
    workspace + "/migration-report.json"
  }
  if workspace != "" && workspace != "." && fs_mkdir_p(root, workspace) != 0 {
    command_fail("ELECTRON_MBT_MIGRATE_IO", "cannot create " + workspace)
  }
  if fs_write_atomic(root, report_relative, report.to_file_text()) != 0 {
    command_fail("ELECTRON_MBT_MIGRATE_IO", "cannot write " + report_relative)
  }
  println(report.to_compact())
  0
}

///|
fn command_dev_with_args(root : String, args : @cli.CliArgs) -> Int {
  if args.value("runtime") is Some(_) {
    command_fail(
      "ELECTRON_MBT_MIGRATE_USAGE",
      "the native CLI is the runtime; --runtime is a Node CLI option",
    )
  }
  if args.has("build") {
    command_build_app(root)
  }
  let config_file = command_config_path(root, args)
  let config_relative = match command_relative_to(root, config_file) {
    Some(value) => value
    None => {
      command_fail(
        "ELECTRON_MBT_PATH_ESCAPE",
        "--config must stay inside the app root",
      )
      ""
    }
  }
  if fs_kind(root, config_relative) == 0 {
    command_init_with_args(root, args)
  }
  let inspect_code = command_inspect_with_args(root, args)
  if inspect_code != 0 {
    return inspect_code
  }
  let migrate_code = command_migrate_with_args(root, args)
  if migrate_code != 0 {
    return migrate_code
  }
  let workspace = @cli.path_dirname(config_relative)
  let report_relative = if workspace == "" || workspace == "." {
    "migration-report.json"
  } else {
    workspace + "/migration-report.json"
  }
  let report = match command_read_json(
    root,
    report_relative,
    "ELECTRON_MBT_MIGRATE_REPORT",
    "ELECTRON_MBT_MIGRATE_REPORT",
  ) {
    Ok(value) => value
    Err(error) => {
      command_error(error)
      return 1
    }
  }
  let stage_relative = match report {
    Object(fields) =>
      match fields.get("stage") {
        Some(Object(stage_fields)) =>
          match stage_fields.get("root") {
            Some(String(value)) => value
            _ => ""
          }
        _ => ""
      }
    _ => ""
  }
  if stage_relative == "" {
    command_fail(
      "ELECTRON_MBT_MIGRATE_REPORT",
      "migration report has no stage root",
    )
    return 1
  }
  let normalized_stage = match @cli.normalize_relative(stage_relative, "stage") {
    Ok(value) => value
    Err(error) => {
      command_error(error)
      return 1
    }
  }
  let stage_absolute = @cli.join_path(root, normalized_stage)
  if stage_absolute == root || not(@cli.path_inside(root, stage_absolute)) {
    command_fail(
      "ELECTRON_MBT_MIGRATE_REPORT",
      "migration report stage escapes the app root",
    )
    return 1
  }
  let entry = match report {
    Object(fields) =>
      match fields.get("source") {
        Some(Object(source_fields)) =>
          match source_fields.get("entry") {
            Some(String(value)) => value
            _ => ""
          }
        _ => ""
      }
    _ => ""
  }
  cli_main(["emoon", "doctor", stage_absolute])
  if args.has("no-launch") {
    return 0
  }
  if entry != "" {
    cli_main(["emoon", "run", stage_absolute, "--window", "--entry", entry])
  } else {
    cli_main(["emoon", "run", stage_absolute, "--window"])
  }
  0
}
