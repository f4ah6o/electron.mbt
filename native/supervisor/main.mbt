#borrow(binary, root, session)
extern "C" fn supervisor_start(binary : Bytes, root : Bytes, session : Bytes) -> Int = "moonbit_ebt_supervisor_start"

///|
#borrow(frame)
extern "C" fn supervisor_write(fd : Int, frame : Bytes, length : Int) -> Int = "moonbit_ebt_supervisor_write_frame"

///|
#borrow(buffer)
extern "C" fn supervisor_read(fd : Int, buffer : Bytes, capacity : Int) -> Int = "moonbit_ebt_supervisor_read_frame"

///|
extern "C" fn supervisor_pid() -> Int = "moonbit_ebt_supervisor_pid"

///|
extern "C" fn supervisor_timeout_ms() -> Int = "moonbit_ebt_supervisor_timeout_ms"

///|
extern "C" fn supervisor_sleep_ms(milliseconds : Int) = "moonbit_ebt_supervisor_sleep_ms"

///|
#borrow(root)
extern "C" fn supervisor_app_main(root : Bytes) -> Int = "moonbit_ebt_supervisor_app_main"

///|
extern "C" fn supervisor_boot_mode() -> Int = "moonbit_ebt_supervisor_boot_mode"

///|
extern "C" fn supervisor_moji_app_mode() -> Int = "moonbit_ebt_supervisor_moji_app_mode"

///|
#borrow(buffer)
extern "C" fn supervisor_boot_root(buffer : Bytes, capacity : Int) -> Int = "moonbit_ebt_supervisor_boot_root"

///|
#borrow(buffer)
extern "C" fn supervisor_moji_page(buffer : Bytes, capacity : Int) -> Int = "moonbit_ebt_supervisor_moji_page"

///|
#borrow(buffer)
extern "C" fn supervisor_moji_url(buffer : Bytes, capacity : Int) -> Int = "moonbit_ebt_supervisor_moji_url"

///|
#borrow(buffer)
extern "C" fn supervisor_boot_report(buffer : Bytes, capacity : Int) -> Int = "moonbit_ebt_supervisor_boot_report"

///|
#borrow(buffer)
extern "C" fn supervisor_app_title(buffer : Bytes, capacity : Int) -> Int = "moonbit_ebt_supervisor_app_title"

///|
#borrow(buffer)
extern "C" fn supervisor_app_entry(buffer : Bytes, capacity : Int) -> Int = "moonbit_ebt_supervisor_app_entry"

///|
extern "C" fn supervisor_load_fd() -> Int = "moonbit_ebt_supervisor_load_fd"

///|
extern "C" fn supervisor_event_fd() -> Int = "moonbit_ebt_supervisor_event_fd"

///|
#borrow(buffer)
extern "C" fn supervisor_read_timeout(fd : Int, buffer : Bytes, capacity : Int, timeout_ms : Int) -> Int = "moonbit_ebt_supervisor_read_frame_timeout"

///|
#borrow(buffer, name)
extern "C" fn supervisor_file(buffer : Bytes, capacity : Int, name : Bytes) -> Int = "moonbit_ebt_supervisor_file"

///|
#borrow(buffer)
extern "C" fn supervisor_session(buffer : Bytes) -> Int = "moonbit_ebt_supervisor_session"

///|
#borrow(operation, payload, out)
extern "C" fn supervisor_app_dispatch(operation : Bytes, payload : Bytes, out : Bytes, capacity : Int) -> Int = "moonbit_ebt_supervisor_app_dispatch"

///|
extern "C" fn supervisor_finish() -> Int = "moonbit_ebt_supervisor_finish"

///|
extern "C" fn supervisor_kill() = "moonbit_ebt_supervisor_kill"

///|
extern "C" fn supervisor_exit(code : Int) = "moonbit_ebt_supervisor_exit"

///|
fn request_frame(
  session : String,
  request : Int,
  window : Int,
  generation : Int,
  operation : String,
  payload : String,
) -> String {
  "{\"version\":1,\"session\":\"" + session + "\",\"request\":" + request.to_string() +
  ",\"window\":" + window.to_string() + ",\"generation\":" + generation.to_string() +
  ",\"operation\":\"" + operation + "\",\"payload\":" + payload + "}"
}

///|
fn json_path(value : String) -> String {
  value.replace_all(old="\\", new="\\\\").replace_all(old="\"", new="\\\"")
}

///|
fn json_line(value : String) -> String {
  value.replace_all(old="\r", new=" ")
    .replace_all(old="\n", new=" ")
    .replace_all(old="\t", new=" ")
}

///|
fn json_payload_number(raw : String, field : String) -> Int? {
  let parsed = @json.parse(raw) catch {
    _ => return None
  }
  match parsed {
    Object(fields) => match fields.get("payload") {
      Some(Object(payload)) => match payload.get(field) {
        Some(Number(value, ..)) => Some(value.to_int())
        _ => None
      }
      _ => None
    }
    _ => None
  }
}

///|
fn json_payload_bool(raw : String, field : String) -> Bool? {
  let parsed = @json.parse(raw) catch {
    _ => return None
  }
  match parsed {
    Object(fields) => match fields.get("payload") {
      Some(Object(payload)) => match payload.get(field) {
        Some(True) => Some(true)
        Some(False) => Some(false)
        _ => None
      }
      _ => None
    }
    _ => None
  }
}

///|
fn json_payload_field(raw : String, field : String) -> String? {
  let parsed = @json.parse(raw) catch {
    _ => return None
  }
  match parsed {
    Object(fields) => match fields.get("payload") {
      Some(Object(payload)) => match payload.get(field) {
        Some(String(value)) => Some(value)
        _ => None
      }
      _ => None
    }
    _ => None
  }
}

///|
fn send(fd : Int, frame : String) -> Bool {
  let bytes = @utf8.encode(frame)
  supervisor_write(fd, bytes, bytes.length()) == 0
}

///|
fn receive_timeout(fd : Int, buffer : Bytes, timeout_ms : Int) -> String? {
  let length = supervisor_read_timeout(fd, buffer, buffer.length(), timeout_ms)
  if length <= 0 {
    None
  } else {
    try {
      Some(@utf8.decode(buffer[:length]))
    } catch {
      _ => None
    }
  }
}

///|
fn receive(fd : Int, buffer : Bytes) -> String? {
  receive_timeout(fd, buffer, supervisor_timeout_ms())
}

///|
fn dispatch_app(operation : String, payload : String) -> String {
  let out = Bytes::new(65536)
  let length = supervisor_app_dispatch(@utf8.encode(operation), @utf8.encode(payload),
    out, out.length())
  if length <= 0 {
    "{\"ok\":false,\"code\":\"ELECTRON_MBT_MAIN_UNAVAILABLE\"}"
  } else {
    @utf8.decode_lossy(out[:length])
  }
}

