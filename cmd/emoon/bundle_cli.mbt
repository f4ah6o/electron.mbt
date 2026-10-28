///|
enum BundleStageState {
  BundleStageMissing
  BundleStageReady
  BundleStageStale
}

///|
struct BundleStageInfo {
  name : String
  version : String
  files : Int
}

///|
struct BundleOptions {
  input : String
  output : String
  host : String
  name : String
  force : Bool
  restage : Bool
  reset_data : Bool
  no_stage : Bool
  build : Bool
  dry_run : Bool
  quiet : Bool
  staging : @cli.CliArgs
}

///|
fn cli_bundle_empty_args() -> @cli.CliArgs {
  {
    app_dir: ".",
    positional: [],
    include: [],
    flags: Map([]),
    values: Map([]),
  }
}

///|
fn cli_bundle_state_text(state : BundleStageState) -> String {
  match state {
    BundleStageMissing => "missing"
    BundleStageReady => "ready"
    BundleStageStale => "stale"
  }
}

///|
fn cli_bundle_state_ready(state : BundleStageState) -> Bool {
  match state {
    BundleStageReady => true
    _ => false
  }
}

///|
fn cli_bundle_state_stale(state : BundleStageState) -> Bool {
  match state {
    BundleStageStale => true
    _ => false
  }
}

///|
fn cli_bundle_log(options : BundleOptions, message : String) -> Unit {
  if not(options.quiet) {
    eprintln("[emoon] " + message)
  }
}

///|
fn cli_bundle_fail(code : String, message : String, hint : String?) -> Unit {
  let fields : Array[(String, @cli.CliJson)] = [
    ("schema", @cli.CliJson::int(1)),
    ("product", @cli.CliJson::string("electromoon")),
    ("command", @cli.CliJson::string("bundle")),
    ("ok", @cli.CliJson::bool(false)),
    ("status", @cli.CliJson::string("FAIL")),
    ("code", @cli.CliJson::string(code)),
    ("message", @cli.CliJson::string(message)),
  ]
  match hint {
    Some(text) => fields.push(("hint", @cli.CliJson::string(text)))
    None => ()
  }
  fields.push(("compatible", @cli.CliJson::bool(false)))
  println(@cli.CliJson::object(fields).to_compact())
  nodeless_exit(1)
}

///|
fn cli_bundle_usage_fail(message : String) -> Unit {
  cli_bundle_fail("ELECTRON_MBT_BUNDLE_USAGE", message, None)
}

///|
fn cli_bundle_usage_help() -> Unit {
  println("usage: emoon bundle [app-dir] [options]")
  println("")
  println("Stage an Electron app when needed and write one native executable.")
  println("")
  println("defaults:")
  println("  app-dir   .")
  println("  output    <app-dir>/.emoon/dist/<name>-<version>-<os>-<arch>")
  println("  host      --host, EMOON_HOST, a sibling emoon-host, dist/emoon-host, PATH")
  println("")
  println("options:")
  println("  --output <file>    explicit output (requires --force when it exists)")
  println("  --force            replace an existing explicit output")
  println("  --name <name>      override the app name used in the bundle and file name")
  println("  --host <path>      native host binary")
  println("  --build            run the app's npm build first")
  println("  --restage          re-stage even when the existing stage is valid")
  println("  --reset-data       delete .appData/.userData while re-staging")
  println("  --no-stage         never init/migrate; require a valid stage")
  println("  --dry-run          print the plan and write nothing")
  println("  --quiet            hide stderr progress")
  println("  --renderer <dir>   forwarded to emoon init/migrate")
  println("  --page <file>      forwarded to emoon init/migrate")
  println("  --api <file>       forwarded to emoon init/migrate")
  println("  --include <paths>  forwarded to emoon init/migrate")
  println("  --config <file>    forwarded to emoon init/migrate")
  println("  --help             show this help")
  println("")
  println("the current bundle profile is electron-nodeless-adapted-v1;")
  println("pass --api <file> when the app needs the adapted page API")
}

