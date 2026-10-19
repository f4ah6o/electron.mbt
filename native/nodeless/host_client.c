#include "moonbit.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
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

static int send_control_frame(const char *operation, const char *payload,
                              int window, int generation,
                              char *out, int32_t capacity) {
  if (control_fd < 0 || operation == NULL || payload == NULL) return -1;
  int id = request_id++;
  size_t needed = strlen(session_text) + strlen(operation) + strlen(payload) + 256;
  char *frame = (char *)malloc(needed);
  if (frame == NULL) return -1;
  int written = snprintf(frame, needed,
    "{\"version\":1,\"session\":\"%s\",\"request\":%d,\"window\":%d,\"generation\":%d,"
    "\"operation\":\"%s\",\"payload\":%s}",
    session_text, id, window, generation, operation, payload);
  if (written <= 0 || (size_t)written >= needed) {
    free(frame);
    return -1;
  }
  int result = write_frame(control_fd, frame, (int32_t)written);
  free(frame);
  if (result != 0) return -1;
  return read_frame(control_fd, out, capacity, 15000);
}

static int send_control(const char *operation, const char *payload,
                        char *out, int32_t capacity) {
  return send_control_frame(operation, payload, 1, 1, out, capacity);
}

static int send_load(const char *operation, const char *payload,
                     char *out, int32_t capacity) {
  if (load_fd < 0 || operation == NULL || payload == NULL) return -1;
  int id = request_id++;
  size_t needed = strlen(session_text) + strlen(operation) + strlen(payload) + 256;
  char *frame = (char *)malloc(needed);
  if (frame == NULL) return -1;
  int written = snprintf(frame, needed,
    "{\"version\":1,\"session\":\"%s\",\"request\":%d,\"window\":1,\"generation\":1,"
    "\"operation\":\"%s\",\"payload\":%s}",
    session_text, id, operation, payload);
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

static int ebt_host_request(const char *operation, const char *payload,
                            char *out, int32_t capacity) {
  if (control_fd < 0 || operation == NULL || payload == NULL ||
      out == NULL || capacity <= 0) return -1;
  if (strcmp(operation, "load-file") == 0) {
    char begin[4096];
    int begin_length = send_control_frame("begin-load", "{}", 1, 1, begin, (int32_t)sizeof(begin));
    if (begin_length < 0 || !contains_success(begin)) return -1;
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
    char begin[4096];
    int begin_length = send_control_frame("begin-load", "{}", 1, 1, begin, (int32_t)sizeof(begin));
    if (begin_length < 0 || !contains_success(begin)) return -1;
    return send_load(operation, payload, out, capacity);
  }
  if (strcmp(operation, "prepare-source") == 0 ||
      strcmp(operation, "install-adapted-adapter") == 0 ||
      strcmp(operation, "create-window") == 0 ||
      strcmp(operation, "get-window-title") == 0 ||
      strcmp(operation, "set-window-title") == 0 ||
      strcmp(operation, "destroy-window") == 0) {
    return send_control_frame(operation, payload, 1, 0, out, capacity);
  }
  if (strcmp(operation, "get-web-contents-title") == 0 ||
      strcmp(operation, "get-web-contents-url") == 0 ||
      strcmp(operation, "get-bootstrap-status") == 0 ||
      strcmp(operation, "get-preload-status") == 0 ||
      strcmp(operation, "get-adapted-status") == 0 ||
      strcmp(operation, "get-ingress-status") == 0 ||
      strcmp(operation, "grant-file") == 0 ||
      strcmp(operation, "set-dialog-result") == 0 ||
      strcmp(operation, "release-adapted-ingress") == 0 ||
      strcmp(operation, "trigger-renderer-api") == 0 ||
      strcmp(operation, "probe-renderer") == 0 ||
      strcmp(operation, "app-reply") == 0) {
    return send_control_frame(operation, payload, 1, 1, out, capacity);
  }
  if (strcmp(operation, "shutdown") == 0) {
    return send_control_frame(operation, payload, 0, 0, out, capacity);
  }
  return -1;
}

int32_t moonbit_ebt_nodeless_host_open(moonbit_bytes_t root_bytes) {
  char *root = copy_bytes(root_bytes);
  if (root == NULL) return -1;
  static const char hex[] = "0123456789abcdef";
  unsigned char random[16];
  arc4random_buf(random, sizeof(random));
  for (int i = 0; i < 16; i++) {
    session_text[i * 2] = hex[(random[i] >> 4) & 0xf];
    session_text[i * 2 + 1] = hex[random[i] & 0xf];
  }
  session_text[32] = 0;
  int fd = start_host("dist/electron-mbt-native-host", root, session_text);
  free(root);
  if (fd < 0) return -1;
  char reply[65536];
  int hello = send_control_frame("hello", "{}", 0, 0, reply, (int32_t)sizeof(reply));
  int ready = hello > 0 ? send_control_frame("ready", "{}", 0, 0, reply, (int32_t)sizeof(reply)) : -1;
  if (hello <= 0 || ready <= 0 || !contains_success(reply)) {
    return -1;
  }
  moonbit_emb_register_host_request((void *)ebt_host_request);
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

int32_t moonbit_ebt_nodeless_host_shutdown(void) {
  char reply[65536];
  if (control_fd >= 0) {
    int _ = send_control_frame("destroy-window", "{}", 1, 0, reply, (int32_t)sizeof(reply));
    (void)_;
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
}