///|
fn pump_app_requests(
  fd : Int,
  event_fd : Int,
  control_buffer : Bytes,
  event_buffer : Bytes,
  session : String,
  window : Int,
  generation : Int,
) -> Bool {
  let mut handled = false
  for _attempt = 0; _attempt < 8; _attempt = _attempt + 1 {
    let length = supervisor_read_timeout(event_fd, event_buffer, event_buffer.length(), 20)
    if length <= 0 {
      break
    }
    let text = try {
      @utf8.decode(event_buffer[:length])
    } catch {
      _ => continue
    }
    let parsed = @json.parse(text) catch {
      _ => continue
    }
    let fields = match parsed {
      Object(values) => values
      _ => continue
    }
    if !(fields.get("operation") is Some(String("app-request"))) {
      continue
    }
    let payload = match fields.get("payload") {
      Some(Object(values)) => values
      _ => continue
    }
    let request = match payload.get("request") {
      Some(String(value)) => value
      _ => continue
    }
    let operation = match payload.get("operation") {
      Some(String(value)) => value
      _ => continue
    }
    let args = match payload.get("payload") {
      Some(value) => value.stringify()
      None => "null"
    }
    let result = dispatch_app(operation, args)
    let reply = request_frame(session, 900, window, generation, "app-reply",
      "{\"request\":\"" + json_path(request) + "\",\"json\":\"" + json_path(result) + "\"}")
    let sent = send(fd, reply)
    let reply_result = if sent { receive(fd, control_buffer) } else { None }
    if !sent || reply_result is None || !reply_result.unwrap().contains("\"delivered\":true") {
      return false
    }
    handled = true
  }
  handled
}

fn start_ready(root : String, buffer : Bytes) -> (Int, String, Int)? {
  for attempt = 1; attempt <= 3; attempt = attempt + 1 {
    let session_buffer = Bytes::new(32)
    if supervisor_session(session_buffer) != 32 {
      return None
    }
    let session = @utf8.decode_lossy(session_buffer)
    let fd = supervisor_start(
      @utf8.encode("dist/electron-mbt-native-host"),
      @utf8.encode(root),
      @utf8.encode(session),
    )
    if fd >= 0 {
      let hello = request_frame(session, 1, 0, 0, "hello", "{}")
      let hello_sent = send(fd, hello)
      let hello_reply = if hello_sent { receive(fd, buffer) } else { None }
      if hello_sent && hello_reply is Some(_) &&
        hello_reply.unwrap().contains("\"terminal\":\"success\"") &&
        hello_reply.unwrap().contains("AppKit+WKWebView") {
        let ready = request_frame(session, 2, 0, 0, "ready", "{}")
        let ready_sent = send(fd, ready)
        let ready_reply = if ready_sent { receive(fd, buffer) } else { None }
        if ready_sent && ready_reply is Some(_) &&
          ready_reply.unwrap().contains("\"terminal\":\"success\"") {
          return Some((fd, session, attempt))
        }
      }
      supervisor_kill()
    }
    supervisor_sleep_ms(100)
  }
  None
}

///|
fn fail_moji_app(code : String) -> Unit {
  supervisor_kill()
  println("{\"status\":\"FAIL\",\"code\":\"" + code + "\",\"compatible\":false}")
  supervisor_exit(1)
}

