///|
pub(all) enum ModuleKind {
  CommonJs
  Json
  Unsupported
} derive(Eq, Debug)

///|
pub(all) enum ModuleState {
  Loading
  Loaded
  Failed
} derive(Eq, Debug)

///|
pub(all) enum ModuleError {
  DuplicateModule
  UnknownModule
  InvalidModule
  LimitExceeded
  DependencyMissing
  InvalidState
} derive(Eq, Debug)

///|
struct ModuleRecord {
  id : String
  source_hash : String
  kind : ModuleKind
  mut state : ModuleState
  dependencies : Map[String, String]
}

///|
// Policy and admission only. The JS realm owns module.exports and function
// identity; this registry owns resolved IDs, source hashes, load state and the
// bounded module set. File I/O and Node builtin execution are separate.
pub struct ModuleRegistry {
  records : Map[String, ModuleRecord]
  order : Array[String]
  max_modules : Int32
}

///|
pub fn ModuleRegistry::new(max_modules : Int32) -> ModuleRegistry {
  {
    records: {},
    order: [],
    max_modules,
  }
}

///|
pub fn ModuleRegistry::register(
  self : ModuleRegistry,
  id : String,
  source_hash : String,
  kind : ModuleKind,
  dependencies : Map[String, String],
) -> Result[Unit, ModuleError] {
  if id.length() == 0 || source_hash.length() == 0 {
    return Err(InvalidModule)
  }
  if self.records.contains(id) {
    return Err(DuplicateModule)
  }
  if self.records.length() >= self.max_modules {
    return Err(LimitExceeded)
  }
  self.records[id] = {
    id,
    source_hash,
    kind,
    state: Loading,
    dependencies,
  }
  self.order.push(id)
  Ok(())
}

///|
pub fn ModuleRegistry::state(self : ModuleRegistry, id : String) -> Result[ModuleState, ModuleError] {
  match self.records.get(id) {
    Some(record) => Ok(record.state)
    None => Err(UnknownModule)
  }
}

///|
pub fn ModuleRegistry::finish(self : ModuleRegistry, id : String) -> Result[Unit, ModuleError] {
  match self.records.get(id) {
    None => Err(UnknownModule)
    Some(record) =>
      if record.state != Loading {
        Err(InvalidState)
      } else {
        record.state = Loaded
        Ok(())
      }
  }
}

///|
pub fn ModuleRegistry::fail(self : ModuleRegistry, id : String) -> Result[Unit, ModuleError] {
  match self.records.get(id) {
    None => Err(UnknownModule)
    Some(record) =>
      if record.state != Loading {
        Err(InvalidState)
      } else {
        record.state = Failed
        Ok(())
      }
  }
}

///|
pub fn ModuleRegistry::resolve(
  self : ModuleRegistry,
  id : String,
  specifier : String,
) -> Result[String, ModuleError] {
  match self.records.get(id) {
    None => Err(UnknownModule)
    Some(record) =>
      match record.dependencies.get(specifier) {
        Some(target) =>
          if self.records.contains(target) {
            Ok(target)
          } else {
            Err(DependencyMissing)
          }
        None => Err(DependencyMissing)
      }
  }
}

///|
pub fn ModuleRegistry::loaded_count(self : ModuleRegistry) -> Int32 {
  let mut count = 0
  for id in self.order {
    match self.records.get(id) {
      Some(record) =>
        if record.state == Loaded {
          count += 1
        }
      None => ()
    }
  }
  count
}

///|
pub fn ModuleRegistry::order(self : ModuleRegistry) -> Array[String] {
  self.order.copy()
}
