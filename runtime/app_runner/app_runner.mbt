// Node-less app runtime core. MoonBit owns source admission, module graph,
// lifecycle, limits, timer deadlines and diagnostics. QuickJS owns only the
// JavaScript realm (module.exports, functions, Promises, builtin values).

///|
pub(all) enum AppError {
  Manifest(String)
  SourceHash(String)
  SourceLimit
  ModuleMissing(String)
  ModuleResolve(String, String)
  DynamicRequire(String)
  MainEval(String)
  Dispatch(String)
  Timeout
  Stopped
  Engine
} derive(Eq, Debug)

///|
pub fn AppError::code(self : AppError) -> String {
  match self {
    Manifest(_) => "ELECTRON_MBT_NODELESS_MANIFEST"
    SourceHash(_) => "ELECTRON_MBT_NODELESS_SOURCE_HASH"
    SourceLimit => "ELECTRON_MBT_NODELESS_SOURCE_LIMIT"
    ModuleMissing(_) => "ELECTRON_MBT_MODULE_NOT_FOUND"
    ModuleResolve(_, _) => "ELECTRON_MBT_MODULE_NOT_FOUND"
    DynamicRequire(_) => "ELECTRON_MBT_DYNAMIC_REQUIRE"
    MainEval(_) => "ELECTRON_MBT_MAIN_EVAL"
    Dispatch(_) => "ELECTRON_MBT_MAIN_DISPATCH"
    Timeout => "ELECTRON_MBT_MAIN_TIMEOUT"
    Stopped => "ELECTRON_MBT_STOPPED"
    Engine => "ELECTRON_MBT_ENGINE"
  }
}

///|
pub fn AppError::message(self : AppError) -> String {
  match self {
    Manifest(text) => text
    SourceHash(path) => "source hash mismatch: " + path
    SourceLimit => "source manifest limit exceeded"
    ModuleMissing(path) => "module missing: " + path
    ModuleResolve(specifier, parent) => "cannot resolve " + specifier + " from " + parent
    DynamicRequire(path) => "computed require in " + path
    MainEval(text) => text
    Dispatch(text) => text
    Timeout => "main dispatch deadline exceeded"
    Stopped => "runtime stopped"
    Engine => "engine job failure"
  }
}

///|
pub(all) struct SourceFile {
  path : String
  source : String
  sha256 : String
  bytes : Int
}

///|
pub(all) struct SourceSnapshot {
  app : String
  entry : String
  files : Map[String, SourceFile]
}

///|
pub(all) struct AppConfig {
  name : String
  version : String
  app_path : String
  user_data : String
  app_data : String
  resources_path : String
  platform : String
  arch : String
  cwd : String
  env : Map[String, String]
  // Empty for a plain app. In the adapted profile this is the manifest-listed
  // generated page adapter installed before the renderer document loads.
  adapted_adapter : String
  // Custom schemes the staged adapted app may serve through the native asset
  // broker. The host is configured with the same list before main evaluation.
  asset_schemes : Array[String]
}

///|
fn app_json_field(value : Json, key : String) -> Json {
  match value {
    Object(fields) => fields.get(key).unwrap_or(null)
    _ => null
  }
}

///|
fn app_json_text(value : Json, key : String) -> String? {
  match app_json_field(value, key) {
    String(text) => Some(text)
    _ => None
  }
}

///|
fn app_json_number(value : Json, key : String) -> Int? {
  match app_json_field(value, key) {
    Number(number, ..) => Some(number.to_int())
    _ => None
  }
}

///|
fn app_json_bool(value : Json, key : String) -> Bool? {
  match app_json_field(value, key) {
    True => Some(true)
    False => Some(false)
    _ => None
  }
}

///|
fn app_parse_json(text : String) -> Json? {
  let parsed = @json.parse(text) catch {
    _ => return None
  }
  Some(parsed)
}

///|
fn app_valid_relative(path : String) -> Bool {
  if path.length() == 0 || path.length() > 256 {
    return false
  }
  if path.has_prefix("/") || path.has_prefix("\\") {
    return false
  }
  for i = 0; i < path.length(); i = i + 1 {
    if path[i].to_int() == 0 {
      return false
    }
  }
  let parts = path.split("/")
  for part in parts {
    if part.length() == 0 || part == ".." {
      return false
    }
  }
  true
}