///|
fn run_moji_app() -> Unit {
  let buffer = Bytes::new(65536)
  let event_buffer = Bytes::new(65536)
  let root_buffer = Bytes::new(4096)
  let root_length = supervisor_boot_root(root_buffer, root_buffer.length())
  if root_length <= 0 {
    fail_moji_app("ELECTRON_MBT_MOJI_APP_ROOT")
  }
  let root = @utf8.decode_lossy(root_buffer[:root_length])
  let page_buffer = Bytes::new(512)
  let page_length = supervisor_moji_page(page_buffer, page_buffer.length())
  if page_length <= 0 {
    fail_moji_app("ELECTRON_MBT_MOJI_APP_PAGE")
  }
  let page = @utf8.decode_lossy(page_buffer[:page_length])
  let (fd, session, attempts) = match start_ready(root, buffer) {
    Some(value) => value
    None => {
      fail_moji_app("ELECTRON_MBT_MOJI_APP_START")
      (0, "", 0)
    }
  }
  let create = request_frame(session, 4, 1, 0, "create-window",
    "{\"width\":800,\"height\":600,\"title\":\"Moji\",\"show\":false}")
  let create_sent = send(fd, create)
  let create_reply = if create_sent { receive(fd, buffer) } else { None }
  if !create_sent || create_reply is None ||
    !create_reply.unwrap().contains("\"webViewAttached\":true") {
    fail_moji_app("ELECTRON_MBT_MOJI_APP_WINDOW")
  }
  let prepare = request_frame(session, 31, 1, 0, "prepare-source",
    "{\"file\":\"" + json_path(page) + "\"}")
  let prepare_sent = send(fd, prepare)
  let prepare_reply = if prepare_sent { receive(fd, buffer) } else { None }
  if !prepare_sent || prepare_reply is None ||
    !prepare_reply.unwrap().contains("\"prepared\":true") {
    fail_moji_app("ELECTRON_MBT_MOJI_APP_PREPARE")
  }
  let snapshot_root = match json_payload_field(prepare_reply.unwrap(), "root") {
    Some(value) => value
    None => {
      fail_moji_app("ELECTRON_MBT_MOJI_APP_PREPARE_ROOT")
      ""
    }
  }
  if supervisor_app_main(@utf8.encode(snapshot_root)) != 43 {
    fail_moji_app("ELECTRON_MBT_MOJI_APP_MAIN")
  }
  let adapter_path = Bytes::new(4096)
  let adapter_length = supervisor_file(adapter_path, adapter_path.length(),
    @utf8.encode("adapted/page-api.js"))
  if adapter_length <= 0 {
    fail_moji_app("ELECTRON_MBT_MOJI_APP_ADAPTER_PATH")
  }
  let install = request_frame(session, 6, 1, 0, "install-adapted-adapter",
    "{\"file\":\"" + json_path(@utf8.decode_lossy(adapter_path[:adapter_length])) + "\"}")
  let install_sent = send(fd, install)
  let install_reply = if install_sent { receive(fd, buffer) } else { None }
  if !install_sent || install_reply is None || !install_reply.unwrap().contains("\"installed\":true") {
    fail_moji_app("ELECTRON_MBT_MOJI_APP_ADAPTER")
  }
  let begin = request_frame(session, 7, 1, 1, "begin-load", "{}")
  let begin_sent = send(fd, begin)
  let begin_reply = if begin_sent { receive(fd, buffer) } else { None }
  if !begin_sent || begin_reply is None || !begin_reply.unwrap().contains("\"terminal\":\"success\"") {
    fail_moji_app("ELECTRON_MBT_MOJI_APP_BEGIN")
  }
  let url_buffer = Bytes::new(2048)
  let url_length = supervisor_moji_url(url_buffer, url_buffer.length())
  let mut load_ok = false
  if url_length > 0 {
    let url = @utf8.decode_lossy(url_buffer[:url_length])
    let load = request_frame(session, 8, 1, 1, "load-url",
      "{\"url\":\"" + json_path(url) + "\"}")
    let load_sent = send(fd, load)
    let load_reply = if load_sent { receive(fd, buffer) } else { None }
    if load_sent && load_reply is Some(_) &&
      load_reply.unwrap().contains("\"didFinishLoad\":true") {
      load_ok = true
    }
  } else {
    let file_path = Bytes::new(4096)
    let path_length = supervisor_file(file_path, file_path.length(), @utf8.encode(page))
    if path_length > 0 {
      let load = request_frame(session, 8, 1, 1, "load-file",
        "{\"file\":\"" + json_path(@utf8.decode_lossy(file_path[:path_length])) + "\"}")
      let load_fd = supervisor_load_fd()
      let load_sent = send(load_fd, load)
      let load_reply = if load_sent { receive(load_fd, buffer) } else { None }
      if load_sent && load_reply is Some(_) &&
        load_reply.unwrap().contains("\"didFinishLoad\":true") {
        load_ok = true
      }
    }
  }
  if !load_ok {
    fail_moji_app("ELECTRON_MBT_MOJI_APP_LOAD")
  }
  let release = request_frame(session, 34, 1, 1, "release-adapted-ingress", "{}")
  let release_sent = send(fd, release)
  let release_reply = if release_sent { receive(fd, buffer) } else { None }
  if !release_sent || release_reply is None || !release_reply.unwrap().contains("\"released\":true") {
    fail_moji_app("ELECTRON_MBT_MOJI_APP_RELEASE")
  }
  let event_fd = supervisor_event_fd()
  let mut ready = false
  let mut api_present = false
  let mut root_children = 0
  let mut page_title = ""
  let mut page_text = ""
  for _attempt = 0; _attempt < 300; _attempt = _attempt + 1 {
    let _ = pump_app_requests(fd, event_fd, buffer, event_buffer, session, 1, 1)
    let probe = request_frame(session, 37, 1, 1, "probe-renderer", "{}")
    let probe_sent = send(fd, probe)
    let probe_reply = if probe_sent { receive(fd, buffer) } else { None }
    if probe_reply is Some(_) {
      let probe_text = probe_reply.unwrap()
      if json_payload_bool(probe_text, "api") == Some(true) {
        api_present = true
      }
      let children = json_payload_number(probe_text, "rootChildren").unwrap_or(0)
      if children > root_children {
        root_children = children
      }
      if json_payload_field(probe_text, "title") is Some(value) {
        page_title = value
      }
      if json_payload_field(probe_text, "text") is Some(value) {
        page_text = value
      }
      if page_title.contains("moji-adapted-ready") {
        ready = true
        break
      }
      if page_title.contains("moji-adapted-failed") || page_title.contains("moji-adapted-bad") {
        break
      }
      if api_present && root_children > 0 {
        ready = true
        break
      }
    }
    supervisor_sleep_ms(20)
  }
  let simple_ok = page_title.contains("moji-adapted-ready:dark:unsupported")
  let renderer_ok = api_present && root_children > 0
  let page_ok = ready && (simple_ok || renderer_ok)
  if !page_ok {
    let fail_report = ("{\"status\":\"FAIL\",\"probe\":\"moji-adapted-native\"," +
      "\"pageLoaded\":true,\"apiPresent\":" + (if api_present { "true" } else { "false" }) +
      ",\"pageTitle\":\"" + json_path(page_title) + "\"," +
      "\"pageText\":\"" + json_path(json_line(page_text)) + "\"," +
      "\"rootChildren\":" + root_children.to_string() +
      ",\"rendererLoaded\":" + (if renderer_ok { "true" } else { "false" }) +
      ",\"simpleProbe\":" + (if simple_ok { "true" } else { "false" }) +
      ",\"attempts\":" + attempts.to_string() + ",\"compatible\":false}")
    println(fail_report)
    supervisor_kill()
    supervisor_exit(1)
  }
  let report = ("{\"status\":\"PASS\",\"probe\":\"moji-adapted-native\"," +
    "\"backend\":\"AppKit+WKWebView\",\"pageLoaded\":true,\"apiPresent\":" +
    (if api_present { "true" } else { "false" }) +
    ",\"settingsTheme\":\"dark\",\"updateStatus\":\"unsupported\"," +
    "\"mainHandlers\":true,\"pageTitle\":\"" + json_path(page_title) + "\"," +
    "\"pageText\":\"" + json_path(json_line(page_text)) + "\"," +
    "\"rootChildren\":" + root_children.to_string() +
    ",\"rendererLoaded\":" + (if renderer_ok { "true" } else { "false" }) +
    ",\"simpleProbe\":" + (if simple_ok { "true" } else { "false" }) +
    ",\"attempts\":" + attempts.to_string() + ",\"compatible\":false}")
  println(report)
  supervisor_kill()
  supervisor_exit(0)
  return
}

