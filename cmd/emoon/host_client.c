#include "moonbit.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <mach-o/dyld.h>
#endif
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;
extern void moonbit_emb_register_host_request(void *fn);

static pid_t child_pid = -1;
static int control_fd = -1;
static int load_fd = -1;
static int event_fd = -1;
static char session_text[33];
static char *app_root = NULL;
static int request_id = 1;
// The Node-less runtime currently exposes one main window. Keep the identity
// here so every control frame and the MoonBit event pump use the same
// generation. A fixed generation of 1 made reloads invisible and let stale
// events look current.
static int active_window = 0;
static long long active_generation = 0;
static int active_window_created = 0;

static char *copy_bytes(moonbit_bytes_t bytes) {
  if (bytes == NULL) return NULL;
  int32_t length = Moonbit_array_length(bytes);
  if (length <= 0 || length > 8192) return NULL;
  char *text = (char *)malloc((size_t)length + 1);
  if (text == NULL) return NULL;
  memcpy(text, bytes, (size_t)length);
  text[length] = 0;
  return text;
}

static int write_all(int fd, const void *buffer, size_t length) {
  const unsigned char *cursor = (const unsigned char *)buffer;
  while (length > 0) {
    ssize_t written = write(fd, cursor, length);
    if (written < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    if (written == 0) return -1;
    cursor += written;
    length -= (size_t)written;
  }
  return 0;
}

static int read_all(int fd, void *buffer, size_t length) {
  unsigned char *cursor = (unsigned char *)buffer;
  while (length > 0) {
    ssize_t count = read(fd, cursor, length);
    if (count < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    if (count == 0) return -1;
    cursor += count;
    length -= (size_t)count;
  }
  return 0;
}

static int write_frame(int fd, const char *data, int32_t length) {
  if (fd < 0 || data == NULL || length <= 0 || length > 1048576) return -1;
  uint32_t header = htonl((uint32_t)length);
  if (write_all(fd, &header, sizeof(header)) != 0) return -1;
  return write_all(fd, data, (size_t)length) == 0 ? 0 : -1;
}

static int read_frame(int fd, char *out, int32_t capacity, int32_t timeout_ms) {
  if (fd < 0 || out == NULL || capacity <= 0) return -1;
  struct pollfd pollfd = {.fd = fd, .events = POLLIN};
  int ready;
  do { ready = poll(&pollfd, 1, timeout_ms); } while (ready < 0 && errno == EINTR);
  if (ready <= 0 || !(pollfd.revents & POLLIN)) return -1;
  uint32_t header = 0;
  if (read_all(fd, &header, sizeof(header)) != 0) return -1;
  uint32_t length = ntohl(header);
  if (length == 0 || length >= (uint32_t)capacity) return -1;
  if (read_all(fd, out, length) != 0) return -1;
  out[length] = 0;
  return (int32_t)length;
}

static int start_host(const char *binary, const char *root, const char *session) {
  if (child_pid > 0 || binary == NULL || root == NULL || session == NULL ||
      strlen(session) != 32) return -1;
  /* The host can close its control/event channels before an in-flight reply
   * is written (for example when a window is closed while a modal dialog is
   * open). A bare write() must fail with EPIPE and become host-loss, not
   * terminate the whole runtime with SIGPIPE. */
  signal(SIGPIPE, SIG_IGN);
  char *canonical_root = realpath(root, NULL);
  if (canonical_root == NULL) return -1;
  struct stat info;
  if (stat(canonical_root, &info) != 0 || !S_ISDIR(info.st_mode)) {
    free(canonical_root);
    return -1;
  }
  int control[2] = {-1, -1};
  int load[2] = {-1, -1};
  int events[2] = {-1, -1};
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, control) != 0 ||
      socketpair(AF_UNIX, SOCK_STREAM, 0, load) != 0 ||
      socketpair(AF_UNIX, SOCK_STREAM, 0, events) != 0) {
    goto fail;
  }
  posix_spawn_file_actions_t actions;
  if (posix_spawn_file_actions_init(&actions) != 0) goto fail;
  int targets[3] = {3, 4, 5};
  int children[3] = {control[1], load[1], events[1]};
  int failed = 0;
  for (int i = 0; i < 3; i++) {
    if (posix_spawn_file_actions_adddup2(&actions, children[i], targets[i]) != 0) failed = 1;
  }
  int all[6] = {control[0], control[1], load[0], load[1], events[0], events[1]};
  for (int i = 0; i < 6; i++) {
    int fd = all[i];
    if (fd != 3 && fd != 4 && fd != 5 &&
        posix_spawn_file_actions_addclose(&actions, fd) != 0) failed = 1;
  }
  if (failed) {
    posix_spawn_file_actions_destroy(&actions);
    goto fail;
  }
  if (setenv("ELECTRON_MBT_HOST_SESSION", session, 1) != 0) {
    posix_spawn_file_actions_destroy(&actions);
    goto fail;
  }
  char *argv[3] = {(char *)binary, (char *)canonical_root, NULL};
  pid_t pid = -1;
  int spawned = posix_spawn(&pid, binary, &actions, NULL, argv, environ);
  unsetenv("ELECTRON_MBT_HOST_SESSION");
  posix_spawn_file_actions_destroy(&actions);
  if (spawned != 0 || pid <= 0) goto fail;
  close(control[1]); control[1] = -1;
  close(load[1]); load[1] = -1;
  close(events[1]); events[1] = -1;
  child_pid = pid;
  control_fd = control[0];
  load_fd = load[0];
  event_fd = events[0];
  free(app_root);
  app_root = strdup(canonical_root);
  free(canonical_root);
  return control_fd;
fail:
  if (control[0] >= 0) close(control[0]);
  if (control[1] >= 0) close(control[1]);
  if (load[0] >= 0) close(load[0]);
  if (load[1] >= 0) close(load[1]);
  if (events[0] >= 0) close(events[0]);
  if (events[1] >= 0) close(events[1]);
  free(canonical_root);
  return -1;
}