///|
fn app_source_utf8_len(source : String) -> Int {
  @utf8.encode(source).length()
}

///|
pub fn SourceSnapshot::from_manifest(
  manifest_json : String,
  sources : Map[String, String],
  hashes : Map[String, String],
  module_entry? : String = "",
  binary_files? : Map[String, Bool] = Map([]),
) -> Result[SourceSnapshot, AppError] {
  let parsed = match app_parse_json(manifest_json) {
    Some(value) => value
    None => return Err(Manifest("invalid source manifest JSON"))
  }
  let schema = match app_json_number(parsed, "schema") {
    Some(value) => value
    None => return Err(Manifest("missing manifest schema"))
  }
  if schema != 2 {
    return Err(Manifest("unsupported manifest schema"))
  }
  let entry = match app_json_text(parsed, "entry") {
    Some(value) =>
      if app_valid_relative(value) {
        value
      } else {
        return Err(Manifest("invalid entry path"))
      }
    None => return Err(Manifest("missing manifest entry"))
  }
  let app = match app_json_text(parsed, "app") {
    Some(value) => value
    None => "nodeless-app"
  }
  let items = match app_json_field(parsed, "files") {
    Array(values) => values
    _ => return Err(Manifest("missing manifest file list"))
  }
  if items.length() == 0 || items.length() > 4096 {
    return Err(SourceLimit)
  }
  let files : Map[String, SourceFile] = {}
  let mut total = 0
  for item in items {
    let path = match app_json_text(item, "path") {
      Some(value) =>
        if app_valid_relative(value) {
          value
        } else {
          return Err(Manifest("invalid file path"))
        }
      None => return Err(Manifest("file path is not a string"))
    }
    if files.contains(path) {
      return Err(Manifest("duplicate file path"))
    }
    let sha256 = match app_json_text(item, "sha256") {
      Some(value) => value
      None => return Err(Manifest("file hash is not a string"))
    }
    let bytes = match app_json_number(item, "bytes") {
      Some(value) => value
      None => return Err(Manifest("file byte count is not a number"))
    }
    let source = if binary_files.contains(path) {
      if bytes <= 0 || bytes > 16777216 {
        return Err(SourceLimit)
      }
      ""
    } else {
      let value = match sources.get(path) {
        Some(value) => value
        None => return Err(Manifest("source file was not supplied: " + path))
      }
      let encoded = app_source_utf8_len(value)
      if encoded > 16777216 {
        return Err(SourceLimit)
      }
      if encoded != bytes {
        return Err(Manifest("source byte count mismatch: " + path))
      }
      value
    }
    let stored_bytes = if binary_files.contains(path) {
      bytes
    } else {
      app_source_utf8_len(source)
    }
    match hashes.get(path) {
      Some(value) =>
        if value != sha256 {
          return Err(SourceHash(path))
        }
      None => return Err(SourceHash(path))
    }
    total += stored_bytes
    if total > 67108864 {
      return Err(SourceLimit)
    }
    files[path] = { path, source, sha256, bytes: stored_bytes }
  }
  let source_entry = entry
  let module_entry = if module_entry.length() > 0 {
    if !app_valid_relative(module_entry) {
      return Err(Manifest("invalid module entry path"))
    }
    module_entry
  } else {
    source_entry
  }
  match files.get(module_entry) {
    Some(_) => ()
    None => return Err(Manifest("module entry is not listed in the manifest"))
  }
  Ok({ app, entry: module_entry, files })
}

