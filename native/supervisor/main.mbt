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
extern "C" fn supervisor_finish() -> Int = "moonbit_ebt_supervisor_finish"

///|
extern "C" fn supervisor_kill() = "moonbit_ebt_supervisor_kill"

///|
extern "C" fn supervisor_exit(code : Int) = "moonbit_ebt_supervisor_exit"

///|
fn request_frame(session : String, request : Int, operation : String, payload : String) -> String {
  "{\"version\":1,\"session\":\"" + session + "\",\"request\":" + request.to_string() +
  ",\"window\":0,\"generation\":0,\"operation\":\"" + operation + "\",\"payload\":" + payload + "}"
}

///|
fn send(fd : Int, frame : String) -> Bool {
  let bytes = @utf8.encode(frame)
  supervisor_write(fd, bytes, bytes.length()) == 0
}

///|
fn receive(fd : Int, buffer : Bytes) -> String? {
  let length = supervisor_read(fd, buffer, buffer.length())
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
fn main {
  let session = "0123456789abcdef0123456789abcdef"
  let fd = supervisor_start(
    @utf8.encode("dist/electron-mbt-native-host"),
    @utf8.encode("fixtures/m1"),
    @utf8.encode(session),
  )
  if fd < 0 {
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_START\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let buffer = Bytes::new(65536)
  let hello = request_frame(session, 1, "hello", "{}")
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
  let ready = request_frame(session, 2, "ready", "{}")
  if !send(fd, ready) || receive(fd, buffer) is None {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_READY\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let shutdown = request_frame(session, 3, "shutdown", "{}")
  if !send(fd, shutdown) || receive(fd, buffer) is None {
    supervisor_kill()
    println("{\"status\":\"FAIL\",\"code\":\"ELECTRON_MBT_SUPERVISOR_SHUTDOWN\",\"compatible\":false}")
    supervisor_exit(1)
  }
  let child_pid = supervisor_pid()
  let exit_status = supervisor_finish()
  println("{\"status\":\"PASS\",\"probe\":\"native-supervisor-handshake\",\"backend\":\"AppKit+WKWebView\",\"childPid\":" +
    child_pid.to_string() + ",\"exitStatus\":" + exit_status.to_string() +
    ",\"creator\":\"moonbit-native\",\"compatible\":false}")
}