// A user-driven open panel can legitimately stay on screen much longer than a
// normal control request. The native host uses the same one-hour bound.
static const int32_t kMainDialogWaitMs = 3600000;

static int send_control_frame_timeout(const char *operation, const char *payload,
                                      int window, long long generation,
                                      char *out, int32_t capacity,
                                      int32_t timeout_ms) {
  if (control_fd < 0 || operation == NULL || payload == NULL) return -1;
  int id = request_id++;
  size_t needed = strlen(session_text) + strlen(operation) + strlen(payload) + 256;
  char *frame = (char *)malloc(needed);
  if (frame == NULL) return -1;
  int written = snprintf(frame, needed,
    "{\"version\":1,\"session\":\"%s\",\"request\":%d,\"window\":%d,\"generation\":%lld,"
    "\"operation\":\"%s\",\"payload\":%s}",
    session_text, id, window, generation, operation, payload);
  if (written <= 0 || (size_t)written >= needed) {
    free(frame);
    return -1;
  }
  int result = write_frame(control_fd, frame, (int32_t)written);
  free(frame);
  if (result != 0) return -1;
  return read_frame(control_fd, out, capacity, timeout_ms);
}

static int send_control_frame(const char *operation, const char *payload,
                              int window, long long generation,
                              char *out, int32_t capacity) {
  return send_control_frame_timeout(operation, payload, window, generation,
                                    out, capacity, 15000);
}

static int send_control(const char *operation, const char *payload,
                        char *out, int32_t capacity) {
  return send_control_frame(operation, payload, active_window, active_generation,
                            out, capacity);
}