///|
fn cli_bundle_parse(raw : Array[String]) -> BundleOptions {
  let staging_raw : Array[String] = []
  let mut input = "."
  let mut input_set = false
  let mut output = ""
  let mut host = ""
  let mut name = ""
  let mut force = false
  let mut restage = false
  let mut reset_data = false
  let mut no_stage = false
  let mut build = false
  let mut dry_run = false
  let mut quiet = false
  let mut index = 0
  while index < raw.length() {
    let arg = raw[index]
    if arg == "--help" || arg == "-h" {
      cli_bundle_usage_help()
      nodeless_exit(0)
    } else if arg == "--force" {
      force = true
      index = index + 1
    } else if arg == "--restage" {
      restage = true
      index = index + 1
    } else if arg == "--reset-data" {
      reset_data = true
      restage = true
      index = index + 1
    } else if arg == "--no-stage" {
      no_stage = true
      index = index + 1
    } else if arg == "--build" {
      build = true
      index = index + 1
    } else if arg == "--dry-run" {
      dry_run = true
      index = index + 1
    } else if arg == "--quiet" {
      quiet = true
      index = index + 1
    } else if arg == "--out" {
      cli_bundle_usage_fail(
        "--out is a staging option; run emoon migrate --out <dir>, then emoon bundle <stage> --output <file>",
      )
      index = index + 1
    } else if arg == "--runtime" {
      cli_bundle_usage_fail("--runtime is a Node CLI option; the native CLI is the runtime")
      index = index + 1
    } else if arg == "--output" || arg == "--host" || arg == "--name" ||
      arg == "--renderer" || arg == "--page" || arg == "--api" ||
      arg == "--include" || arg == "--config" {
      if index + 1 >= raw.length() || raw[index + 1].has_prefix("--") {
        cli_bundle_usage_fail(arg + " requires a value")
      }
      let value = raw[index + 1]
      if value == "" {
        cli_bundle_usage_fail(arg + " requires a non-empty value")
      }
      if arg == "--output" {
        if output != "" {
          cli_bundle_usage_fail("--output is specified more than once")
        }
        output = value
      } else if arg == "--host" {
        if host != "" {
          cli_bundle_usage_fail("--host is specified more than once")
        }
        host = value
      } else if arg == "--name" {
        if name != "" {
          cli_bundle_usage_fail("--name is specified more than once")
        }
        name = value
      } else {
        staging_raw.push(arg)
        staging_raw.push(value)
      }
      index = index + 2
    } else if arg.has_prefix("--") {
      cli_bundle_usage_fail("unknown bundle option: " + arg)
    } else if arg.has_prefix("-") && arg != "-" {
      cli_bundle_usage_fail("unknown bundle option: " + arg)
    } else {
      if input_set {
        cli_bundle_usage_fail("only one app directory is accepted")
      }
      input = arg
      input_set = true
      index = index + 1
    }
  }
  if no_stage && (restage || reset_data) {
    cli_bundle_usage_fail("--no-stage cannot be combined with --restage or --reset-data")
  }
  let staging = match @cli.parse_args(staging_raw) {
    Ok(value) => value
    Err(error) => {
      cli_bundle_fail("ELECTRON_MBT_BUNDLE_USAGE", error.message, None)
      cli_bundle_empty_args()
    }
  }
  {
    input: input,
    output: output,
    host: host,
    name: name,
    force: force,
    restage: restage,
    reset_data: reset_data,
    no_stage: no_stage,
    build: build,
    dry_run: dry_run,
    quiet: quiet,
    staging: staging,
  }
}

///|
fn cli_bundle_stage_root(root : String) -> String {
  root + "/.emoon/app"
}

///|
fn cli_bundle_is_stage(input : String) -> Bool {
  cli_read_text(input, "source-manifest.json") is Some(_)
}

