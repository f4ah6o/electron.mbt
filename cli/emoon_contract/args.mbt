///|
/// Parsed arguments shared by `init`, `inspect`, `migrate` and `dev`. The
/// Node reference accepts an unknown `--key value` and ignores it, so the same
/// shape is kept here instead of rejecting unknown options.
pub(all) struct CliArgs {
  mut app_dir : String
  positional : Array[String]
  include : Array[String]
  flags : Map[String, Bool]
  values : Map[String, String]
}

///|
pub fn CliArgs::has(self : CliArgs, name : String) -> Bool {
  match self.flags.get(name) {
    Some(value) => value
    None => false
  }
}

///|
pub fn CliArgs::value(self : CliArgs, name : String) -> String? {
  self.values.get(name)
}

///|
fn is_boolean_flag(key : String) -> Bool {
  key == "force" ||
  key == "reset-data" ||
  key == "dry-run" ||
  key == "json" ||
  key == "help" ||
  key == "no-launch"
}

///|
pub fn parse_args(argv : Array[String]) -> Result[CliArgs, CliError] {
  let args : CliArgs = {
    app_dir: ".",
    positional: [],
    include: [],
    flags: Map([]),
    values: Map([]),
  }
  let mut index = 0
  while index < argv.length() {
    let arg = argv[index]
    if not(arg.has_prefix("--")) {
      args.positional.push(arg)
      index = index + 1
      continue
    }
    let key = arg[2:].to_owned()
    if is_boolean_flag(key) {
      args.flags[key] = true
      index = index + 1
      continue
    }
    if index + 1 >= argv.length() || argv[index + 1].has_prefix("--") {
      return Err(CliError::new(
        "ELECTRON_MBT_MIGRATE_USAGE",
        arg + " requires a value",
      ))
    }
    let value = argv[index + 1]
    index = index + 2
    if key == "include" {
      for item in value.split(",") {
        let trimmed = item.trim_space().to_owned()
        if trimmed != "" {
          args.include.push(trimmed)
        }
      }
    } else if key == "app-dir" {
      args.app_dir = value
    } else {
      args.values[key] = value
    }
  }
  if args.positional.length() > 1 {
    return Err(CliError::new(
      "ELECTRON_MBT_MIGRATE_USAGE",
      "only one app directory is accepted",
    ))
  }
  if args.positional.length() == 1 {
    args.app_dir = args.positional[0]
  }
  Ok(args)
}