static int send_load(const char *operation, const char *payload,
                     char *out, int32_t capacity) {
  if (load_fd < 0 || operation == NULL || payload == NULL) return -1;
  int id = request_id++;
  size_t needed = strlen(session_text) + strlen(operation) + strlen(payload) + 256;
  char *frame = (char *)malloc(needed);
  if (frame == NULL) return -1;
  int written = snprintf(frame, needed,
    "{\"version\":1,\"session\":\"%s\",\"request\":%d,\"window\":%d,\"generation\":%lld,"
    "\"operation\":\"%s\",\"payload\":%s}",
    session_text, id, active_window, active_generation, operation, payload);
  if (written <= 0 || (size_t)written >= needed) {
    free(frame);
    return -1;
  }
  int result = write_frame(load_fd, frame, (int32_t)written);
  free(frame);
  if (result != 0) return -1;
  return read_frame(load_fd, out, capacity, 15000);
}

static int contains_success(const char *text) {
  return text != NULL && strstr(text, "\"terminal\":\"success\"") != NULL;
}

static int begin_navigation(void) {
  if (!active_window_created || active_window <= 0) return -1;
  if (active_generation < 0 || active_generation >= 9007199254740991LL) return -1;
  long long next = active_generation + 1;
  char reply[4096];
  int length = send_control_frame("begin-load", "{}", active_window, next,
                                  reply, (int32_t)sizeof(reply));
  if (length < 0 || !contains_success(reply)) return -1;
  active_generation = next;
  return 0;
}