///|
fn cli_bundle_read_stage(
  stage : String,
) -> Result[BundleStageInfo, (BundleStageState, String)] {
  let manifest = match cli_read_text(stage, "source-manifest.json") {
    Some(value) => value
    None => return Err((BundleStageMissing, "source-manifest.json is missing"))
  }
  let parsed = @json.parse(manifest) catch {
    _ => return Err((BundleStageStale, "source-manifest.json is invalid"))
  }
  let items = match cli_field(parsed, "files") {
    Array(values) => values
    _ => return Err((BundleStageStale, "source-manifest.json has no file list"))
  }
  let mut files = 0
  for item in items {
    let path = match cli_text(item, "path") {
      Some(value) => value
      None => return Err((BundleStageStale, "manifest file path is missing"))
    }
    let expected = match cli_text(item, "sha256") {
      Some(value) => value
      None => return Err((BundleStageStale, "manifest file hash is missing"))
    }
    let actual = match cli_sha256(stage, path) {
      Some(value) => value
      None => return Err((BundleStageStale, "cannot hash " + path))
    }
    if actual != expected {
      return Err((BundleStageStale, "staged file changed: " + path))
    }
    files = files + 1
  }
  if files == 0 {
    return Err((BundleStageStale, "source-manifest.json is empty"))
  }
  let package_text = match cli_read_text(stage, "package.json") {
    Some(value) => value
    None => return Err((BundleStageStale, "package.json is missing"))
  }
  let package = @json.parse(package_text) catch {
    _ => return Err((BundleStageStale, "package.json is invalid"))
  }
  let name = match cli_text(package, "name") {
    Some(value) if value.length() > 0 => value
    _ => "app"
  }
  let version = match cli_text(package, "version") {
    Some(value) if value.length() > 0 => value
    _ => "0.0.0"
  }
  let profile = match cli_read_text(stage, "nodeless-app.json") {
    Some(value) => value
    None =>
      return Err((
        BundleStageStale,
        "nodeless-app.json is missing (stage with --api <file> for electron-nodeless-adapted-v1)",
      ))
  }
  if profile.contains("electron-nodeless-adapted-v1") &&
    cli_read_text(stage, "adapted/page-api.js") is None {
    return Err((BundleStageStale, "adapted/page-api.js is missing"))
  }
  Ok({ name: name, version: version, files: files })
}

///|
/// Compare the prepared stage with the current app source. The stage hash
/// check only proves that the stage is internally consistent; a rebuild can
/// change the app files, so reuse needs this source-level comparison too.
/// Generated files do not exist in the app root, so they are skipped here and
/// the page adapter is regenerated from the configured API manifest instead.
fn cli_bundle_source_matches(
  root : String,
  stage : String,
  args : @cli.CliArgs,
) -> Bool {
  let config = command_load_config(root, args, true)
  let files = match command_collect_files(root, config, args) {
    Ok(value) => value
    Err(_) => return false
  }
  let manifest = match cli_read_text(stage, "source-manifest.json") {
    Some(value) => value
    None => return false
  }
  let parsed = @json.parse(manifest) catch {
    _ => return false
  }
  let items = match cli_field(parsed, "files") {
    Array(values) => values
    _ => return false
  }
  let expected : Map[String, String] = {}
  for item in items {
    let path = match cli_text(item, "path") {
      Some(value) => value
      None => return false
    }
    let hash = match cli_text(item, "sha256") {
      Some(value) => value
      None => return false
    }
    expected[path] = hash
  }
  for path in files {
    let want = match expected.get(path) {
      Some(value) => value
      None => return false
    }
    let have = match cli_sha256(root, path) {
      Some(value) => value
      None => return false
    }
    if want != have {
      return false
    }
  }
  for item in items {
    let path = match cli_text(item, "path") {
      Some(value) => value
      None => return false
    }
    if path != "nodeless-app.json" && path != "adapted/page-api.js" {
      if not(files.contains(path)) {
        return false
      }
    }
  }
  match config.api {
    Some(api) => {
      let parsed_api = match command_read_json(
        root,
        api,
        "ELECTRON_MBT_BUNDLE_STAGE",
        "ELECTRON_MBT_BUNDLE_STAGE",
      ) {
        Ok(value) => value
        Err(_) => return false
      }
      let source = match @cli.build_adapter(parsed_api) {
        Ok(value) => value
        Err(_) => return false
      }
      match cli_read_text(stage, "adapted/page-api.js") {
        Some(staged) => staged == source
        None => false
      }
    }
    None => true
  }
}

///|
fn cli_bundle_config_present(root : String, staging : @cli.CliArgs) -> Bool {
  let path = command_config_path(root, staging)
  cli_realpath(path) != ""
}

