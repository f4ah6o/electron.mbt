#include "control_frame.h"

#include <string.h>

#define EBT_MAX_SAFE_INTEGER 9007199254740991LL

static int is_lower_hex(char c) {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
}

static int is_digit(char c) { return c >= '0' && c <= '9'; }

static int match_literal(const char *data, size_t length, size_t *cursor,
                         const char *literal) {
  size_t literal_length = strlen(literal);
  if (*cursor > length || literal_length > length - *cursor) return 0;
  if (memcmp(data + *cursor, literal, literal_length) != 0) return 0;
  *cursor += literal_length;
  return 1;
}

static int parse_unsigned(const char *data, size_t length, size_t *cursor,
                          int64_t *out) {
  size_t start = *cursor;
  if (start >= length || !is_digit(data[start])) return 0;
  if (data[start] == '0') {
    *cursor += 1;
    if (*cursor < length && is_digit(data[*cursor])) return 0;
    *out = 0;
    return 1;
  }
  int64_t value = 0;
  size_t digits = 0;
  while (*cursor < length && is_digit(data[*cursor])) {
    if (++digits > 16) return 0;
    value = value * 10 + (data[*cursor] - '0');
    if (value > EBT_MAX_SAFE_INTEGER) return 0;
    *cursor += 1;
  }
  *out = value;
  return 1;
}

int ebt_control_frame_validate(const char *data, size_t length,
                               EbtControlFrame *out) {
  if (data == NULL || out == NULL || length < 2 || length > 1048576) return 0;
  if (memchr(data, 0, length) != NULL) return 0;
  memset(out, 0, sizeof(*out));

  size_t cursor = 0;
  if (!match_literal(data, length, &cursor, "{\"version\":1,\"session\":\"")) return 0;
  if (cursor + 32 > length) return 0;
  for (size_t index = 0; index < 32; index++) {
    if (!is_lower_hex(data[cursor + index])) return 0;
    out->session[index] = data[cursor + index];
  }
  out->session[32] = 0;
  cursor += 32;
  if (!match_literal(data, length, &cursor, "\",\"request\":")) return 0;
  if (!parse_unsigned(data, length, &cursor, &out->request)) return 0;
  if (out->request <= 0) return 0;
  if (!match_literal(data, length, &cursor, ",\"window\":")) return 0;
  if (!parse_unsigned(data, length, &cursor, &out->window)) return 0;
  if (!match_literal(data, length, &cursor, ",\"generation\":")) return 0;
  if (!parse_unsigned(data, length, &cursor, &out->generation)) return 0;
  if (!match_literal(data, length, &cursor, ",\"operation\":\"")) return 0;
  size_t operation_start = cursor;
  while (cursor < length) {
    char c = data[cursor];
    if (c == '"') break;
    if (!((c >= 'a' && c <= 'z') || c == '-')) return 0;
    if (cursor - operation_start >= 128) return 0;
    cursor += 1;
  }
  if (cursor >= length || data[cursor] != '"' || cursor == operation_start) return 0;
  size_t operation_length = cursor - operation_start;
  memcpy(out->operation, data + operation_start, operation_length);
  out->operation[operation_length] = 0;
  cursor += 1;
  if (!match_literal(data, length, &cursor, ",\"payload\":")) return 0;
  if (cursor >= length || data[cursor] != '{') return 0;
  size_t payload_start = cursor;
  int depth = 1;
  int in_string = 0;
  int escaped = 0;
  cursor += 1;
  for (; cursor < length; cursor++) {
    unsigned char c = (unsigned char)data[cursor];
    if (in_string) {
      if (escaped) {
        escaped = 0;
      } else if (c == '\\') {
        escaped = 1;
      } else if (c == '"') {
        in_string = 0;
      }
      continue;
    }
    if (c == '"') {
      in_string = 1;
      continue;
    }
    if (c == '{' || c == '[') {
      depth += 1;
    } else if (c == '}' || c == ']') {
      depth -= 1;
      if (depth < 0) return 0;
      if (depth == 0) {
        if (!(c == '}')) return 0;
        out->payload_offset = payload_start;
        out->payload_length = cursor - payload_start + 1;
        /* The payload object is the final member; the frame closes it. */
        return cursor + 2 == length && data[cursor + 1] == '}';
      }
    }
  }
  return 0;
}
