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
extern "C" fn supervisor_app_main() -> Int = "moonbit_ebt_supervisor_app_main"

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
fn main {
  let session_buffer = Bytes::new(32)
  if supervisor_session(session_buffer) != 32 {
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_SESSION\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let session = @utf8.decode_lossy(session_buffer)
  let fd = supervisor_start(
    @utf8.encode("dist/electron-mbt-native-host"),
    @utf8.encode("fixtures/native-app"),
    @utf8.encode(session),
  )
  if fd < 0 {
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_START\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let buffer = Bytes::new(65536)
  if supervisor_app_main() != 42 {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_APP_MAIN\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let hello = request_frame(session, 1, 0, 0, "hello", "{}")
  if !send(fd, hello) {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_WRITE\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let hello_reply = receive(fd, buffer)
  if hello_reply is None || !hello_reply.unwrap().contains("\"terminal\":\"success\"") ||
    !hello_reply.unwrap().contains("AppKit+WKWebView") {
    let reply_text = match hello_reply {
      Some(value) => "\"" + value + "\""
      None => "null"
    }
    let exit_status = supervisor_finish()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_HELLO\",\"reply\":" +
      reply_text + ",\"exitStatus\":" + exit_status.to_string() + ",\"compatible\":false}")
    supervisor_exit(1)
  }
  let ready = request_frame(session, 2, 0, 0, "ready", "{}")
  if !send(fd, ready) || receive(fd, buffer) is None {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_READY\",\"compatible\":false}")
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
  let create = request_frame(session, 4, 1, 0, "create-window",
    "{\"width\":640,\"height\":480,\"title\":\"" + json_path(app_title) + "\",\"show\":false}")
  let create_sent = send(fd, create)
  let create_reply = if create_sent { receive(fd, buffer) } else { None }
  if !create_sent || create_reply is None || !create_reply.unwrap().contains("\"terminal\":\"success\"") ||
    !create_reply.unwrap().contains("\"webViewAttached\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_WINDOW\",\"compatible\":false}")
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
  let begin = request_frame(session, 6, 1, 1, "begin-load", "{}")
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
  let load = request_frame(session, 7, 1, 1, "load-file",
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
  let bootstrap = request_frame(session, 8, 1, 1, "get-bootstrap-status", "{}")
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
  let preload = request_frame(session, 9, 1, 1, "get-preload-status", "{}")
  let preload_sent = send(fd, preload)
  let preload_reply = if preload_sent { receive(fd, buffer) } else { None }
  if !preload_sent || preload_reply is None || !preload_reply.unwrap().contains("\"status\":\"absent\"") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_PRELOAD_STATUS\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let destroy = request_frame(session, 10, 1, 1, "destroy-window", "{}")
  let destroy_sent = send(fd, destroy)
  let destroy_reply = if destroy_sent { receive(fd, buffer) } else { None }
  if !destroy_sent || destroy_reply is None || !destroy_reply.unwrap().contains("\"destroyed\":true") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_DESTROY\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let shutdown = request_frame(session, 11, 0, 0, "shutdown", "{}")
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
    "\",\"bootstrapObserved\":true,\"preloadStatus\":\"absent\",\"restarts\":1,\"secondPid\":" + second_pid.to_string() +
    ",\"secondExitStatus\":" + second_exit_status.to_string() +
    ",\"creator\":\"moonbit-native\",\"compatible\":false}")
}