///|
fn cli_bundle_require_built(root : String) -> Unit {
  let pkg = command_package(root)
  if pkg.main != "" && fs_kind(root, pkg.main) == 0 {
    cli_bundle_fail(
      "ELECTRON_MBT_BUNDLE_BUILD_MISSING",
      "package.json main \"" + pkg.main +
      "\" does not exist; build the app or pass --build",
      Some("emoon bundle --build"),
    )
  }
}

///|
fn cli_bundle_stage_now(
  root : String,
  options : BundleOptions,
  force : Bool,
) -> Result[BundleStageInfo, (BundleStageState, String)] {
  if not(cli_bundle_config_present(root, options.staging)) {
    command_init_with_args(root, options.staging, emit=false)
  }
  if force {
    options.staging.flags["force"] = true
  }
  if options.reset_data {
    options.staging.flags["force"] = true
    options.staging.flags["reset-data"] = true
  }
  let code = command_migrate_with_args(root, options.staging, emit=false)
  if code != 0 {
    nodeless_exit(code)
    return Err((BundleStageStale, "staging failed"))
  }
  cli_bundle_read_stage(cli_bundle_stage_root(root))
}

///|
fn cli_bundle_ensure_stage(
  root : String,
  options : BundleOptions,
  force : Bool,
) -> BundleStageInfo {
  match cli_bundle_stage_now(root, options, force) {
    Ok(value) => value
    Err((_, message)) => {
      cli_bundle_fail(
        "ELECTRON_MBT_BUNDLE_STAGE",
        "staged app failed validation: " + message,
        None,
      )
      { name: "app", version: "0.0.0", files: 0 }
    }
  }
}

///|
fn cli_bundle_resolve_host(options : BundleOptions) -> String {
  let mut candidate = options.host
  if candidate == "" {
    let buffer = Bytes::new(4096)
    let length = bundle_default_host(buffer, buffer.length())
    if length <= 0 {
      cli_bundle_fail(
        "ELECTRON_MBT_BUNDLE_HOST",
        "cannot resolve emoon-host",
        Some("pass --host <path>, set EMOON_HOST, or install emoon-host next to emoon"),
      )
      return ""
    }
    candidate = @utf8.decode_lossy(buffer[:length])
  }
  let canonical = cli_realpath(candidate)
  if canonical == "" {
    cli_bundle_fail(
      "ELECTRON_MBT_BUNDLE_HOST",
      "emoon-host was not found: " + candidate,
      Some("pass --host <path>, set EMOON_HOST, or install emoon-host next to emoon"),
    )
    return ""
  }
  canonical
}

///|
fn cli_bundle_default_output(
  root : String,
  name : String,
  version : String,
) -> String {
  root + "/.emoon/dist/" +
  @cli.bundle_file_name(name, version, cli_platform(), cli_arch())
}

///|
fn cli_bundle_output_path(
  root : String,
  name : String,
  version : String,
  options : BundleOptions,
) -> String {
  if options.output == "" {
    return cli_bundle_default_output(root, name, version)
  }
  if options.output.ends_with("/") {
    cli_bundle_usage_fail("--output must name a file: " + options.output)
  }
  let parent = @cli.path_dirname(options.output)
  let base = @cli.path_basename(options.output)
  if base == "" || base == "." || base == ".." {
    cli_bundle_usage_fail("--output must name a file: " + options.output)
  }
  let canonical_parent = cli_realpath(parent)
  if canonical_parent == "" {
    cli_bundle_fail(
      "ELECTRON_MBT_BUNDLE_OUTPUT",
      "output directory does not exist: " + parent,
      Some("create the directory or pass --output inside an existing directory"),
    )
    return ""
  }
  if canonical_parent == "/" {
    "/" + base
  } else {
    canonical_parent + "/" + base
  }
}

///|
fn cli_bundle_path_exists(path : String) -> Bool {
  cli_realpath(path) != ""
}