///|
// A bounded literal require scanner. It skips strings, comments and template
// literals so commented `require` calls are not edges. A computed require is
// reported instead of being silently omitted.
pub fn scan_requires(source : String) -> (Array[String], Bool) {
  let out : Array[String] = []
  let length = source.length()
  let mut index = 0
  let mut dynamic = false
  while index < length {
    let code = source[index].to_int()
    if code == 47 && index + 1 < length && source[index + 1].to_int() == 47 {
      index += 2
      while index < length && source[index].to_int() != 10 {
        index += 1
      }
    } else if code == 47 && index + 1 < length && source[index + 1].to_int() == 42 {
      index += 2
      while index + 1 < length &&
        !(source[index].to_int() == 42 && source[index + 1].to_int() == 47) {
        index += 1
      }
      index += 2
    } else if code == 39 || code == 34 || code == 96 {
      let quote = code
      index += 1
      while index < length {
        let inner = source[index].to_int()
        if inner == 92 {
          index += 2
        } else if inner == quote {
          index += 1
          break
        } else {
          index += 1
        }
      }
    } else if code == 114 && index + 7 <= length &&
      source[index:index + 7].to_string() == "require" {
      let before_ok = index == 0 ||
        !(is_identifier_code(source[index - 1].to_int()) ||
          source[index - 1].to_int() == 46)
      let mut cursor = index + 7
      while cursor < length && is_space_code(source[cursor].to_int()) {
        cursor += 1
      }
      if before_ok && cursor < length && source[cursor].to_int() == 40 {
        cursor += 1
        while cursor < length && is_space_code(source[cursor].to_int()) {
          cursor += 1
        }
        if cursor < length &&
          (source[cursor].to_int() == 39 || source[cursor].to_int() == 34) {
          let quote = source[cursor].to_int()
          cursor += 1
          let start = cursor
          let mut escaped = false
          while cursor < length {
            let inner = source[cursor].to_int()
            if inner == 92 {
              escaped = true
              cursor += 2
            } else if inner == quote {
              break
            } else if inner == 10 {
              break
            } else {
              cursor += 1
            }
          }
          if cursor < length && source[cursor].to_int() == quote && !escaped {
            let specifier = source[start:cursor].to_string()
            if specifier.length() > 0 && specifier.length() <= 256 {
              out.push(specifier)
            } else {
              dynamic = true
            }
            index = cursor + 1
          } else {
            dynamic = true
            index = cursor
          }
        } else {
          dynamic = true
          index = cursor
        }
      } else {
        index += 7
      }
    } else {
      index += 1
    }
  }
  (out, dynamic)
}

///|
fn is_identifier_code(code : Int) -> Bool {
  (code >= 48 && code <= 57) ||
  (code >= 65 && code <= 90) ||
  (code >= 97 && code <= 122) ||
  code == 95 ||
  code == 36
}

///|
fn is_space_code(code : Int) -> Bool {
  code == 32 || code == 9 || code == 10 || code == 13
}

///|
fn module_parent(id : String) -> String {
  match id.rev_find("/") {
    Some(index) => id[:index].to_string()
    None => ""
  }
}

///|
fn choose_require_condition(value : Json) -> String? {
  match value {
    String(text) => Some(text)
    Object(fields) => {
      match fields.get("require") {
        Some(String(text)) => return Some(text)
        _ => ()
      }
      match fields.get("node") {
        Some(String(text)) => return Some(text)
        _ => ()
      }
      match fields.get("default") {
        Some(String(text)) => return Some(text)
        _ => ()
      }
      None
    }
    _ => None
  }
}

///|
fn package_directory(path : String) -> String {
  match path.strip_suffix("/package.json") {
    Some(value) => value.to_string()
    None => ""
  }
}

///|
fn package_name_from_directory(directory : String) -> String {
  let parts : Array[String] = []
  for part in directory.split("/") {
    if part.length() > 0 {
      parts.push(part.to_string())
    }
  }
  if parts.length() == 0 {
    return ""
  }
  if parts.length() >= 2 && parts[parts.length() - 2].has_prefix("@") {
    parts[parts.length() - 2] + "/" + parts[parts.length() - 1]
  } else {
    parts[parts.length() - 1]
  }
}