static int ebt_host_request(const char *operation, const char *payload,
                            char *out, int32_t capacity) {
  if (control_fd < 0 || operation == NULL || payload == NULL ||
      out == NULL || capacity <= 0) return -1;
  if (strcmp(operation, "main-open-dialog") == 0 ||
      strcmp(operation, "main-save-dialog") == 0) {
    // The payload carries the parent window (0 means parentless); the header
    // window is unused by these host operations. Keep the longer
    // user-interaction timeout aligned with the native host's semaphore.
    return send_control_frame_timeout(operation, payload, 0, 0, out, capacity,
                                      kMainDialogWaitMs);
  }
  if (strcmp(operation, "load-file") == 0) {
    if (begin_navigation() != 0) return -1;
    // The prelude passes an app-relative or absolute file. The host accepts a
    // canonical source path, so resolve a relative file against the app root.
    const char *key = "\"file\":\"";
    const char *start = strstr(payload, key);
    if (start == NULL || app_root == NULL) return -1;
    start += strlen(key);
    const char *end = strchr(start, '"');
    if (end == NULL || end == start) return -1;
    size_t file_length = (size_t)(end - start);
    char *file = (char *)malloc(file_length + 1);
    if (file == NULL) return -1;
    memcpy(file, start, file_length);
    file[file_length] = 0;
    char *absolute = NULL;
    if (file[0] == '/') {
      absolute = strdup(file);
    } else {
      size_t needed = strlen(app_root) + file_length + 2;
      absolute = (char *)malloc(needed);
      if (absolute != NULL) snprintf(absolute, needed, "%s/%s", app_root, file);
    }
    free(file);
    if (absolute == NULL) return -1;
    size_t payload_size = strlen(absolute) + 32;
    char *resolved = (char *)malloc(payload_size);
    if (resolved == NULL) { free(absolute); return -1; }
    snprintf(resolved, payload_size, "{\"file\":\"%s\"}", absolute);
    free(absolute);
    int result = send_load(operation, resolved, out, capacity);
    free(resolved);
    return result;
  }
  if (strcmp(operation, "load-app-file") == 0) {
    if (begin_navigation() != 0) return -1;
    return send_load(operation, payload, out, capacity);
  }
  if (strcmp(operation, "create-window") == 0) {
    // The Node-less runtime currently supports one main window. A second
    // create must not silently reuse window 1 with a stale generation.
    if (active_window_created) return -1;
    int result = send_control_frame(operation, payload, 1, 0, out, capacity);
    if (result > 0 && contains_success(out)) {
      active_window = 1;
      active_generation = 0;
      active_window_created = 1;
    }
    return result;
  }
  if (strcmp(operation, "prepare-source") == 0 ||
      strcmp(operation, "install-adapted-adapter") == 0) {
    return send_control_frame(operation, payload, active_window, active_generation,
                              out, capacity);
  }
  if (strcmp(operation, "destroy-window") == 0) {
    int result = send_control_frame(operation, payload, active_window, active_generation,
                                    out, capacity);
    if (result > 0 && contains_success(out)) {
      active_window_created = 0;
      active_window = 0;
      active_generation = 0;
    }
    return result;
  }
  if (strcmp(operation, "get-window-title") == 0 ||
      strcmp(operation, "set-window-title") == 0 ||
      strcmp(operation, "get-web-contents-title") == 0 ||
      strcmp(operation, "get-web-contents-url") == 0 ||
      strcmp(operation, "get-bootstrap-status") == 0 ||
      strcmp(operation, "get-preload-status") == 0 ||
      strcmp(operation, "get-adapted-status") == 0 ||
      strcmp(operation, "get-document-identity") == 0 ||
      strcmp(operation, "get-ingress-status") == 0 ||
      strcmp(operation, "inject-app-request") == 0 ||
      strcmp(operation, "grant-file") == 0 ||
      strcmp(operation, "set-dialog-result") == 0 ||
      strcmp(operation, "set-main-dialog-results") == 0 ||
      strcmp(operation, "get-main-dialog-status") == 0 ||
      strcmp(operation, "set-main-save-dialog-results") == 0 ||
      strcmp(operation, "get-main-save-dialog-status") == 0 ||
      strcmp(operation, "release-adapted-ingress") == 0 ||
      strcmp(operation, "trigger-renderer-api") == 0 ||
      strcmp(operation, "trigger-renderer-edit-save") == 0 ||
      strcmp(operation, "trigger-renderer-export-ui") == 0 ||
      strcmp(operation, "probe-renderer") == 0 ||
      strcmp(operation, "app-reply") == 0 ||
      strcmp(operation, "main-stat") == 0 ||
      strcmp(operation, "main-read-file") == 0 ||
      strcmp(operation, "main-write-file") == 0 ||
      strcmp(operation, "main-read-dir") == 0 ||
      strcmp(operation, "main-mkdir") == 0 ||
      strcmp(operation, "main-rename") == 0 ||
      strcmp(operation, "main-unlink") == 0 ||
      strcmp(operation, "main-write-at") == 0 ||
      strcmp(operation, "zlib-deflate-start") == 0 ||
      strcmp(operation, "zlib-deflate-write") == 0 ||
      strcmp(operation, "zlib-deflate-end") == 0 ||
      strcmp(operation, "zlib-deflate-abort") == 0 ||
      strcmp(operation, "send-adapted-event") == 0 ||
      strcmp(operation, "create-export-window") == 0 ||
      strcmp(operation, "resize-export-window") == 0 ||
      strcmp(operation, "export-capture-page") == 0 ||
      strcmp(operation, "export-capture-read") == 0 ||
      strcmp(operation, "load-export-file") == 0 ||
      strcmp(operation, "export-execute-js") == 0 ||
      strcmp(operation, "export-print-pdf") == 0 ||
      strcmp(operation, "destroy-export-window") == 0) {
    return send_control_frame(operation, payload, active_window, active_generation,
                              out, capacity);
  }
  if (strcmp(operation, "get-window-state") == 0) {
    return send_control_frame(operation, payload, 0, 0, out, capacity);
  }
  if (strcmp(operation, "simulate-window-close") == 0) {
    return send_control_frame(operation, payload, 0, 0, out, capacity);
  }
  if (strcmp(operation, "grant-main-file") == 0 ||
      strcmp(operation, "grant-main-directory") == 0 ||
      strcmp(operation, "get-main-grant-store") == 0 ||
      strcmp(operation, "revoke-main-grant") == 0) {
    return send_control_frame(operation, payload, 0, 0, out, capacity);
  }
  if (strcmp(operation, "set-asset-schemes") == 0 ||
      strcmp(operation, "get-asset-status") == 0) {
    return send_control_frame(operation, payload, 0, 0, out, capacity);
  }
  if (strcmp(operation, "shutdown") == 0) {
    return send_control_frame(operation, payload, 0, 0, out, capacity);
  }
  return -1;
}