///|
fn cli_bundle_prepare_default_output(root : String) -> Unit {
  let kind = fs_kind(root, ".emoon/dist")
  if kind == 3 {
    cli_bundle_fail(
      "ELECTRON_MBT_BUNDLE_OUTPUT",
      ".emoon/dist is a symlink",
      Some("remove it or pass --output"),
    )
    return
  }
  if kind != 2 && fs_mkdir_p(root, ".emoon/dist") != 0 {
    cli_bundle_fail("ELECTRON_MBT_BUNDLE_IO", "cannot create .emoon/dist", None)
    return
  }
  if fs_kind(root, ".emoon/dist/.gitignore") == 0 &&
    fs_write_atomic(root, ".emoon/dist/.gitignore", "*\n") != 0 {
    cli_bundle_fail("ELECTRON_MBT_BUNDLE_IO", "cannot write .emoon/dist/.gitignore", None)
  }
}

///|
fn cli_bundle_report_number(text : String, key : String) -> Int {
  let parsed = @json.parse(text) catch {
    _ => Json(null)
  }
  match cli_field(parsed, key) {
    Number(value, ..) => value.to_int()
    _ => 0
  }
}

///|
fn cli_bundle_merge_report(
  text : String,
  mode : String,
  stage_root : String,
  files : Int,
  replaced : Bool,
  output : String,
) -> String {
  let parsed = @json.parse(text) catch {
    _ => Json(null)
  }
  match parsed {
    Object(fields) => {
      fields["command"] = Json("bundle")
      fields["stage"] = Json({
        "mode": Json(mode),
        "root": Json(stage_root),
        "files": Json(files),
      })
      fields["replaced"] = Json(replaced)
      fields["next"] = Json({
        "run": Json(output),
        "info": Json(output + " --bundle-info"),
      })
      Json(fields).stringify()
    }
    _ => text
  }
}

///|
fn cli_bundle_actions(
  options : BundleOptions,
  root : String,
  state : BundleStageState,
) -> Array[String] {
  let actions : Array[String] = []
  if options.build {
    actions.push("build")
  }
  let needs_stage = not(cli_bundle_state_ready(state)) ||
    options.restage ||
    options.reset_data
  if needs_stage && not(cli_bundle_config_present(root, options.staging)) {
    actions.push("init")
  }
  if needs_stage {
    actions.push("stage")
  }
  actions.push("bundle")
  actions
}

///|
fn cli_bundle_action_text(actions : Array[String]) -> String {
  let mut text = ""
  for action in actions {
    if text != "" {
      text = text + ","
    }
    text = text + action
  }
  text
}

///|
fn cli_bundle_plan(
  options : BundleOptions,
  root : String,
  state : BundleStageState,
  info : BundleStageInfo,
  name : String,
  version : String,
  host : String,
  output : String,
  replace : Bool,
) -> Unit {
  let actions = cli_bundle_actions(options, root, state)
  let action_json : Array[@cli.CliJson] = []
  for action in actions {
    action_json.push(@cli.CliJson::string(action))
  }
  let report = @cli.CliJson::object([
    ("schema", @cli.CliJson::int(1)),
    ("product", @cli.CliJson::string("electromoon")),
    ("command", @cli.CliJson::string("bundle")),
    ("status", @cli.CliJson::string("planned")),
    (
      "app",
      @cli.CliJson::object([
        ("root", @cli.CliJson::string(root)),
        ("name", @cli.CliJson::string(name)),
        ("version", @cli.CliJson::string(version)),
      ]),
    ),
    (
      "stage",
      @cli.CliJson::object([
        ("state", @cli.CliJson::string(cli_bundle_state_text(state))),
        ("root", @cli.CliJson::string(cli_bundle_stage_root(root))),
        ("files", @cli.CliJson::int(info.files)),
      ]),
    ),
    ("host", @cli.CliJson::object([("path", @cli.CliJson::string(host))])),
    ("output", @cli.CliJson::string(output)),
    ("actions", @cli.CliJson::array(action_json)),
    ("replaceOutput", @cli.CliJson::bool(replace)),
    ("compatible", @cli.CliJson::bool(false)),
    ("claim", @cli.CliJson::string("not-a-compatibility-result")),
  ]).to_compact()
  println(report)
  cli_bundle_log(options, "app " + name + " " + version + " in " + root)
  cli_bundle_log(
    options,
    "stage " + cli_bundle_state_text(state) + " " + cli_bundle_stage_root(root),
  )
  cli_bundle_log(options, "host " + host)
  cli_bundle_log(options, "output " + output)
  cli_bundle_log(options, "actions " + cli_bundle_action_text(actions))
}

