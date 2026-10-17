///|
pub fn validate_profile(
  raw : String,
  requested : String,
  input_mode : String,
  preload_mode : String,
  runtime : String,
) -> String {
  if raw.length() > 16384 ||
    requested.length() > 128 ||
    input_mode.length() > 128 ||
    preload_mode.length() > 128 ||
    runtime.length() > 128 {
    return "{\"ok\":false,\"code\":\"InvalidPayload\",\"compatible\":false}"
  }
  let config = @json.parse(raw) catch {
    _ => return "{\"ok\":false,\"code\":\"InvalidPayload\",\"compatible\":false}"
  }
  @core.validate_profile(
    config, requested, input_mode, preload_mode, runtime,
  ).stringify()
}