// QuickJS app code shares the private host channel with the MoonBit CLI, but it
// must not be able to mint grants or drive host/test control operations. Use an
// explicit allowlist rather than a deny list so a future control operation is
// closed to app code by default. The CLI keeps the full ebt_host_request path.
static int js_host_operation_allowed(const char *operation) {
  static const char *const allowed[] = {
    "create-window",
    "prepare-source",
    "install-adapted-adapter",
    "load-file",
    "load-app-file",
    "get-window-title",
    "set-window-title",
    "get-web-contents-title",
    "get-web-contents-url",
    "destroy-window",
    "main-stat",
    "main-read-file",
    "main-write-file",
    "main-rename",
    "main-unlink",
    "main-write-at",
    "zlib-deflate-start",
    "zlib-deflate-write",
    "zlib-deflate-end",
    "zlib-deflate-abort",
    "main-read-dir",
    "main-mkdir",
    "main-open-dialog",
    "send-adapted-event",
    "create-export-window",
    "resize-export-window",
    "export-capture-page",
    "export-capture-read",
    "load-export-file",
    "export-execute-js",
    "export-print-pdf",
    "destroy-export-window",
    "main-save-dialog",
    NULL
  };
  for (int i = 0; allowed[i] != NULL; i++) {
    if (strcmp(operation, allowed[i]) == 0) return 1;
  }
  return 0;
}

static int ebt_js_host_request(const char *operation, const char *payload,
                               char *out, int32_t capacity) {
  if (operation == NULL || payload == NULL || out == NULL || capacity <= 0) return -1;
  if (!js_host_operation_allowed(operation)) {
    static const char denied[] =
      "{\"terminal\":\"failure\",\"payload\":{\"code\":\"ELECTRON_MBT_HOST_REQUEST_DENIED\"}}";
    size_t length = sizeof(denied) - 1;
    if ((size_t)capacity <= length) return -1;
    memcpy(out, denied, length);
    out[length] = 0;
    return (int32_t)length;
  }
  return ebt_host_request(operation, payload, out, capacity);
}

// A CI-only override lets the UI smoke select the auto-cancel host build.
// Accept only a repository-relative dist/ path under an explicit test mode, so
// an ordinary app launch cannot point the runtime at an arbitrary executable.
static char same_directory_host[4096];

static const char *same_directory_host_path(void) {
  same_directory_host[0] = 0;
#if defined(__APPLE__)
  uint32_t size = (uint32_t)sizeof(same_directory_host);
  if (_NSGetExecutablePath(same_directory_host, &size) != 0) return NULL;
#elif defined(__linux__)
  ssize_t length = readlink("/proc/self/exe", same_directory_host,
                            sizeof(same_directory_host) - 1);
  if (length <= 0 || (size_t)length >= sizeof(same_directory_host)) return NULL;
  same_directory_host[length] = 0;
#else
  return NULL;
#endif
  char *slash = strrchr(same_directory_host, '/');
  if (slash == NULL) return NULL;
  *slash = 0;
  size_t used = strlen(same_directory_host);
  const char suffix[] = "/emoon-host";
  if (used + sizeof(suffix) > sizeof(same_directory_host)) return NULL;
  memcpy(same_directory_host + used, suffix, sizeof(suffix));
  if (access(same_directory_host, X_OK) != 0) return NULL;
  return same_directory_host;
}