///|
fn cli_bundle_write(
  options : BundleOptions,
  stage_root : String,
  name : String,
  version : String,
  host : String,
  output : String,
  mode : String,
  files : Int,
  replaced : Bool,
) -> Unit {
  let report_buffer = Bytes::new(16384)
  let error_buffer = Bytes::new(4096)
  let force = if options.output == "" { true } else { options.force }
  let code = bundle_create(
    @utf8.encode(output),
    @utf8.encode(stage_root),
    @utf8.encode(host),
    @utf8.encode(name),
    @utf8.encode(version),
    report_buffer,
    report_buffer.length(),
    error_buffer,
    error_buffer.length(),
    if force { 1 } else { 0 },
  )
  if code <= 0 {
    let text = cli_bundle_trim_nul(@utf8.decode_lossy(error_buffer))
    let parsed = @json.parse(text) catch {
      _ => Json(null)
    }
    let error_code = match cli_text(parsed, "code") {
      Some(value) => value
      None => "ELECTRON_MBT_BUNDLE_IO"
    }
    let message = match cli_text(parsed, "message") {
      Some(value) => value
      None => if text == "" { "bundle failed" } else { text }
    }
    cli_bundle_fail(error_code, message, None)
    return
  }
  let report_text = @utf8.decode_lossy(report_buffer[:code])
  let bytes = cli_bundle_report_number(report_text, "bytes")
  println(
    cli_bundle_merge_report(report_text, mode, stage_root, files, replaced, output),
  )
  cli_bundle_log(
    options,
    "wrote " + output + " (" + @cli.bundle_size_text(bytes) + ")",
  )
  cli_bundle_log(options, "run " + output)
  cli_bundle_log(options, "info " + output + " --bundle-info")
}

///|
fn cli_bundle_stage_mode_command(
  options : BundleOptions,
  stage_root : String,
) -> Unit {
  if options.output == "" {
    cli_bundle_usage_fail(
      "a prepared stage requires --output; pass an app directory to use the default .emoon/dist path",
    )
  }
  if options.build || options.restage || options.reset_data || options.no_stage {
    cli_bundle_usage_fail(
      "--build/--restage/--reset-data/--no-stage require an app directory, not a prepared stage",
    )
  }
  let info = match cli_bundle_read_stage(stage_root) {
    Ok(value) => value
    Err((_, message)) => {
      cli_bundle_fail("ELECTRON_MBT_BUNDLE_STAGE", message, None)
      { name: "app", version: "0.0.0", files: 0 }
    }
  }
  let name = if options.name != "" { options.name } else { info.name }
  let host = cli_bundle_resolve_host(options)
  let output = cli_bundle_output_path(stage_root, name, info.version, options)
  let replaced = cli_bundle_path_exists(output)
  if replaced && not(options.force) {
    cli_bundle_fail(
      "ELECTRON_MBT_BUNDLE_EXISTS",
      "output exists: " + output,
      Some("--force"),
    )
  }
  if options.dry_run {
    cli_bundle_plan(
      options,
      stage_root,
      BundleStageReady,
      info,
      name,
      info.version,
      host,
      output,
      replaced,
    )
    return
  }
  cli_bundle_log(options, "stage " + stage_root + " (" + info.files.to_string() + " files)")
  cli_bundle_log(options, "host " + host)
  cli_bundle_write(
    options,
    stage_root,
    name,
    info.version,
    host,
    output,
    "direct",
    info.files,
    replaced,
  )
}