///|
fn main {
  if supervisor_moji_app_mode() == 1 {
    run_moji_app()
    return
  }
  if supervisor_boot_mode() == 1 {
    let boot_root_buffer = Bytes::new(4096)
    let boot_root_length = supervisor_boot_root(boot_root_buffer, boot_root_buffer.length())
    if boot_root_length <= 0 {
      println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_MOJI_BOOT_ROOT\",\"compatible\":false}")
      supervisor_exit(1)
    }
    let boot_root = @utf8.decode_lossy(boot_root_buffer[:boot_root_length])
    if supervisor_app_main(@utf8.encode(boot_root)) != 43 {
      println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_MOJI_BOOT_MAIN\",\"compatible\":false}")
      supervisor_exit(1)
    }
    let boot_report_buffer = Bytes::new(65536)
    let boot_report_length = supervisor_boot_report(boot_report_buffer, boot_report_buffer.length())
    if boot_report_length <= 0 {
      println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_MOJI_BOOT_REPORT\",\"compatible\":false}")
      supervisor_exit(1)
    }
    println(@utf8.decode_lossy(boot_report_buffer[:boot_report_length]))
    supervisor_exit(0)
    return
  }
  let buffer = Bytes::new(65536)
  let event_buffer = Bytes::new(65536)
  let (fd, session, attempts) = match start_ready("fixtures/native-app", buffer) {
    Some(value) => value
    None => {
      println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_START\",\"compatible\":false}")
      supervisor_exit(1)
      (0, "", 0)
    }
  }
  let create = request_frame(session, 4, 1, 0, "create-window",
    "{\"width\":640,\"height\":480,\"title\":\"electron.mbt source snapshot\",\"show\":false}")
  let create_sent = send(fd, create)
  let create_reply = if create_sent { receive(fd, buffer) } else { None }
  if !create_sent || create_reply is None || !create_reply.unwrap().contains("\"terminal\":\"success\"") ||
    !create_reply.unwrap().contains("\"webViewAttached\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_WINDOW\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let prepare = request_frame(session, 31, 1, 0, "prepare-source", "{\"file\":\"index.html\"}")
  let prepare_sent = send(fd, prepare)
  let prepare_reply = if prepare_sent { receive(fd, buffer) } else { None }
  if !prepare_sent || prepare_reply is None ||
    !prepare_reply.unwrap().contains("\"prepared\":true") ||
    !prepare_reply.unwrap().contains("\"sha256\":\"") ||
    !prepare_reply.unwrap().contains("\"manifestSHA256\":\"") ||
    !prepare_reply.unwrap().contains("\"files\":11") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_PREPARE_SOURCE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let snapshot_root = match json_payload_field(prepare_reply.unwrap(), "root") {
    Some(value) => value
    None => {
      supervisor_kill()
      println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_PREPARE_ROOT\",\"compatible\":false}")
      supervisor_exit(1)
      ""
    }
  }
  if supervisor_app_main(@utf8.encode(snapshot_root)) != 42 {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_APP_MAIN\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let entry_buffer = Bytes::new(256)
  let entry_length = supervisor_app_entry(entry_buffer, entry_buffer.length())
  if entry_length <= 0 {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_APP_ENTRY\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let app_entry = @utf8.decode_lossy(entry_buffer[:entry_length])
  let title_buffer = Bytes::new(256)
  let title_length = supervisor_app_title(title_buffer, title_buffer.length())
  if title_length <= 0 {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_APP_TITLE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let app_title = @utf8.decode_lossy(title_buffer[:title_length])
  let set_title = request_frame(session, 51, 1, 0, "set-window-title",
    "{\"title\":\"" + json_path(app_title) + "\"}")
  let set_title_sent = send(fd, set_title)
  let set_title_reply = if set_title_sent { receive(fd, buffer) } else { None }
  if !set_title_sent || set_title_reply is None ||
    !set_title_reply.unwrap().contains("\"title\":\"" + json_path(app_title) + "\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_APP_TITLE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let title_request = request_frame(session, 5, 1, 0, "get-window-title", "{}")
  let title_sent = send(fd, title_request)
  let title_reply = if title_sent { receive(fd, buffer) } else { None }
  if !title_sent || title_reply is None || !title_reply.unwrap().contains("\"title\":\"" + json_path(app_title) + "\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_APP_TITLE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let adapter_path = Bytes::new(4096)
  let adapter_length = supervisor_file(adapter_path, adapter_path.length(), @utf8.encode("adapted/page-api.js"))
  if adapter_length <= 0 {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_ADAPTER_PATH\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let install_adapter = request_frame(session, 6, 1, 0, "install-adapted-adapter",
    "{\"file\":\"" + json_path(@utf8.decode_lossy(adapter_path[:adapter_length])) + "\"}")
  let adapter_sent = send(fd, install_adapter)
  let adapter_reply = if adapter_sent { receive(fd, buffer) } else { None }
  if !adapter_sent || adapter_reply is None || !adapter_reply.unwrap().contains("\"installed\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_ADAPTER\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let begin = request_frame(session, 7, 1, 1, "begin-load", "{}")
  let begin_sent = send(fd, begin)
  let begin_reply = if begin_sent { receive(fd, buffer) } else { None }
  if !begin_sent || begin_reply is None || !begin_reply.unwrap().contains("\"terminal\":\"success\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_BEGIN_LOAD\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let file_path = Bytes::new(4096)
  let path_length = supervisor_file(file_path, file_path.length(), @utf8.encode("index.html"))
  if path_length <= 0 {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_PATH\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let load = request_frame(session, 8, 1, 1, "load-file",
    "{\"file\":\"" + json_path(@utf8.decode_lossy(file_path[:path_length])) + "\"}")
  let load_fd = supervisor_load_fd()
  let load_sent = send(load_fd, load)
  let load_reply = if load_sent { receive(load_fd, buffer) } else { None }
  if !load_sent || load_reply is None || !load_reply.unwrap().contains("\"didFinishLoad\":true") ||
    !load_reply.unwrap().contains("index.html") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_LOAD\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let event_fd = supervisor_event_fd()
  let event_length = supervisor_read_timeout(event_fd, buffer, buffer.length(), 2000)
  let event_reply = if event_length > 0 {
    try { Some(@utf8.decode(buffer[:event_length])) } catch { _ => None }
  } else {
    None
  }
  if event_reply is None || !event_reply.unwrap().contains("\"operation\":\"isolated-preload-attested\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_EVENT\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let mut queue_pending_ok = false
  for _attempt = 0; _attempt < 100; _attempt = _attempt + 1 {
    let pending_request = request_frame(session, 9, 1, 1, "get-web-contents-title", "{}")
    let pending_sent = send(fd, pending_request)
    let pending_reply = if pending_sent { receive(fd, buffer) } else { None }
    if pending_sent && pending_reply is Some(_) &&
      pending_reply.unwrap().contains("\"title\":\"adapted-queue-pending\"") {
      queue_pending_ok = true
      break
    }
    supervisor_sleep_ms(20)
  }
  if !queue_pending_ok {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_QUEUE_PENDING\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let release = request_frame(session, 41, 1, 1, "release-adapted-ingress", "{}")
  let release_sent = send(fd, release)
  let release_reply = if release_sent { receive(fd, buffer) } else { None }
  if !release_sent || release_reply is None ||
    !release_reply.unwrap().contains("\"released\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_QUEUE_RELEASE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let mut page_title_ok = false
  for _attempt = 0; _attempt < 100; _attempt = _attempt + 1 {
    let _ = pump_app_requests(fd, event_fd, buffer, event_buffer, session, 1, 1)
    let page_title_request = request_frame(session, 42, 1, 1, "get-web-contents-title", "{}")
    let page_title_sent = send(fd, page_title_request)
    let page_title_reply = if page_title_sent { receive(fd, buffer) } else { None }
    if page_title_sent && page_title_reply is Some(_) &&
      page_title_reply.unwrap().contains("\"title\":\"nodeless-app-ready\"") {
      page_title_ok = true
      break
    }
    supervisor_sleep_ms(20)
  }
  if !page_title_ok {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_PAGE_API\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let queue_status = request_frame(session, 43, 1, 1, "get-ingress-status", "{}")
  let queue_status_sent = send(fd, queue_status)
  let queue_status_reply = if queue_status_sent { receive(fd, buffer) } else { None }
  if !queue_status_sent || queue_status_reply is None ||
    !queue_status_reply.unwrap().contains("\"admitted\":4") ||
    !queue_status_reply.unwrap().contains("\"generation\":1") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_QUEUE_STATUS\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let unknown_event = request_frame(session, 13, 1, 1, "dispatch-adapted-event",
    "{\"topic\":\"unknown\",\"value\":\"x\"}")
  let unknown_event_sent = send(fd, unknown_event)
  let unknown_event_reply = if unknown_event_sent { receive(fd, buffer) } else { None }
  if !unknown_event_sent || unknown_event_reply is None ||
    !unknown_event_reply.unwrap().contains("\"terminal\":\"failure\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_ADAPTED_EVENT_TOPIC\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let stale_before = request_frame(session, 14, 1, 0, "dispatch-adapted-event",
    "{\"topic\":\"doc:open\",\"value\":\"stale\"}")
  let stale_before_sent = send(fd, stale_before)
  let stale_before_reply = if stale_before_sent { receive(fd, buffer) } else { None }
  if !stale_before_sent || stale_before_reply is None ||
    !stale_before_reply.unwrap().contains("\"terminal\":\"failure\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_ADAPTED_EVENT_STALE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let event = request_frame(session, 15, 1, 1, "dispatch-adapted-event",
    "{\"topic\":\"doc:open\",\"value\":\"native-delivery\"}")
  let event_sent = send(fd, event)
  let event_reply = if event_sent { receive(fd, buffer) } else { None }
  if !event_sent || event_reply is None ||
    !event_reply.unwrap().contains("\"terminal\":\"success\"") ||
    !event_reply.unwrap().contains("\"delivered\":true") ||
    !event_reply.unwrap().contains("\"topic\":\"doc:open\"") ||
    !event_reply.unwrap().contains("\"generation\":1") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_ADAPTED_EVENT\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let mut event_title_ok = false
  for _attempt = 0; _attempt < 40; _attempt = _attempt + 1 {
    let event_title_request = request_frame(session, 16, 1, 1, "get-web-contents-title", "{}")
    let event_title_sent = send(fd, event_title_request)
    let event_title_reply = if event_title_sent { receive(fd, buffer) } else { None }
    if event_title_sent && event_title_reply is Some(_) &&
      event_title_reply.unwrap().contains("\"title\":\"adapted-event-native-delivery\"") {
      event_title_ok = true
      break
    }
    supervisor_sleep_ms(50)
  }
  if !event_title_ok {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_ADAPTED_EVENT_TITLE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let grant = request_frame(session, 52, 1, 1, "grant-file",
    "{\"path\":\"broker-output.txt\",\"mode\":\"readwrite\"}")
  let grant_sent = send(fd, grant)
  let grant_reply = if grant_sent { receive(fd, buffer) } else { None }
  if !grant_sent || grant_reply is None ||
    !grant_reply.unwrap().contains("\"granted\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_FILE_GRANT\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let dialog_open = request_frame(session, 53, 1, 1, "set-dialog-result",
    "{\"kind\":\"open\",\"path\":\"samples/sample.md\"}")
  let dialog_open_sent = send(fd, dialog_open)
  let dialog_open_reply = if dialog_open_sent { receive(fd, buffer) } else { None }
  if !dialog_open_sent || dialog_open_reply is None ||
    !dialog_open_reply.unwrap().contains("\"set\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_DIALOG_OPEN\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let dialog_save = request_frame(session, 54, 1, 1, "set-dialog-result",
    "{\"kind\":\"save\",\"path\":\"broker-save-as.txt\"}")
  let dialog_save_sent = send(fd, dialog_save)
  let dialog_save_reply = if dialog_save_sent { receive(fd, buffer) } else { None }
  if !dialog_save_sent || dialog_save_reply is None ||
    !dialog_save_reply.unwrap().contains("\"set\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_DIALOG_SAVE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let export_html = request_frame(session, 55, 1, 1, "set-dialog-result",
    "{\"kind\":\"export-html\",\"path\":\"broker-export.html\"}")
  let export_html_sent = send(fd, export_html)
  let export_html_reply = if export_html_sent { receive(fd, buffer) } else { None }
  if !export_html_sent || export_html_reply is None ||
    !export_html_reply.unwrap().contains("\"set\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_EXPORT_HTML\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let export_png = request_frame(session, 56, 1, 1, "set-dialog-result",
    "{\"kind\":\"export-png\",\"path\":\"broker-export.png\"}")
  let export_png_sent = send(fd, export_png)
  let export_png_reply = if export_png_sent { receive(fd, buffer) } else { None }
  if !export_png_sent || export_png_reply is None ||
    !export_png_reply.unwrap().contains("\"set\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_EXPORT_PNG\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let ingress = request_frame(session, 35, 1, 1, "trigger-adapted-ingress", "{}")
  let ingress_sent = send(fd, ingress)
  let ingress_reply = if ingress_sent { receive(fd, buffer) } else { None }
  if !ingress_sent || ingress_reply is None ||
    !ingress_reply.unwrap().contains("\"triggered\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_NATIVE_INGRESS_TRIGGER\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let mut ingress_title_ok = false
  for _attempt = 0; _attempt < 100; _attempt = _attempt + 1 {
    let _ = pump_app_requests(fd, event_fd, buffer, event_buffer, session, 1, 1)
    let ingress_title_request = request_frame(session, 36, 1, 1, "get-web-contents-title", "{}")
    let ingress_title_sent = send(fd, ingress_title_request)
    let ingress_title_reply = if ingress_title_sent { receive(fd, buffer) } else { None }
    if ingress_title_sent && ingress_title_reply is Some(_) &&
      ingress_title_reply.unwrap().contains("\"title\":\"adapted-ingress-ok\"") {
      ingress_title_ok = true
      break
    }
    supervisor_sleep_ms(50)
  }
  if !ingress_title_ok {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_NATIVE_INGRESS_TITLE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let ingress_status = request_frame(session, 37, 1, 1, "get-ingress-status", "{}")
  let ingress_status_sent = send(fd, ingress_status)
  let ingress_status_reply = if ingress_status_sent { receive(fd, buffer) } else { None }
  if !ingress_status_sent || ingress_status_reply is None ||
    !ingress_status_reply.unwrap().contains("\"admitted\":22") ||
    !ingress_status_reply.unwrap().contains("\"denied\":4") ||
    !ingress_status_reply.unwrap().contains("\"generation\":1") ||
    !ingress_status_reply.unwrap().contains("ELECTRON_MBT_FILE_DENIED") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_NATIVE_INGRESS_STATUS\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let close_event = request_frame(session, 47, 1, 1, "dispatch-adapted-event",
    "{\"topic\":\"app:request-close\",\"value\":\"close-request\"}")
  let close_event_sent = send(fd, close_event)
  let close_event_reply = if close_event_sent { receive(fd, buffer) } else { None }
  if !close_event_sent || close_event_reply is None ||
    !close_event_reply.unwrap().contains("\"delivered\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_CLOSE_REQUEST\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let mut close_title_ok = false
  for _attempt = 0; _attempt < 100; _attempt = _attempt + 1 {
    let close_title_request = request_frame(session, 48, 1, 1, "get-web-contents-title", "{}")
    let close_title_sent = send(fd, close_title_request)
    let close_title_reply = if close_title_sent { receive(fd, buffer) } else { None }
    if close_title_sent && close_title_reply is Some(_) &&
      close_title_reply.unwrap().contains("\"title\":\"nodeless-close-requested\"") {
      close_title_ok = true
      break
    }
    supervisor_sleep_ms(20)
  }
  if !close_title_ok {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_CLOSE_TITLE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let bootstrap = request_frame(session, 17, 1, 1, "get-bootstrap-status", "{}")
  let bootstrap_sent = send(fd, bootstrap)
  let bootstrap_reply = if bootstrap_sent { receive(fd, buffer) } else { None }
  if !bootstrap_sent || bootstrap_reply is None ||
    !bootstrap_reply.unwrap().contains("\"observed\":true") ||
    !bootstrap_reply.unwrap().contains("\"mainFrame\":true") ||
    !bootstrap_reply.unwrap().contains("\"generation\":1") ||
    !bootstrap_reply.unwrap().contains("index.html") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_BOOTSTRAP\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let preload = request_frame(session, 18, 1, 1, "get-preload-status", "{}")
  let preload_sent = send(fd, preload)
  let preload_reply = if preload_sent { receive(fd, buffer) } else { None }
  if !preload_sent || preload_reply is None || !preload_reply.unwrap().contains("\"status\":\"absent\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_PRELOAD_STATUS\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let adapted = request_frame(session, 19, 1, 1, "get-adapted-status", "{}")
  let adapted_sent = send(fd, adapted)
  let adapted_reply = if adapted_sent { receive(fd, buffer) } else { None }
  if !adapted_sent || adapted_reply is None ||
    !adapted_reply.unwrap().contains("\"observed\":true") ||
    !adapted_reply.unwrap().contains("\"documentStartBeforeLoad\":true") ||
    !adapted_reply.unwrap().contains("\"ingress\":\"absent\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_ADAPTED_STATUS\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let identity = request_frame(session, 32, 1, 1, "get-document-identity", "{}")
  let identity_sent = send(fd, identity)
  let identity_reply = if identity_sent { receive(fd, buffer) } else { None }
  if !identity_sent || identity_reply is None ||
    !identity_reply.unwrap().contains("\"source\":\"snapshot\"") ||
    !identity_reply.unwrap().contains("\"generation\":1") ||
    !identity_reply.unwrap().contains("\"sha256\":\"") ||
    identity_reply.unwrap().contains("\"sha256\":\"\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_SOURCE_IDENTITY\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let reload_prepare = request_frame(session, 33, 1, 1, "prepare-source", "{\"file\":\"index.html\"}")
  let reload_prepare_sent = send(fd, reload_prepare)
  let reload_prepare_reply = if reload_prepare_sent { receive(fd, buffer) } else { None }
  if !reload_prepare_sent || reload_prepare_reply is None ||
    !reload_prepare_reply.unwrap().contains("\"prepared\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_PREPARE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let reload_begin = request_frame(session, 20, 1, 2, "begin-load", "{}")
  let reload_begin_sent = send(fd, reload_begin)
  let reload_begin_reply = if reload_begin_sent { receive(fd, buffer) } else { None }
  if !reload_begin_sent || reload_begin_reply is None ||
    !reload_begin_reply.unwrap().contains("\"terminal\":\"success\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_BEGIN\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let reload_load = request_frame(session, 21, 1, 2, "load-file",
    "{\"file\":\"" + json_path(@utf8.decode_lossy(file_path[:path_length])) + "\"}")
  let reload_load_sent = send(load_fd, reload_load)
  let reload_load_reply = if reload_load_sent { receive(load_fd, buffer) } else { None }
  if !reload_load_sent || reload_load_reply is None ||
    !reload_load_reply.unwrap().contains("\"didFinishLoad\":true") ||
    !reload_load_reply.unwrap().contains("index.html") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_LOAD\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let reload_event_length = supervisor_read_timeout(event_fd, buffer, buffer.length(), 2000)
  let reload_event_reply = if reload_event_length > 0 {
    try { Some(@utf8.decode(buffer[:reload_event_length])) } catch { _ => None }
  } else {
    None
  }
  if reload_event_reply is None ||
    !reload_event_reply.unwrap().contains("\"operation\":\"isolated-preload-attested\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_EVENT\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let mut reload_pending_ok = false
  for _attempt = 0; _attempt < 100; _attempt = _attempt + 1 {
    let reload_pending_request = request_frame(session, 22, 1, 2, "get-web-contents-title", "{}")
    let reload_pending_sent = send(fd, reload_pending_request)
    let reload_pending_reply = if reload_pending_sent { receive(fd, buffer) } else { None }
    if reload_pending_sent && reload_pending_reply is Some(_) &&
      reload_pending_reply.unwrap().contains("\"title\":\"adapted-queue-pending\"") {
      reload_pending_ok = true
      break
    }
    supervisor_sleep_ms(20)
  }
  if !reload_pending_ok {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_QUEUE_PENDING\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let reload_release = request_frame(session, 44, 1, 2, "release-adapted-ingress", "{}")
  let reload_release_sent = send(fd, reload_release)
  let reload_release_reply = if reload_release_sent { receive(fd, buffer) } else { None }
  if !reload_release_sent || reload_release_reply is None ||
    !reload_release_reply.unwrap().contains("\"released\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_QUEUE_RELEASE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let mut reload_title_ok = false
  for _attempt = 0; _attempt < 100; _attempt = _attempt + 1 {
    let _ = pump_app_requests(fd, event_fd, buffer, event_buffer, session, 1, 2)
    let reload_title_request = request_frame(session, 45, 1, 2, "get-web-contents-title", "{}")
    let reload_title_sent = send(fd, reload_title_request)
    let reload_title_reply = if reload_title_sent { receive(fd, buffer) } else { None }
    if reload_title_sent && reload_title_reply is Some(_) &&
      reload_title_reply.unwrap().contains("\"title\":\"nodeless-app-ready\"") {
      reload_title_ok = true
      break
    }
    supervisor_sleep_ms(20)
  }
  if !reload_title_ok {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_PAGE_API\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let reload_queue_status = request_frame(session, 46, 1, 2, "get-ingress-status", "{}")
  let reload_queue_status_sent = send(fd, reload_queue_status)
  let reload_queue_status_reply = if reload_queue_status_sent { receive(fd, buffer) } else { None }
  if !reload_queue_status_sent || reload_queue_status_reply is None ||
    !reload_queue_status_reply.unwrap().contains("\"admitted\":4") ||
    !reload_queue_status_reply.unwrap().contains("\"generation\":2") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_QUEUE_STATUS\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let reload_bootstrap = request_frame(session, 23, 1, 2, "get-bootstrap-status", "{}")
  let reload_bootstrap_sent = send(fd, reload_bootstrap)
  let reload_bootstrap_reply = if reload_bootstrap_sent { receive(fd, buffer) } else { None }
  if !reload_bootstrap_sent || reload_bootstrap_reply is None ||
    !reload_bootstrap_reply.unwrap().contains("\"observed\":true") ||
    !reload_bootstrap_reply.unwrap().contains("\"generation\":2") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_BOOTSTRAP\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let reload_preload = request_frame(session, 24, 1, 2, "get-preload-status", "{}")
  let reload_preload_sent = send(fd, reload_preload)
  let reload_preload_reply = if reload_preload_sent { receive(fd, buffer) } else { None }
  if !reload_preload_sent || reload_preload_reply is None ||
    !reload_preload_reply.unwrap().contains("\"status\":\"absent\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_PRELOAD\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let reload_adapted = request_frame(session, 25, 1, 2, "get-adapted-status", "{}")
  let reload_adapted_sent = send(fd, reload_adapted)
  let reload_adapted_reply = if reload_adapted_sent { receive(fd, buffer) } else { None }
  if !reload_adapted_sent || reload_adapted_reply is None ||
    !reload_adapted_reply.unwrap().contains("\"observed\":true") ||
    !reload_adapted_reply.unwrap().contains("\"documentStartBeforeLoad\":true") ||
    !reload_adapted_reply.unwrap().contains("\"generation\":2") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_ADAPTED\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let reload_identity = request_frame(session, 34, 1, 2, "get-document-identity", "{}")
  let reload_identity_sent = send(fd, reload_identity)
  let reload_identity_reply = if reload_identity_sent { receive(fd, buffer) } else { None }
  if !reload_identity_sent || reload_identity_reply is None ||
    !reload_identity_reply.unwrap().contains("\"source\":\"snapshot\"") ||
    !reload_identity_reply.unwrap().contains("\"generation\":2") ||
    !reload_identity_reply.unwrap().contains("\"sha256\":\"") ||
    reload_identity_reply.unwrap().contains("\"sha256\":\"\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_SOURCE_IDENTITY\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let reload_event = request_frame(session, 26, 1, 2, "dispatch-adapted-event",
    "{\"topic\":\"doc:open\",\"value\":\"native-reload\"}")
  let reload_event_sent = send(fd, reload_event)
  let reload_event_dispatch_reply = if reload_event_sent { receive(fd, buffer) } else { None }
  if !reload_event_sent || reload_event_dispatch_reply is None ||
    !reload_event_dispatch_reply.unwrap().contains("\"terminal\":\"success\"") ||
    !reload_event_dispatch_reply.unwrap().contains("\"delivered\":true") ||
    !reload_event_dispatch_reply.unwrap().contains("\"generation\":2") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_EVENT_DISPATCH\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let mut reload_event_title_ok = false
  for _attempt = 0; _attempt < 40; _attempt = _attempt + 1 {
    let reload_event_title_request = request_frame(session, 27, 1, 2, "get-web-contents-title", "{}")
    let reload_event_title_sent = send(fd, reload_event_title_request)
    let reload_event_title_reply = if reload_event_title_sent { receive(fd, buffer) } else { None }
    if reload_event_title_sent && reload_event_title_reply is Some(_) &&
      reload_event_title_reply.unwrap().contains("\"title\":\"adapted-event-native-reload\"") {
      reload_event_title_ok = true
      break
    }
    supervisor_sleep_ms(50)
  }
  if !reload_event_title_ok {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_EVENT_TITLE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let reload_ingress = request_frame(session, 38, 1, 2, "trigger-adapted-ingress", "{}")
  let reload_ingress_sent = send(fd, reload_ingress)
  let reload_ingress_reply = if reload_ingress_sent { receive(fd, buffer) } else { None }
  if !reload_ingress_sent || reload_ingress_reply is None ||
    !reload_ingress_reply.unwrap().contains("\"triggered\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_NATIVE_INGRESS_TRIGGER\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let mut reload_ingress_title_ok = false
  for _attempt = 0; _attempt < 100; _attempt = _attempt + 1 {
    let _ = pump_app_requests(fd, event_fd, buffer, event_buffer, session, 1, 2)
    let reload_ingress_title_request = request_frame(session, 39, 1, 2, "get-web-contents-title", "{}")
    let reload_ingress_title_sent = send(fd, reload_ingress_title_request)
    let reload_ingress_title_reply = if reload_ingress_title_sent { receive(fd, buffer) } else { None }
    if reload_ingress_title_sent && reload_ingress_title_reply is Some(_) &&
      reload_ingress_title_reply.unwrap().contains("\"title\":\"adapted-ingress-ok\"") {
      reload_ingress_title_ok = true
      break
    }
    supervisor_sleep_ms(50)
  }
  if !reload_ingress_title_ok {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_NATIVE_INGRESS_TITLE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let reload_ingress_status = request_frame(session, 40, 1, 2, "get-ingress-status", "{}")
  let reload_ingress_status_sent = send(fd, reload_ingress_status)
  let reload_ingress_status_reply = if reload_ingress_status_sent { receive(fd, buffer) } else { None }
  if !reload_ingress_status_sent || reload_ingress_status_reply is None ||
    !reload_ingress_status_reply.unwrap().contains("\"admitted\":22") ||
    !reload_ingress_status_reply.unwrap().contains("\"denied\":4") ||
    !reload_ingress_status_reply.unwrap().contains("\"generation\":2") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_NATIVE_INGRESS_STATUS\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let reload_close_event = request_frame(session, 49, 1, 2, "dispatch-adapted-event",
    "{\"topic\":\"app:request-close\",\"value\":\"close-request\"}")
  let reload_close_event_sent = send(fd, reload_close_event)
  let reload_close_event_reply = if reload_close_event_sent { receive(fd, buffer) } else { None }
  if !reload_close_event_sent || reload_close_event_reply is None ||
    !reload_close_event_reply.unwrap().contains("\"delivered\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_CLOSE_REQUEST\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let mut reload_close_title_ok = false
  for _attempt = 0; _attempt < 100; _attempt = _attempt + 1 {
    let reload_close_title_request = request_frame(session, 50, 1, 2, "get-web-contents-title", "{}")
    let reload_close_title_sent = send(fd, reload_close_title_request)
    let reload_close_title_reply = if reload_close_title_sent { receive(fd, buffer) } else { None }
    if reload_close_title_sent && reload_close_title_reply is Some(_) &&
      reload_close_title_reply.unwrap().contains("\"title\":\"nodeless-close-requested\"") {
      reload_close_title_ok = true
      break
    }
    supervisor_sleep_ms(20)
  }
  if !reload_close_title_ok {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_CLOSE_TITLE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let stale_after = request_frame(session, 28, 1, 1, "dispatch-adapted-event",
    "{\"topic\":\"doc:open\",\"value\":\"stale\"}")
  let stale_after_sent = send(fd, stale_after)
  let stale_after_reply = if stale_after_sent { receive(fd, buffer) } else { None }
  if !stale_after_sent || stale_after_reply is None ||
    !stale_after_reply.unwrap().contains("\"terminal\":\"failure\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_EVENT_STALE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let destroy = request_frame(session, 29, 1, 2, "destroy-window", "{}")
  let destroy_sent = send(fd, destroy)
  let destroy_reply = if destroy_sent { receive(fd, buffer) } else { None }
  if !destroy_sent || destroy_reply is None || !destroy_reply.unwrap().contains("\"destroyed\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_DESTROY\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let shutdown = request_frame(session, 30, 0, 0, "shutdown", "{}")
  if !send(fd, shutdown) || receive(fd, buffer) is None {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_SHUTDOWN\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let child_pid = supervisor_pid()
  let exit_status = supervisor_finish()
  let second_session_buffer = Bytes::new(32)
  if supervisor_session(second_session_buffer) != 32 {
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_SESSION\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let second_session = @utf8.decode_lossy(second_session_buffer)
  let second_fd = supervisor_start(
    @utf8.encode("dist/electron-mbt-native-host"),
    @utf8.encode("fixtures/native-app"),
    @utf8.encode(second_session),
  )
  if second_fd < 0 {
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RESTART\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let second_hello = request_frame(second_session, 1, 0, 0, "hello", "{}")
  let second_hello_sent = send(second_fd, second_hello)
  let second_hello_reply = if second_hello_sent { receive(second_fd, buffer) } else { None }
  if !second_hello_sent || second_hello_reply is None ||
    !second_hello_reply.unwrap().contains("\"terminal\":\"success\"") ||
    !second_hello_reply.unwrap().contains("AppKit+WKWebView") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RESTART\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let second_ready = request_frame(second_session, 2, 0, 0, "ready", "{}")
  let second_ready_sent = send(second_fd, second_ready)
  let second_ready_reply = if second_ready_sent { receive(second_fd, buffer) } else { None }
  if !second_ready_sent || second_ready_reply is None ||
    !second_ready_reply.unwrap().contains("\"terminal\":\"success\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RESTART\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let second_pid = supervisor_pid()
  let second_shutdown = request_frame(second_session, 3, 0, 0, "shutdown", "{}")
  let second_shutdown_sent = send(second_fd, second_shutdown)
  let second_shutdown_reply = if second_shutdown_sent { receive(second_fd, buffer) } else { None }
  if !second_shutdown_sent || second_shutdown_reply is None {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RESTART\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let second_exit_status = supervisor_finish()
  if second_exit_status != 0 {
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RESTART_EXIT\",\"compatible\":false}")
    supervisor_exit(1)
  }
  println("{\"status\":\"PASS\",\"probe\":\"native-supervisor-window-load\",\"backend\":\"AppKit+WKWebView\",\"childPid\":" +
    child_pid.to_string() + ",\"exitStatus\":" + exit_status.to_string() +
    ",\"windowLoaded\":true,\"event\":\"isolated-preload-attested\",\"mainEvaluated\":true,\"moduleGraph\":true,\"packageGraph\":true," +
    "\"appMain\":\"native-fixture\",\"appEntry\":\"" + json_path(app_entry) +
    "\",\"appTitle\":\"" + json_path(app_title) +
    "\",\"bootstrapObserved\":true,\"preloadStatus\":\"absent\",\"adaptedAdapter\":true,\"pageApi\":\"adapted-fixture\",\"pageTitle\":\"nodeless-app-ready\",\"appScenario\":\"nodeless-fixture\",\"appDocumentTitle\":\"nodeless-app-ready\",\"closeRequest\":true,\"closeRequestReload\":true,\"adapterDocumentStartBeforeLoad\":true,\"adapterIngress\":\"absent\",\"adaptedEventDelivery\":true,\"adaptedEventReload\":true,\"adaptedEventUnknownTopicRejected\":true,\"adaptedEventStaleGenerationRejected\":true,\"adaptedEventForgedNonce\":\"page-observed-rejected\",\"sourceSnapshot\":true,\"sourceSnapshotReload\":true,\"nativeIngress\":true,\"nativeIngressReload\":true,\"nativeIngressDenied\":4,\"nativeQueueRelease\":true,\"nativeQueueAdmitted\":4,\"nativeMainRoundTrip\":true,\"unsupportedBuiltinRejected\":true,\"mojiOperationRouted\":true,\"mojiHandlers\":true,\"fileBroker\":true,\"fileRead\":true,\"fileSave\":true,\"fileDenied\":true,\"fileDialog\":true,\"fileSaveAs\":true,\"exportHtml\":true,\"exportPng\":true,\"reloadGeneration\":2,\"attempts\":" + attempts.to_string() +
    ",\"restarts\":1,\"secondPid\":" + second_pid.to_string() +
    ",\"secondExitStatus\":" + second_exit_status.to_string() +
    ",\"creator\":\"moonbit-native\",\"compatible\":false}")
}