///|
fn register_package(index : @modules.FileIndex, path : String, source : String) -> Result[Unit, AppError] {
  let parsed = match app_parse_json(source) {
    Some(value) => value
    None => return Err(Manifest("invalid package.json: " + path))
  }
  match app_json_text(parsed, "type") {
    Some(kind) =>
      if kind == "module" {
        return Err(Manifest("ESM package is unsupported: " + path))
      } else if kind != "commonjs" {
        return Err(Manifest("unknown package type: " + path))
      }
    None => ()
  }
  let directory = package_directory(path)
  if directory.length() == 0 {
    return Ok(())
  }
  let name = match app_json_text(parsed, "name") {
    Some(value) =>
      if value.length() > 0 && value.length() <= 214 {
        value
      } else {
        package_name_from_directory(directory)
      }
    None => package_name_from_directory(directory)
  }
  if name.length() == 0 {
    return Err(Manifest("package has no usable name: " + path))
  }
  let main = match app_json_text(parsed, "main") {
    Some(value) => value
    None => ""
  }
  match index.add_package(name, directory, main~) {
    Ok(_) => ()
    Err(_) => return Err(Manifest("package metadata rejected: " + path))
  }
  let exports = app_json_field(parsed, "exports")
  let export_map : Map[String, String] = {}
  match exports {
    Null => ()
    String(target) => export_map["."] = target
    Object(fields) => {
      let mut subpaths = false
      for key, _ in fields {
        if key.has_prefix(".") {
          subpaths = true
        }
      }
      if subpaths {
        for key, value in fields {
          if !key.has_prefix(".") {
            return Err(Manifest("mixed exports conditions: " + path))
          }
          match choose_require_condition(value) {
            Some(target) => export_map[key] = target
            None => return Err(Manifest("unsupported exports condition: " + path))
          }
        }
      } else {
        match choose_require_condition(exports) {
          Some(target) => export_map["."] = target
          None => return Err(Manifest("unsupported exports condition: " + path))
        }
      }
    }
    _ => return Err(Manifest("unsupported exports value: " + path))
  }
  if export_map.length() > 0 {
    match index.add_package_exports(directory, export_map) {
      Ok(_) => ()
      Err(_) => return Err(Manifest("package exports rejected: " + path))
    }
  }
  Ok(())
}

///|
pub fn build_graph(snapshot : SourceSnapshot) -> Result[Array[@engine.ModuleSource], AppError] {
  let index = @modules.FileIndex::new()
  for path, file in snapshot.files {
    match index.add_file(path) {
      Ok(_) => ()
      Err(_) => return Err(Manifest("file path rejected: " + path))
    }
    let _ = file
  }
  for path, file in snapshot.files {
    if path.has_suffix("package.json") {
      match register_package(index, path, file.source) {
        Ok(_) => ()
        Err(error) => return Err(error)
      }
    }
  }
  let modules : Array[@engine.ModuleSource] = []
  let queued : Map[String, Bool] = {}
  let queue : Array[String] = [snapshot.entry]
  queued[snapshot.entry] = true
  let mut total = 0
  while queue.length() > 0 {
    let id = match queue.pop() {
      Some(value) => value
      None => continue
    }
    let file = match snapshot.files.get(id) {
      Some(value) => value
      None => return Err(ModuleMissing(id))
    }
    let json = id.has_suffix(".json")
    let deps : Map[String, String] = {}
    if !json {
      let (requires, dynamic) = scan_requires(file.source)
      if dynamic {
        return Err(DynamicRequire(id))
      }
      for specifier in requires {
        if specifier == "electron" || specifier == "electron-updater" {
          // Both are runtime-owned modules for the adapted profile. The
          // updater is an explicit import-only adaptation, never a package
          // fallback; it is recorded in the report/evidence.
          continue
        }
        if @modules.builtin_status(specifier) is Some(_) {
          continue
        }
        let target = match index.resolve(module_parent(id), specifier) {
          Ok(value) => value
          Err(_) => return Err(ModuleResolve(specifier, id))
        }
        deps[specifier] = target
        if !queued.contains(target) {
          queued[target] = true
          queue.push(target)
        }
      }
    }
    total += app_source_utf8_len(file.source)
    if total > 4194304 {
      return Err(SourceLimit)
    }
    modules.push(
      @engine.ModuleSource::new(id, file.sha256, file.source, deps, json),
    )
    if modules.length() > 4096 {
      return Err(SourceLimit)
    }
  }
  Ok(modules)
}

