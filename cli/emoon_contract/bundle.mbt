///|
/// Pure naming and display helpers shared by the `emoon bundle` command. The
/// bundle container itself owns the XDG app slug; these helpers only name the
/// output artifact, so they deliberately keep the result filesystem-safe and
/// independent of the host platform.
fn bundle_lower_unit(unit : UInt16) -> Int {
  let value = unit.to_int()
  if value >= 0x41 && value <= 0x5a {
    value + 0x20
  } else {
    value
  }
}

///|
/// Lowercase ASCII slug with one separator for every rejected run. The result
/// is never empty, has no leading/trailing separator and is bounded by
/// `limit`, so it can be joined into a file name without escaping.
fn bundle_slug_with(text : String, allow_dot : Bool, limit : Int) -> String {
  let out = StringBuilder::new()
  let mut written = 0
  let mut pending = false
  let mut index = 0
  while index < text.length() && written < limit {
    let unit = bundle_lower_unit(text.get(index).unwrap())
    let keep = (unit >= 0x61 && unit <= 0x7a) ||
      (unit >= 0x30 && unit <= 0x39) ||
      unit == 0x5f ||
      (allow_dot && unit == 0x2e)
    if keep {
      if pending && written > 0 && written < limit {
        out.write_char('-')
        written = written + 1
      }
      pending = false
      if written < limit {
        out.write_char(unit.to_char().unwrap())
        written = written + 1
      }
    } else {
      pending = true
    }
    index = index + 1
  }
  out.to_string()
}

///|
/// Application slug used in the default output file name. `@scope/app`
/// becomes `scope-app`, `My  App!!` becomes `my-app`, and an empty or fully
/// rejected name becomes `app`.
pub fn bundle_slug(text : String) -> String {
  let slug = bundle_slug_with(text, false, 48)
  if slug == "" {
    "app"
  } else {
    slug
  }
}

///|
/// Build the default output file name from the staged app identity and the
/// current host. The caller appends the directory; this function never
/// contains a path separator.
pub fn bundle_file_name(
  app : String,
  version : String,
  platform : String,
  arch : String,
) -> String {
  let app_slug = bundle_slug(app)
  let version_slug = bundle_slug_with(version, true, 32)
  let platform_slug = bundle_slug_with(platform, false, 12)
  let arch_slug = bundle_slug_with(arch, false, 12)
  let version_part = if version_slug == "" { "0.0.0" } else { version_slug }
  let platform_part = if platform_slug == "" { "unknown" } else { platform_slug }
  let arch_part = if arch_slug == "" { "unknown" } else { arch_slug }
  app_slug + "-" + version_part + "-" + platform_part + "-" + arch_part
}

///|
/// Human-readable byte count for the stderr progress lines. One decimal is
/// enough for a file that is measured in mebibytes; the JSON report keeps the
/// exact byte count.
pub fn bundle_size_text(bytes : Int) -> String {
  if bytes <= 0 {
    return "0 B"
  }
  if bytes < 1024 {
    return bytes.to_string() + " B"
  }
  if bytes < 1048576 {
    return (bytes / 1024).to_string() + " KiB"
  }
  let tenths = (bytes * 10 + 524288) / 1048576
  (tenths / 10).to_string() + "." + (tenths % 10).to_string() + " MiB"
}
