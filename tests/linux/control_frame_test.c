#include "../../platform/linux/control_frame.h"

#include <stdio.h>
#include <string.h>

static int failures = 0;

static void expect_valid(const char *label, const char *frame) {
  EbtControlFrame parsed;
  if (!ebt_control_frame_validate(frame, strlen(frame), &parsed)) {
    fprintf(stderr, "FAIL valid case rejected: %s\n", label);
    failures += 1;
    return;
  }
  if (strcmp(parsed.session, "0123456789abcdef0123456789abcdef") != 0 ||
      parsed.request != 1 || parsed.window != 1 || parsed.generation != 2) {
    fprintf(stderr, "FAIL valid case parsed wrong header: %s\n", label);
    failures += 1;
    return;
  }
  if (parsed.payload_offset == 0 || parsed.payload_length < 2) {
    fprintf(stderr, "FAIL valid case missing payload offsets: %s\n", label);
    failures += 1;
  }
}

static void expect_invalid(const char *label, const char *frame) {
  EbtControlFrame parsed;
  if (ebt_control_frame_validate(frame, strlen(frame), &parsed)) {
    fprintf(stderr, "FAIL invalid case accepted: %s\n", label);
    failures += 1;
  }
}

int main(void) {
  const char *prefix =
    "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\","
    "\"request\":1,\"window\":1,\"generation\":2,"
    "\"operation\":\"prepare-source\",\"payload\":";
  char frame[4096];

  snprintf(frame, sizeof(frame), "%s{\"file\":\"index.html\"}}", prefix);
  expect_valid("plain object", frame);

  snprintf(frame, sizeof(frame),
           "%s{\"a\":{\"b\":[1,2,{\"c\":\"x\\\\\\\"y\"}]},\"d\":\"}\"}}", prefix);
  expect_valid("nested and escaped", frame);

  snprintf(frame, sizeof(frame), "%s{}}", prefix);
  expect_valid("empty payload", frame);

  snprintf(frame, sizeof(frame), "%s{\"file\":\"index.html\"} }", prefix);
  expect_invalid("trailing space", frame);

  snprintf(frame, sizeof(frame), "%s{\"file\":\"index.html\"}} ", prefix);
  expect_invalid("trailing byte", frame);

  snprintf(frame, sizeof(frame),
           "%s{\"file\":\"index.html\"},\"request\":2}", prefix);
  expect_invalid("duplicate top-level request", frame);

  snprintf(frame, sizeof(frame),
           "{\"version\":1,\"session\":\"0123456789abcdef0123456789ABCDEF\","
           "\"request\":1,\"window\":1,\"generation\":2,"
           "\"operation\":\"prepare-source\",\"payload\":{\"file\":\"index.html\"}}");
  expect_invalid("uppercase session", frame);

  snprintf(frame, sizeof(frame),
           "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcde\","
           "\"request\":1,\"window\":1,\"generation\":2,"
           "\"operation\":\"prepare-source\",\"payload\":{\"file\":\"index.html\"}}");
  expect_invalid("short session", frame);

  snprintf(frame, sizeof(frame),
           "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\","
           "\"request\":0,\"window\":1,\"generation\":2,"
           "\"operation\":\"prepare-source\",\"payload\":{\"file\":\"index.html\"}}");
  expect_invalid("zero request", frame);

  snprintf(frame, sizeof(frame),
           "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\","
           "\"request\":01,\"window\":1,\"generation\":2,"
           "\"operation\":\"prepare-source\",\"payload\":{\"file\":\"index.html\"}}");
  expect_invalid("leading zero request", frame);

  snprintf(frame, sizeof(frame),
           "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\","
           "\"request\":1,\"window\":-1,\"generation\":2,"
           "\"operation\":\"prepare-source\",\"payload\":{\"file\":\"index.html\"}}");
  expect_invalid("negative window", frame);

  snprintf(frame, sizeof(frame),
           "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\","
           "\"request\":1,\"window\":1,\"generation\":9007199254740992,"
           "\"operation\":\"prepare-source\",\"payload\":{\"file\":\"index.html\"}}");
  expect_invalid("unsafe generation", frame);

  snprintf(frame, sizeof(frame),
           "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\","
           "\"request\":1,\"window\":1,\"generation\":2,"
           "\"operation\":\"Prepare-Source\",\"payload\":{\"file\":\"index.html\"}}");
  expect_invalid("uppercase operation", frame);

  snprintf(frame, sizeof(frame),
           "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\","
           "\"request\":1,\"window\":1,\"generation\":2,"
           "\"operation\":\"\",\"payload\":{\"file\":\"index.html\"}}");
  expect_invalid("empty operation", frame);

  snprintf(frame, sizeof(frame), "%s[]}", prefix);
  expect_invalid("array payload", frame);

  snprintf(frame, sizeof(frame), "%s{\"file\":\"index.html\"", prefix);
  expect_invalid("unclosed payload", frame);

  {
    char with_nul[256];
    size_t length = (size_t)snprintf(with_nul, sizeof(with_nul), "%s{\"file\":\"index.html\"}}", prefix);
    if (length + 2 < sizeof(with_nul)) {
      with_nul[length + 1] = 'x';
      EbtControlFrame parsed;
      if (ebt_control_frame_validate(with_nul, length + 1, &parsed)) {
        fprintf(stderr, "FAIL invalid case accepted: embedded NUL\n");
        failures += 1;
      }
    }
  }

  if (failures != 0) {
    fprintf(stderr, "control_frame: %d failure(s)\n", failures);
    return 1;
  }
  printf("control_frame: PASS\n");
  return 0;
}
