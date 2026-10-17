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
#include <unistd.h>

extern char **environ;

static pid_t child_pid = -1;
static int control_fd = -1;
static int load_fd = -1;
static int event_fd = -1;
static char *supervisor_root = NULL;

static char *copy_bytes(moonbit_bytes_t bytes) {
  if (bytes == NULL) return NULL;
  int32_t length = Moonbit_array_length(bytes);
  if (length <= 0 || length > 4096) return NULL;
  char *text = (char *)malloc((size_t)length + 1);
  if (text == NULL) return NULL;
  memcpy(text, bytes, (size_t)length);
  text[length] = '\0';
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
    ssize_t read_count = read(fd, cursor, length);
    if (read_count < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    if (read_count == 0) return -1;
    cursor += read_count;
    length -= (size_t)read_count;
  }
  return 0;
}

static int close_pair(int pair[2]) {
  int result = 0;
  if (pair[0] >= 0 && close(pair[0]) != 0) result = -1;
  if (pair[1] >= 0 && close(pair[1]) != 0) result = -1;
  pair[0] = -1;
  pair[1] = -1;
  return result;
}

int32_t moonbit_ebt_supervisor_start(
    moonbit_bytes_t binary_bytes,
    moonbit_bytes_t root_bytes,
    moonbit_bytes_t session_bytes) {
  if (child_pid > 0) return -1;
  char *binary = copy_bytes(binary_bytes);
  char *root = copy_bytes(root_bytes);
  char *session = copy_bytes(session_bytes);
  if (binary == NULL || root == NULL || session == NULL || strlen(session) != 32) {
    free(binary); free(root); free(session);
    return -1;
  }
  const char *env_binary = getenv("ELECTRON_MBT_SUPERVISOR_BINARY");
  if (env_binary != NULL && env_binary[0] != '\0') {
    char *replacement = strdup(env_binary);
    if (replacement == NULL) { free(binary); free(root); free(session); return -1; }
    free(binary); binary = replacement;
  }
  const char *env_root = getenv("ELECTRON_MBT_SUPERVISOR_ROOT");
  if (env_root != NULL && env_root[0] != '\0') {
    char *replacement = strdup(env_root);
    if (replacement == NULL) { free(binary); free(root); free(session); return -1; }
    free(root); root = replacement;
  }
  char *absolute_root = realpath(root, NULL);
  if (absolute_root == NULL) {
    free(binary); free(root); free(session);
    return -1;
  }
  free(root);
  root = absolute_root;
  struct stat root_info;
  if (stat(root, &root_info) != 0 || !S_ISDIR(root_info.st_mode)) {
    free(binary); free(root); free(session);
    return -1;
  }
  int control[2] = {-1, -1};
  int load[2] = {-1, -1};
  int events[2] = {-1, -1};
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, control) != 0 ||
      socketpair(AF_UNIX, SOCK_STREAM, 0, load) != 0 ||
      socketpair(AF_UNIX, SOCK_STREAM, 0, events) != 0) {
    close_pair(control); close_pair(load); close_pair(events);
    free(binary); free(root); free(session);
    return -1;
  }
  posix_spawn_file_actions_t actions;
  if (posix_spawn_file_actions_init(&actions) != 0) {
    close_pair(control); close_pair(load); close_pair(events);
    free(binary); free(root); free(session);
    return -1;
  }
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
    close_pair(control); close_pair(load); close_pair(events);
    free(binary); free(root); free(session);
    return -1;
  }
  if (setenv("ELECTRON_MBT_HOST_SESSION", session, 1) != 0) {
    posix_spawn_file_actions_destroy(&actions);
    close_pair(control); close_pair(load); close_pair(events);
    free(binary); free(root); free(session);
    return -1;
  }
  char *argv[3] = {binary, root, NULL};
  pid_t pid = -1;
  int spawned = posix_spawn(&pid, binary, &actions, NULL, argv, environ);
  unsetenv("ELECTRON_MBT_HOST_SESSION");
  posix_spawn_file_actions_destroy(&actions);
  if (spawned != 0 || pid <= 0) {
    close_pair(control); close_pair(load); close_pair(events);
    free(binary); free(root); free(session);
    return -1;
  }
  close(control[1]); control[1] = -1;
  close(load[1]); load[1] = -1;
  close(events[1]); events[1] = -1;
  child_pid = pid;
  control_fd = control[0];
  load_fd = load[0];
  event_fd = events[0];
  free(supervisor_root);
  supervisor_root = strdup(root);
  free(binary); free(root); free(session);
  return control_fd;
}

int32_t moonbit_ebt_supervisor_write_frame(int32_t fd, moonbit_bytes_t bytes, int32_t length) {
  if (fd < 0 || bytes == NULL || length <= 0 || length > 1048576) return -1;
  if (Moonbit_array_length(bytes) < length) return -1;
  uint32_t header = htonl((uint32_t)length);
  if (write_all(fd, &header, sizeof(header)) != 0) return -1;
  return write_all(fd, bytes, (size_t)length) == 0 ? 0 : -1;
}

