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

fn start_ready(buffer : Bytes) -> (Int, String, Int)? {
  for attempt = 1; attempt <= 3; attempt = attempt + 1 {
    let session_buffer = Bytes::new(32)
    if supervisor_session(session_buffer) != 32 {
      return None
    }
    let session = @utf8.decode_lossy(session_buffer)
    let fd = supervisor_start(
      @utf8.encode("dist/electron-mbt-native-host"),
      @utf8.encode("fixtures/native-app"),
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
fn main {
  let buffer = Bytes::new(65536)
  let (fd, session, attempts) = match start_ready(buffer) {
    Some(value) => value
    None => {
      println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_START\",\"compatible\":false}")
      supervisor_exit(1)
      (0, "", 0)
    }
  }
  if supervisor_app_main() != 42 {
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
  let adapter_path = Bytes::new(4096)
  let adapter_length = supervisor_file(adapter_path, adapter_path.length(), @utf8.encode("adapted/page-api.js"))
  if adapter_length <= 0 {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_ADAPTER_PATH\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let prepare = request_frame(session, 31, 1, 0, "prepare-source", "{\"file\":\"index.html\"}")
  let prepare_sent = send(fd, prepare)
  let prepare_reply = if prepare_sent { receive(fd, buffer) } else { None }
  if !prepare_sent || prepare_reply is None ||
    !prepare_reply.unwrap().contains("\"prepared\":true") ||
    !prepare_reply.unwrap().contains("\"sha256\":\"") ||
    !prepare_reply.unwrap().contains("\"manifestSHA256\":\"") ||
    !prepare_reply.unwrap().contains("\"files\":2") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_PREPARE_SOURCE\",\"compatible\":false}")
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
    let page_title_request = request_frame(session, 42, 1, 1, "get-web-contents-title", "{}")
    let page_title_sent = send(fd, page_title_request)
    let page_title_reply = if page_title_sent { receive(fd, buffer) } else { None }
    if page_title_sent && page_title_reply is Some(_) &&
      page_title_reply.unwrap().contains("\"title\":\"adapted-api-ok\"") {
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
    !queue_status_reply.unwrap().contains("\"unhandled\":4") ||
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
  for _attempt = 0; _attempt < 40; _attempt = _attempt + 1 {
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
    !ingress_status_reply.unwrap().contains("\"admitted\":1") ||
    !ingress_status_reply.unwrap().contains("\"denied\":2") ||
    !ingress_status_reply.unwrap().contains("\"generation\":1") ||
    !ingress_status_reply.unwrap().contains("ELECTRON_MBT_INGRESS_LIMIT") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_NATIVE_INGRESS_STATUS\",\"compatible\":false}")
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
    let reload_title_request = request_frame(session, 45, 1, 2, "get-web-contents-title", "{}")
    let reload_title_sent = send(fd, reload_title_request)
    let reload_title_reply = if reload_title_sent { receive(fd, buffer) } else { None }
    if reload_title_sent && reload_title_reply is Some(_) &&
      reload_title_reply.unwrap().contains("\"title\":\"adapted-api-ok\"") {
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
    !reload_queue_status_reply.unwrap().contains("\"unhandled\":4") ||
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
  for _attempt = 0; _attempt < 40; _attempt = _attempt + 1 {
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
    !reload_ingress_status_reply.unwrap().contains("\"admitted\":1") ||
    !reload_ingress_status_reply.unwrap().contains("\"denied\":2") ||
    !reload_ingress_status_reply.unwrap().contains("\"generation\":2") {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_RELOAD_NATIVE_INGRESS_STATUS\",\"compatible\":false}")
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
    "\",\"bootstrapObserved\":true,\"preloadStatus\":\"absent\",\"adaptedAdapter\":true,\"pageApi\":\"adapted-fixture\",\"pageTitle\":\"adapted-api-ok\",\"adapterDocumentStartBeforeLoad\":true,\"adapterIngress\":\"absent\",\"adaptedEventDelivery\":true,\"adaptedEventReload\":true,\"adaptedEventUnknownTopicRejected\":true,\"adaptedEventStaleGenerationRejected\":true,\"adaptedEventForgedNonce\":\"page-observed-rejected\",\"sourceSnapshot\":true,\"sourceSnapshotReload\":true,\"nativeIngress\":true,\"nativeIngressReload\":true,\"nativeIngressDenied\":2,\"nativeQueueRelease\":true,\"nativeQueueUnhandled\":4,\"reloadGeneration\":2,\"attempts\":" + attempts.to_string() +
    ",\"restarts\":1,\"secondPid\":" + second_pid.to_string() +
    ",\"secondExitStatus\":" + second_exit_status.to_string() +
    ",\"creator\":\"moonbit-native\",\"compatible\":false}")
}