///|
pub fn app_config_json(config : AppConfig) -> String {
  let paths : Map[String, Json] = {
    "userData": Json(config.user_data),
    "appData": Json(config.app_data),
    "resourcesPath": Json(config.resources_path),
  }
  let env : Map[String, Json] = {}
  for key, value in config.env {
    env[key] = Json(value)
  }
  let versions : Map[String, Json] = { "quickjs": Json("2026-06-04") }
  let asset_schemes : Array[Json] = []
  for scheme in config.asset_schemes {
    asset_schemes.push(Json(scheme))
  }
  let app : Map[String, Json] = {
    "name": Json(config.name),
    "version": Json(config.version),
    "appPath": Json(config.app_path),
    "adaptedAdapter": Json(config.adapted_adapter),
    "assetSchemes": Json(asset_schemes),
    "paths": Json(paths),
  }
  let process : Map[String, Json] = {
    "platform": Json(config.platform),
    "arch": Json(config.arch),
    "cwd": Json(config.cwd),
    "resourcesPath": Json(config.resources_path),
    "argv": Json([Json("electron-mbt-nodeless")]),
    "env": Json(env),
    "versions": Json(versions),
  }
  let limits : Map[String, Json] = { "timers": Json(1024) }
  let root : Map[String, Json] = {
    "app": Json(app),
    "process": Json(process),
    "limits": Json(limits),
  }
  Json(root).stringify()
}

///|
pub struct AppRunner {
  engine : @engine.Engine
  context : @engine.Context
  scheduler : @scheduler.Scheduler
  snapshot : SourceSnapshot
  config : AppConfig
  scheduled_js : Map[Int32, Int32]
  scheduled_delay : Map[Int32, Int64]
  scheduled_ref : Map[Int32, Bool]
  mut stopped : Bool
}

///|
pub fn AppRunner::new(snapshot : SourceSnapshot, config : AppConfig) -> AppRunner {
  let engine = @engine.Engine::new()
  let context = @engine.Context::new(engine)
  {
    engine,
    context,
    scheduler: @scheduler.Scheduler::new(1024),
    snapshot,
    config,
    scheduled_js: {},
    scheduled_delay: {},
    scheduled_ref: {},
    stopped: false,
  }
}

///|
fn AppRunner::drain_next_tick(self : AppRunner) -> Result[Unit, AppError] {
  let drain = self.context.get_global("__mbt_drain_next_tick")
  if drain.kind() < 0 {
    drain.release()
    return Err(Engine)
  }
  let value = drain.call()
  let kind = value.kind()
  let text = value.text()
  value.release()
  drain.release()
  if kind != 0 {
    Err(Dispatch(text))
  } else {
    Ok(())
  }
}