int32_t moonbit_ebt_supervisor_read_frame_timeout(
    int32_t fd, moonbit_bytes_t buffer, int32_t capacity, int32_t timeout_ms) {
  if (fd < 0 || buffer == NULL || capacity < 0 || timeout_ms < 0) return -1;
  struct pollfd pollfd = {.fd = fd, .events = POLLIN};
  int ready;
  do { ready = poll(&pollfd, 1, timeout_ms); } while (ready < 0 && errno == EINTR);
  if (ready <= 0 || !(pollfd.revents & POLLIN)) return -1;
  uint32_t header = 0;
  if (read_all(fd, &header, sizeof(header)) != 0) return -1;
  uint32_t length = ntohl(header);
  if (length == 0 || length > (uint32_t)capacity || (int32_t)capacity > Moonbit_array_length(buffer)) return -1;
  if (read_all(fd, buffer, length) != 0) return -1;
  return (int32_t)length;
}

int32_t moonbit_ebt_supervisor_read_frame(int32_t fd, moonbit_bytes_t buffer, int32_t capacity) {
  return moonbit_ebt_supervisor_read_frame_timeout(fd, buffer, capacity, 15000);
}

int32_t moonbit_ebt_supervisor_load_fd(void) { return load_fd; }

int32_t moonbit_ebt_supervisor_event_fd(void) { return event_fd; }

int32_t moonbit_ebt_supervisor_file(
    moonbit_bytes_t buffer,
    int32_t capacity,
    moonbit_bytes_t name_bytes) {
  if (buffer == NULL || capacity <= 0 || name_bytes == NULL ||
      supervisor_root == NULL || Moonbit_array_length(buffer) < capacity) return -1;
  char *name = copy_bytes(name_bytes);
  if (name == NULL) return -1;
  size_t root_length = strlen(supervisor_root);
  size_t name_length = strlen(name);
  if (name_length == 0 || strstr(name, "..") != NULL) { free(name); return -1; }
  char *joined = (char *)malloc(root_length + name_length + 2);
  if (joined == NULL) { free(name); return -1; }
  memcpy(joined, supervisor_root, root_length);
  joined[root_length] = '/';
  memcpy(joined + root_length + 1, name, name_length + 1);
  free(name);
  char *canonical = realpath(joined, NULL);
  free(joined);
  if (canonical == NULL) return -1;
  if (strncmp(canonical, supervisor_root, root_length) != 0 ||
      canonical[root_length] != '/') {
    free(canonical);
    return -1;
  }
  size_t length = strlen(canonical);
  if (length + 1 > (size_t)capacity) { free(canonical); return -1; }
  memcpy(buffer, canonical, length);
  buffer[length] = 0;
  free(canonical);
  return (int32_t)length;
}

int32_t moonbit_ebt_supervisor_session(moonbit_bytes_t buffer) {
  if (buffer == NULL || Moonbit_array_length(buffer) < 32) return -1;
  unsigned char random[16];
  arc4random_buf(random, sizeof(random));
  static const char hex[] = "0123456789abcdef";
  for (int i = 0; i < 16; i++) {
    buffer[i * 2] = (unsigned char)hex[(random[i] >> 4) & 0xf];
    buffer[i * 2 + 1] = (unsigned char)hex[random[i] & 0xf];
  }
  return 32;
}

int32_t moonbit_ebt_supervisor_pid(void) { return (int32_t)child_pid; }

int32_t moonbit_ebt_supervisor_finish(void) {
  if (control_fd >= 0) { close(control_fd); control_fd = -1; }
  if (load_fd >= 0) { close(load_fd); load_fd = -1; }
  if (event_fd >= 0) { close(event_fd); event_fd = -1; }
  if (child_pid <= 0) return 0;
  int status = 0;
  for (int i = 0; i < 500; i++) {
    pid_t waited = waitpid(child_pid, &status, WNOHANG);
    if (waited == child_pid) { child_pid = -1; return status; }
    if (waited < 0) break;
    usleep(10000);
  }
  kill(child_pid, SIGKILL);
  waitpid(child_pid, &status, 0);
  child_pid = -1;
  return -1;
}

void moonbit_ebt_supervisor_kill(void) {
  if (child_pid > 0) {
    kill(child_pid, SIGKILL);
    waitpid(child_pid, NULL, 0);
    child_pid = -1;
  }
  if (control_fd >= 0) { close(control_fd); control_fd = -1; }
  if (load_fd >= 0) { close(load_fd); load_fd = -1; }
  if (event_fd >= 0) { close(event_fd); event_fd = -1; }
  free(supervisor_root);
  supervisor_root = NULL;
}

void moonbit_ebt_supervisor_exit(int32_t code) {
  fflush(NULL);
  _exit((int)code);
}