///|
fn cli_bundle_app_command(options : BundleOptions) -> Unit {
  let root = command_app_dir(options.input)
  if fs_kind(root, "package.json") != 1 {
    cli_bundle_fail(
      "ELECTRON_MBT_BUNDLE_INPUT",
      "not an Electron app: package.json is missing in " + root,
      Some("pass the app root, or a prepared stage with --output"),
    )
  }
  if options.build && not(options.dry_run) {
    command_build_app(root)
  }
  let stage_root = cli_bundle_stage_root(root)
  let read_stage = cli_bundle_read_stage(stage_root)
  let state = match read_stage {
    Ok(_) => {
      if options.restage || options.reset_data {
        BundleStageReady
      } else if not(cli_bundle_config_present(root, options.staging)) {
        BundleStageReady
      } else if cli_bundle_source_matches(root, stage_root, options.staging) {
        BundleStageReady
      } else {
        BundleStageStale
      }
    }
    Err((value, _)) => value
  }
  if options.no_stage {
    match state {
      BundleStageReady => ()
      BundleStageMissing =>
        cli_bundle_fail(
          "ELECTRON_MBT_BUNDLE_STAGE",
          "no prepared stage in " + stage_root,
          Some("run emoon migrate or drop --no-stage"),
        )
      BundleStageStale =>
        cli_bundle_fail(
          "ELECTRON_MBT_BUNDLE_STALE",
          "the prepared stage does not match the app",
          Some("run emoon migrate --force or drop --no-stage"),
        )
    }
  }
  let needs_stage = not(cli_bundle_state_ready(state)) ||
    options.restage ||
    options.reset_data
  if needs_stage {
    if not(options.build) {
      cli_bundle_require_built(root)
    }
    if not(options.reset_data) &&
      (cli_bundle_state_ready(state) || cli_bundle_state_stale(state)) {
      if command_data_present(root, ".emoon/app") {
        cli_bundle_fail(
          "ELECTRON_MBT_BUNDLE_STALE",
          "the stage contains .appData/.userData; pass --reset-data to replace it",
          Some("--reset-data deletes app data inside .emoon/app"),
        )
      }
    }
  }
  let mut info : BundleStageInfo = { name: "app", version: "0.0.0", files: 0 }
  let mut name = ""
  let mut version = "0.0.0"
  let mut mode = "reused"
  if options.dry_run {
    let pkg = command_package(root)
    name = if options.name != "" { options.name } else { pkg.name }
    version = pkg.version
    match read_stage {
      Ok(value) => {
        info = value
        name = if options.name != "" { options.name } else { value.name }
        version = value.version
      }
      Err(_) => ()
    }
  } else if needs_stage {
    let force = cli_bundle_state_stale(state) || options.restage || options.reset_data
    info = cli_bundle_ensure_stage(root, options, force)
    mode = "staged"
    name = if options.name != "" { options.name } else { info.name }
    version = info.version
  } else {
    match read_stage {
      Ok(value) => info = value
      Err((_, message)) =>
        cli_bundle_fail("ELECTRON_MBT_BUNDLE_STAGE", message, None)
    }
    name = if options.name != "" { options.name } else { info.name }
    version = info.version
  }
  let host = cli_bundle_resolve_host(options)
  let output = cli_bundle_output_path(root, name, version, options)
  let replaced = cli_bundle_path_exists(output)
  if options.output != "" && replaced && not(options.force) {
    cli_bundle_fail(
      "ELECTRON_MBT_BUNDLE_EXISTS",
      "output exists: " + output,
      Some("--force"),
    )
  }
  if options.dry_run {
    cli_bundle_plan(options, root, state, info, name, version, host, output, replaced)
    return
  }
  if options.output == "" {
    cli_bundle_prepare_default_output(root)
  }
  let stage_text = if mode == "staged" { "staged" } else { "reusing" }
  cli_bundle_log(options, "app " + name + " " + version + " in " + root)
  cli_bundle_log(
    options,
    stage_text + " " + stage_root + " (" + info.files.to_string() + " files)",
  )
  cli_bundle_log(options, "host " + host)
  cli_bundle_write(
    options,
    stage_root,
    name,
    version,
    host,
    output,
    mode,
    info.files,
    replaced,
  )
}

///|
fn cli_bundle_command(raw_args : Array[String]) -> Unit {
  let options = cli_bundle_parse(raw_args)
  if cli_realpath(options.input) == "" {
    cli_bundle_fail(
      "ELECTRON_MBT_BUNDLE_INPUT",
      "app directory does not exist: " + options.input,
      Some("pass an Electron app directory, or a prepared stage with --output"),
    )
  }
  if cli_bundle_is_stage(options.input) {
    cli_bundle_stage_mode_command(options, cli_realpath(options.input))
  } else {
    cli_bundle_app_command(options)
  }
}
