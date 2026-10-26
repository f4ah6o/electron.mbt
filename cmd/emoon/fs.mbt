///|
#borrow(root, relative)
extern "C" fn emoon_fs_kind(
  root : Bytes,
  relative : Bytes,
) -> Int = "moonbit_emoon_fs_kind"

///|
#borrow(root, relative)
extern "C" fn emoon_fs_size(
  root : Bytes,
  relative : Bytes,
) -> Int = "moonbit_emoon_fs_size"

///|
#borrow(root, relative)
extern "C" fn emoon_fs_dir_count(
  root : Bytes,
  relative : Bytes,
) -> Int = "moonbit_emoon_fs_dir_count"

///|
#borrow(root, relative, out)
extern "C" fn emoon_fs_dir_name(
  root : Bytes,
  relative : Bytes,
  index : Int,
  out : Bytes,
  capacity : Int,
) -> Int = "moonbit_emoon_fs_dir_name"

///|
#borrow(root, relative)
extern "C" fn emoon_fs_mkdir_p(
  root : Bytes,
  relative : Bytes,
) -> Int = "moonbit_emoon_fs_mkdir_p"

///|
#borrow(root, relative, data)
extern "C" fn emoon_fs_write_atomic(
  root : Bytes,
  relative : Bytes,
  data : Bytes,
  length : Int,
) -> Int = "moonbit_emoon_fs_write_atomic"

///|
#borrow(root, source, destination)
extern "C" fn emoon_fs_copy(
  root : Bytes,
  source : Bytes,
  destination : Bytes,
) -> Int = "moonbit_emoon_fs_copy"

///|
#borrow(root, relative)
extern "C" fn emoon_fs_remove_tree(
  root : Bytes,
  relative : Bytes,
) -> Int = "moonbit_emoon_fs_remove_tree"

///|
#borrow(root, from, to)
extern "C" fn emoon_fs_rename(
  root : Bytes,
  from : Bytes,
  to : Bytes,
) -> Int = "moonbit_emoon_fs_rename"

///|
fn fs_rename(root : String, from : String, to : String) -> Int {
  emoon_fs_rename(@utf8.encode(root), @utf8.encode(from), @utf8.encode(to))
}

///|
fn fs_kind(root : String, relative : String) -> Int {
  emoon_fs_kind(@utf8.encode(root), @utf8.encode(relative))
}

///|
fn fs_size(root : String, relative : String) -> Int {
  emoon_fs_size(@utf8.encode(root), @utf8.encode(relative))
}

///|
fn fs_mkdir_p(root : String, relative : String) -> Int {
  emoon_fs_mkdir_p(@utf8.encode(root), @utf8.encode(relative))
}

///|
fn fs_write_atomic(root : String, relative : String, text : String) -> Int {
  let bytes = @utf8.encode(text)
  emoon_fs_write_atomic(@utf8.encode(root), @utf8.encode(relative), bytes, bytes.length())
}

///|
fn fs_copy(root : String, source : String, destination : String) -> Int {
  emoon_fs_copy(@utf8.encode(root), @utf8.encode(source), @utf8.encode(destination))
}

///|
fn fs_remove_tree(root : String, relative : String) -> Int {
  emoon_fs_remove_tree(@utf8.encode(root), @utf8.encode(relative))
}

///|
/// Read a bounded text file. An empty file is represented as `Some("")`; the
/// caller decides whether that is valid for the file's role. `max_bytes` must
/// stay below the 16 MiB native read cap.
fn fs_read_text(root : String, relative : String, max_bytes : Int) -> String? {
  let size = fs_size(root, relative)
  if size < 0 || size > max_bytes {
    return None
  }
  if size == 0 {
    return Some("")
  }
  let buffer = Bytes::new(size + 1)
  let length = nodeless_read_file(
    @utf8.encode(root),
    @utf8.encode(relative),
    buffer,
    buffer.length(),
  )
  if length < 0 {
    None
  } else {
    Some(@utf8.decode_lossy(buffer[:length]))
  }
}

///|
fn fs_list(root : String, relative : String) -> Result[Array[String], @cli.CliError] {
  let count = emoon_fs_dir_count(@utf8.encode(root), @utf8.encode(relative))
  if count < 0 {
    return Err(@cli.CliError::new(
      "ELECTRON_MBT_MIGRATE_IO",
      "cannot list " + relative,
    ))
  }
  let names : Array[String] = []
  for index = 0; index < count; index = index + 1 {
    let buffer = Bytes::new(256)
    let length = emoon_fs_dir_name(
      @utf8.encode(root),
      @utf8.encode(relative),
      index,
      buffer,
      buffer.length(),
    )
    if length < 0 {
      return Err(@cli.CliError::new(
        "ELECTRON_MBT_MIGRATE_IO",
        "cannot read a directory entry in " + relative,
      ))
    }
    names.push(@utf8.decode_lossy(buffer[:length]))
  }
  @cli.sort_utf16(names)
  Ok(names)
}

///|
fn fs_realpath(path : String) -> String? {
  let buffer = Bytes::new(4096)
  let length = nodeless_realpath(@utf8.encode(path), buffer, buffer.length())
  if length <= 0 {
    None
  } else {
    Some(@utf8.decode_lossy(buffer[:length]))
  }
}

///|
#borrow(root)
extern "C" fn emoon_run_build(
  root : Bytes,
) -> Int = "moonbit_emoon_run_build"

///|
fn run_build(root : String) -> Int {
  emoon_run_build(@utf8.encode(root))
}