///|
fn AppRunner::run_jobs(self : AppRunner, max_steps : Int) -> Result[Int, AppError] {
  match self.drain_next_tick() {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  let mut count = 0
  while count < max_steps {
    let result = self.engine.execute_one_job()
    if result == 0 {
      return Ok(count)
    }
    if result < 0 {
      return Err(Engine)
    }
    count += 1
  }
  // A budget is a yield point, not a failure: a long promise chain may have
  // more microtasks than one slice. The caller will run another slice.
  Ok(count)
}

///|
fn app_parse_inner_string(raw : String) -> String {
  match app_parse_json(raw) {
    Some(String(text)) => text
    _ => raw
  }
}

///|
fn AppRunner::sync_timers(self : AppRunner) -> Result[Unit, AppError] {
  let sync = self.context.get_global("__mbt_sync_timers")
  if sync.kind() < 0 {
    sync.release()
    return Err(Engine)
  }
  let value = sync.call()
  let kind = value.kind()
  let raw = value.text()
  value.release()
  sync.release()
  if kind != 0 {
    return Err(Engine)
  }
  let inner = app_parse_inner_string(raw)
  let parsed = match app_parse_json(inner) {
    Some(value) => value
    None => return Err(Engine)
  }
  let items = match parsed {
    Array(values) => values
    _ => return Err(Engine)
  }
  let seen : Map[Int32, Bool] = {}
  for item in items {
    let id = match app_json_number(item, "id") {
      Some(value) => value
      None => continue
    }
    let delay = match app_json_number(item, "delay") {
      Some(value) => value.to_int64()
      None => 0L
    }
    let ref = match app_json_bool(item, "ref") {
      Some(value) => value
      None => true
    }
    seen[id] = true
    match self.scheduled_js.get(id) {
      Some(existing) => {
        let old_delay = self.scheduled_delay.get(id).unwrap_or(-1L)
        let old_ref = self.scheduled_ref.get(id).unwrap_or(true)
        if old_delay != delay || old_ref != ref {
          let _ = self.scheduler.clear_timeout(existing)
          match self.scheduler.set_timeout(delay, id, unref=!ref) {
            Ok(scheduler_id) => {
              self.scheduled_js[id] = scheduler_id
              self.scheduled_delay[id] = delay
              self.scheduled_ref[id] = ref
            }
            Err(_) => return Err(SourceLimit)
          }
        }
      }
      None =>
        match self.scheduler.set_timeout(delay, id, unref=!ref) {
          Ok(scheduler_id) => {
            self.scheduled_js[id] = scheduler_id
            self.scheduled_delay[id] = delay
            self.scheduled_ref[id] = ref
          }
          Err(_) => return Err(SourceLimit)
        }
    }
  }
  let remove : Array[Int32] = []
  for id, scheduler_id in self.scheduled_js {
    if !seen.contains(id) {
      let _ = self.scheduler.clear_timeout(scheduler_id)
      remove.push(id)
    }
  }
  for id in remove {
    let _ = self.scheduled_js.remove(id)
    let _ = self.scheduled_delay.remove(id)
    let _ = self.scheduled_ref.remove(id)
  }
  Ok(())
}

///|
fn AppRunner::fire_timer(self : AppRunner, id : Int32) -> Result[Unit, AppError] {
  let fire = self.context.get_global("__mbt_fire_timer")
  if fire.kind() < 0 {
    fire.release()
    return Err(Engine)
  }
  let argument = self.context.new_string(id.to_string())
  let result = fire.call1(argument)
  let kind = result.kind()
  let text = result.text()
  result.release()
  argument.release()
  fire.release()
  if kind != 0 {
    Err(Dispatch(text))
  } else {
    Ok(())
  }
}

///|
fn AppRunner::run_timers(self : AppRunner, now : Int64, limit : Int32) -> Result[Int, AppError] {
  match self.scheduler.advance_to(now) {
    Ok(_) => ()
    Err(_) => return Err(Engine)
  }
  let due = match self.scheduler.take_due(now, limit) {
    Ok(value) => value
    Err(_) => return Err(Engine)
  }
  if due.length() > 0 {
  }
  let mut fired = 0
  for id in due {
    let _ = self.scheduled_js.remove(id)
    let _ = self.scheduled_delay.remove(id)
    let _ = self.scheduled_ref.remove(id)
    match self.fire_timer(id) {
      Ok(_) => ()
      Err(error) => return Err(error)
    }
    match self.run_jobs(4096) {
      Ok(_) => ()
      Err(error) => return Err(error)
    }
    fired += 1
  }
  Ok(fired)
}

///|
/// Pumps detached app work that is not attached to a pending main request.
/// Electron apps routinely start a fire-and-forget async task and return a
/// synchronous IPC response; the task must still get its promise/timer turns.
pub fn AppRunner::pump_idle(self : AppRunner) -> Unit {
  let now = @engine.Engine::now_ms()
  let _ = self.sync_timers()
  let _ = self.run_timers(now, 64)
  // A single IPC turn can settle a long promise chain (for example a
  // chunked PNG export that performs dozens of synchronous host reads and
  // writes). 256 jobs was too small and surfaced as a false engine failure.
  // Re-arm a few times so a deferred chain is not stranded without an event.
  for _slice = 0; _slice < 16; _slice = _slice + 1 {
    let _ = self.run_jobs(4096)
    if !self.engine.job_pending() {
      break
    }
  }
}

///|
pub fn AppRunner::load(self : AppRunner) -> Result[Unit, AppError] {
  let _ = self.scheduler.advance_to(@engine.Engine::now_ms())
  let modules = match build_graph(self.snapshot) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let result = self.context.eval_cjs_with_prelude(
    modules,
    self.snapshot.entry,
    @engine.node_prelude(),
    app_config_json(self.config),
  )
  if result.status is @engine.Exception {
    return Err(MainEval(result.exports))
  }
  let ready = self.context.get_global("__mbt_app_ready")
  if ready.kind() < 0 {
    ready.release()
    return Err(Engine)
  }
  let ready_result = ready.call()
  let ready_kind = ready_result.kind()
  let ready_text = ready_result.text()
  ready_result.release()
  ready.release()
  if ready_kind != 0 || !ready_text.contains("ok") {
    return Err(MainEval(ready_text))
  }
  match self.run_jobs(4096) {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  match self.sync_timers() {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  match self.run_timers(@engine.Engine::now_ms(), 64) {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  Ok(())
}

///|
pub fn AppRunner::dispatch(
  self : AppRunner,
  operation : String,
  payload_json : String,
) -> Result[String, AppError] {
  if self.stopped {
    return Err(Stopped)
  }
  let mut now = @engine.Engine::now_ms()
  let current = self.scheduler.now()
  if now < current {
    now = current
  }
  let _ = self.scheduler.advance_to(now)
  let dispatch = self.context.get_global("__mbt_dispatch")
  if dispatch.kind() < 0 {
    dispatch.release()
    return Err(Engine)
  }
  let operation_value = self.context.new_string(operation)
  let payload_value = self.context.new_string(payload_json)
  let value = dispatch.call2(operation_value, payload_value)
  let raw = value.text_limit(1048576)
  value.release()
  operation_value.release()
  payload_value.release()
  dispatch.release()
  if raw == "ELECTRON_MBT_OUTPUT_LIMIT" {
    return Err(Dispatch(raw))
  }
  let inner = app_parse_inner_string(raw)
  let parsed = match app_parse_json(inner) {
    Some(value) => value
    None => return Err(Dispatch(inner))
  }
  match app_json_text(parsed, "pending") {
    Some(id) => {
      let take = self.context.get_global("__mbt_take_pending")
      if take.kind() < 0 {
        take.release()
        return Err(Engine)
      }
      for _step = 0; _step < 1000; _step = _step + 1 {
        now += 1
        match self.sync_timers() {
          Ok(_) => ()
          Err(error) => {
            take.release()
            return Err(error)
          }
        }
        match self.run_timers(now, 64) {
          Ok(_) => ()
          Err(error) => {
            take.release()
            return Err(error)
          }
        }
        match self.run_jobs(4096) {
          Ok(_) => ()
          Err(error) => {
            take.release()
            return Err(error)
          }
        }
        let id_value = self.context.new_string(id)
        let pending = take.call1(id_value)
        let pending_kind = pending.kind()
        let pending_raw = pending.text_limit(1048576)
        pending.release()
        id_value.release()
        if pending_kind != 0 || pending_raw == "ELECTRON_MBT_OUTPUT_LIMIT" {
          take.release()
          return Err(Dispatch(pending_raw))
        }
        let pending_inner = app_parse_inner_string(pending_raw)
        if pending_inner != "null" && pending_inner.length() > 0 {
          take.release()
          return Ok(pending_inner)
        }
      }
      take.release()
      Err(Timeout)
    }
    None => {
      Ok(inner)
    }
  }
}

///|
pub fn AppRunner::stop(self : AppRunner) -> Unit {
  if self.stopped {
    return
  }
  self.stopped = true
  self.context.destroy()
  self.engine.destroy()
}

///|
pub fn AppRunner::install_host_bridge(self : AppRunner) -> Bool {
  self.context.install_host_bridge()
}

///|
pub fn AppRunner::global_text(self : AppRunner, name : String) -> String {
  let value = self.context.get_global(name)
  let kind = value.kind()
  let text = value.text_limit(65536)
  value.release()
  if kind < 0 || text == "undefined" {
    ""
  } else {
    text
  }
}

///|
pub fn AppRunner::last_rejection(self : AppRunner) -> String {
  self.context.last_rejection()
}

///|
pub fn AppRunner::live_leases(self : AppRunner) -> Int {
  self.context.live_count()
}

///|
pub fn AppRunner::config(self : AppRunner) -> AppConfig {
  self.config
}

///|
pub fn AppRunner::snapshot(self : AppRunner) -> SourceSnapshot {
  self.snapshot
}
