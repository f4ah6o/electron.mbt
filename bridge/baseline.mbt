///|
pub fn validate_baseline(
  raw : String,
  electron_version : String,
  node_version : String,
  fixture_hash : String,
) -> String {
  if raw.length() > 16384 ||
    electron_version.length() > 128 ||
    node_version.length() > 128 {
    return invalid_payload()
  }
  let report = @json.parse(raw) catch { _ => return invalid_payload() }
  @core.validate_baseline(
    report, electron_version, node_version, fixture_hash,
  ).stringify()
}