// Look for an installed `emoon-host` after the sibling layout. Only absolute
// PATH entries are accepted so a relative `.` entry cannot silently resolve a
// host from the current app directory. The host is user-installed tooling, the
// same trust level as `emoon` itself, and the bundle launcher always sets
// EMOON_HOST so an app cannot redirect it.
static char path_host[4096];

static const char *path_host_path(void) {
  const char *path = getenv("PATH");
  if (path == NULL) return NULL;
  const char *cursor = path;
  int entries = 0;
  while (entries < 64) {
    const char *end = strchr(cursor, ':');
    size_t length = end == NULL ? strlen(cursor) : (size_t)(end - cursor);
    if (length > 0 && length < sizeof(path_host) - 12 && cursor[0] == '/') {
      int written = snprintf(path_host, sizeof(path_host),
                             "%.*s/emoon-host", (int)length, cursor);
      if (written > 0 && (size_t)written < sizeof(path_host) &&
          access(path_host, X_OK) == 0) {
        return path_host;
      }
    }
    if (end == NULL) break;
    cursor = end + 1;
    entries++;
  }
  return NULL;
}

// A launch-time override is user-controlled: the app bundle cannot set the
// environment of the process that spawns the host. The test-only override
// remains restricted to repository-relative dist/ paths.
static const char *host_binary_path(void) {
  const char *explicit = getenv("EMOON_HOST");
  if (explicit != NULL && explicit[0] != 0 && strlen(explicit) < 4096) return explicit;
  const char *test = getenv("ELECTRON_MBT_TEST_NATIVE_HOST");
  const char *mode = getenv("ELECTRON_MBT_TEST_MODE");
  if (test != NULL && mode != NULL && strcmp(mode, "1") == 0 &&
      test[0] != 0 && strlen(test) <= 256 &&
      strncmp(test, "dist/", 5) == 0 && strstr(test, "..") == NULL) {
    return test;
  }
  const char *same = same_directory_host_path();
  if (same != NULL) return same;
  if (access("dist/emoon-host", X_OK) == 0) return "dist/emoon-host";
  const char *installed = path_host_path();
  if (installed != NULL) return installed;
  return "dist/emoon-host";
}

int32_t moonbit_ebt_bundle_default_host(moonbit_bytes_t out, int32_t capacity) {
  const char *path = host_binary_path();
  if (path == NULL || out == NULL || capacity <= 0 ||
      Moonbit_array_length(out) < capacity) return -1;
  size_t length = strlen(path);
  if (length + 1 > (size_t)capacity) return -1;
  memcpy(out, path, length);
  out[length] = 0;
  return (int32_t)length;
}

int32_t moonbit_ebt_nodeless_host_open(moonbit_bytes_t root_bytes) {
  char *root = copy_bytes(root_bytes);
  if (root == NULL) return -1;
  active_window = 0;
  active_generation = 0;
  active_window_created = 0;
  static const char hex[] = "0123456789abcdef";
  unsigned char random[16];
  arc4random_buf(random, sizeof(random));
  for (int i = 0; i < 16; i++) {
    session_text[i * 2] = hex[(random[i] >> 4) & 0xf];
    session_text[i * 2 + 1] = hex[random[i] & 0xf];
  }
  session_text[32] = 0;
  int fd = start_host(host_binary_path(), root, session_text);
  free(root);
  if (fd < 0) return -1;
  char reply[65536];
  int hello = send_control_frame("hello", "{}", 0, 0, reply, (int32_t)sizeof(reply));
  int ready = hello > 0 ? send_control_frame("ready", "{}", 0, 0, reply, (int32_t)sizeof(reply)) : -1;
  if (hello <= 0 || ready <= 0 || !contains_success(reply)) {
    return -1;
  }
  moonbit_emb_register_host_request((void *)ebt_js_host_request);
  return fd;
}

