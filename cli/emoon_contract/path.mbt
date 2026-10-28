///|
pub(all) struct CliError {
  code : String
  message : String
} derive(Eq, Debug)

///|
pub fn CliError::new(code : String, message : String) -> CliError {
  { code: code, message: message }
}

///|
fn path_has_nul(value : String) -> Bool {
  let mut index : Int32 = 0
  while index < value.length() {
    if value.get(index).unwrap() == 0 {
      return true
    }
    index = index + 1
  }
  false
}

///|
pub fn path_is_absolute(value : String) -> Bool {
  value.has_prefix("/")
}

///|
/// Validate an app-relative path using the same rules as the Node reference:
/// non-empty, bounded, not absolute, no `..` segment and no NUL. POSIX is the
/// only supported target, so backslash is retained but still checked for `..`.
pub fn normalize_relative(
  value : String,
  label : String,
) -> Result[String, CliError] {
  if value.length() == 0 || value.length() > 512 {
    return Err(CliError::new(
      "ELECTRON_MBT_MIGRATE_USAGE",
      label + " is required",
    ))
  }
  if path_is_absolute(value) || path_has_nul(value) {
    return Err(CliError::new(
      "ELECTRON_MBT_PATH_ESCAPE",
      label + " must be app-relative",
    ))
  }
  for segment in value.split("/") {
    if segment == ".." {
      return Err(CliError::new(
        "ELECTRON_MBT_PATH_ESCAPE",
        label + " must be app-relative",
      ))
    }
  }
  for segment in value.split("\\") {
    if segment == ".." {
      return Err(CliError::new(
        "ELECTRON_MBT_PATH_ESCAPE",
        label + " must be app-relative",
      ))
    }
  }
  Ok(value)
}

///|
pub fn join_path(root : String, relative : String) -> String {
  if relative == "" {
    return root
  }
  if root.has_suffix("/") {
    root + relative
  } else {
    root + "/" + relative
  }
}

///|
pub fn path_dirname(value : String) -> String {
  let mut end = value.length()
  while end > 1 && value.get(end - 1).unwrap() == 0x2f {
    end = end - 1
  }
  let mut index = end - 1
  while index >= 0 {
    if value.get(index).unwrap() == 0x2f {
      if index == 0 {
        return "/"
      }
      return value[0:index].to_owned()
    }
    index = index - 1
  }
  "."
}

///|
pub fn path_basename(value : String) -> String {
  let mut end = value.length()
  while end > 1 && value.get(end - 1).unwrap() == 0x2f {
    end = end - 1
  }
  let mut index = end - 1
  while index >= 0 {
    if value.get(index).unwrap() == 0x2f {
      return value[index + 1:end].to_owned()
    }
    index = index - 1
  }
  value[0:end].to_owned()
}

///|
/// `target` is `root` or lies below it lexically. Both inputs are expected to
/// be canonical; the native IO layer re-checks containment with realpath.
pub fn path_inside(root : String, target : String) -> Bool {
  if target == root {
    return true
  }
  if root == "/" {
    return target.has_prefix("/") && !target.has_prefix("//")
  }
  if not(target.has_prefix(root)) {
    return false
  }
  target.length() > root.length() &&
  target.get(root.length()).unwrap() == 0x2f
}

///|
/// Compare by UTF-16 code unit, matching JavaScript's default string sort. MoonBit
/// strings are already indexed by UTF-16 code unit, so this also handles
/// supplementary characters where plain code-point order would differ.
pub fn utf16_compare(left : String, right : String) -> Int {
  let left_length = left.length()
  let right_length = right.length()
  let limit = if left_length < right_length { left_length } else { right_length }
  let mut index : Int32 = 0
  while index < limit {
    let left_unit = left.get(index).unwrap()
    let right_unit = right.get(index).unwrap()
    if left_unit < right_unit {
      return -1
    }
    if left_unit > right_unit {
      return 1
    }
    index = index + 1
  }
  if left_length < right_length {
    -1
  } else if left_length > right_length {
    1
  } else {
    0
  }
}

///|
pub fn sort_utf16(values : Array[String]) -> Unit {
  values.sort_by((left, right) => {
    let result = utf16_compare(left, right)
    if result < 0 {
      -1
    } else if result > 0 {
      1
    } else {
      0
    }
  })
}

///|