int32_t moonbit_ebt_nodeless_host_query(
    moonbit_bytes_t operation_bytes,
    moonbit_bytes_t payload_bytes,
    moonbit_bytes_t out,
    int32_t capacity) {
  if (out == NULL || capacity <= 0 || Moonbit_array_length(out) < capacity) return -1;
  char *operation = copy_bytes(operation_bytes);
  char *payload = copy_bytes(payload_bytes);
  if (operation == NULL || payload == NULL) {
    free(operation); free(payload);
    return -1;
  }
  int32_t length = ebt_host_request(operation, payload, (char *)out, capacity);
  free(operation); free(payload);
  return length;
}

int32_t moonbit_ebt_nodeless_host_session(moonbit_bytes_t out, int32_t capacity) {
  if (out == NULL || capacity < 33 || Moonbit_array_length(out) < capacity) return -1;
  memcpy(out, session_text, 33);
  return 32;
}

int32_t moonbit_ebt_nodeless_host_next_event(
    moonbit_bytes_t out,
    int32_t capacity,
    int32_t timeout_ms) {
  if (out == NULL || capacity <= 0 || Moonbit_array_length(out) < capacity ||
      timeout_ms < 0 || timeout_ms > 60000) return -1;
  return read_frame(event_fd, (char *)out, capacity, timeout_ms);
}

void moonbit_ebt_nodeless_sleep_ms(int32_t duration_ms) {
  if (duration_ms <= 0 || duration_ms > 1000) return;
  usleep((useconds_t)duration_ms * 1000);
}

int32_t moonbit_ebt_nodeless_host_pid(void) {
  return (int32_t)child_pid;
}

int32_t moonbit_ebt_nodeless_host_identity(moonbit_bytes_t out, int32_t capacity) {
  if (out == NULL || capacity <= 0 || Moonbit_array_length(out) < capacity) return -1;
  int written = snprintf((char *)out, (size_t)capacity,
    "{\"window\":%d,\"generation\":%lld}", active_window, active_generation);
  if (written <= 0 || written >= capacity) return -1;
  return (int32_t)written;
}

int32_t moonbit_ebt_nodeless_host_shutdown(void) {
  char reply[65536];
  if (control_fd >= 0) {
    if (active_window_created) {
      int _ = send_control_frame("destroy-window", "{}", active_window,
                                 active_generation, reply, (int32_t)sizeof(reply));
      (void)_;
      active_window_created = 0;
      active_window = 0;
      active_generation = 0;
    }
    int __ = send_control_frame("shutdown", "{}", 0, 0, reply, (int32_t)sizeof(reply));
    (void)__;
  }
  if (control_fd >= 0) { close(control_fd); control_fd = -1; }
  if (load_fd >= 0) { close(load_fd); load_fd = -1; }
  if (event_fd >= 0) { close(event_fd); event_fd = -1; }
  if (child_pid <= 0) return 0;
  int status = 0;
  for (int i = 0; i < 500; i++) {
    pid_t waited = waitpid(child_pid, &status, WNOHANG);
    if (waited == child_pid) { child_pid = -1; return 0; }
    if (waited < 0) break;
    usleep(10000);
  }
  kill(child_pid, SIGKILL);
  waitpid(child_pid, &status, 0);
  child_pid = -1;
  return -1;
}

void moonbit_ebt_nodeless_host_kill(void) {
  if (child_pid > 0) {
    kill(child_pid, SIGKILL);
    waitpid(child_pid, NULL, 0);
    child_pid = -1;
  }
  if (control_fd >= 0) { close(control_fd); control_fd = -1; }
  if (load_fd >= 0) { close(load_fd); load_fd = -1; }
  if (event_fd >= 0) { close(event_fd); event_fd = -1; }
  active_window = 0;
  active_generation = 0;
  active_window_created = 0;
}
