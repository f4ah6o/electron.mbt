#define _POSIX_C_SOURCE 200809L
#include <node_api.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <poll.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <time.h>
#include <math.h>

#define MAX_FRAME (1024u * 1024u)

static napi_value fail(napi_env env, const char *code, const char *message) {
  napi_throw_error(env, code, message);
  return NULL;
}

static int64_t milliseconds(void) {
  struct timespec ts;
  if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return -1;
  return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static int wait_ready(int fd, short events, int64_t deadline) {
  for (;;) {
    int64_t now = milliseconds();
    if (now < 0) return -1;
    int64_t remaining = deadline - now;
    if (remaining <= 0) return -2;
    struct pollfd pfd = {fd, events, 0};
    int status = poll(&pfd, 1, (int)remaining);
    if (status < 0 && errno == EINTR) continue;
    if (status == 0) return -2;
    if (status < 0) return -1;
    if (pfd.revents & events) return 0;
    if (pfd.revents & (POLLERR | POLLHUP | POLLNVAL)) return -1;
  }
}

static int transfer(int fd, unsigned char *buffer, size_t size,
                    int writing, int64_t deadline) {
  size_t offset = 0;
  while (offset < size) {
    int ready = wait_ready(fd, writing ? POLLOUT : POLLIN, deadline);
    if (ready != 0) return ready;
    ssize_t count;
    if (writing) {
#ifdef MSG_NOSIGNAL
      count = send(fd, buffer + offset, size - offset, MSG_NOSIGNAL);
#else
      count = send(fd, buffer + offset, size - offset, 0);
#endif
    } else {
      count = recv(fd, buffer + offset, size - offset, 0);
    }
    if (count < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)) continue;
    if (count <= 0) return -1;
    offset += (size_t)count;
  }
  return 0;
}

static napi_value pair(napi_env env, napi_callback_info info) {
  (void)info;
  int fds[2];
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, fds) != 0)
    return fail(env, "ELECTRON_MBT_TRANSPORT_IO", "Cannot create private channel");
  for (int i = 0; i < 2; ++i) {
    int flags = fcntl(fds[i], F_GETFD);
    if (flags < 0 || fcntl(fds[i], F_SETFD, flags | FD_CLOEXEC) < 0) goto cleanup;
#ifdef SO_NOSIGPIPE
    int yes = 1;
    if (setsockopt(fds[i], SOL_SOCKET, SO_NOSIGPIPE, &yes, sizeof yes) != 0) goto cleanup;
#endif
  }
  int status = fcntl(fds[0], F_GETFL);
  if (status < 0 || fcntl(fds[0], F_SETFL, status | O_NONBLOCK) < 0) goto cleanup;
  napi_value result, value;
  if (napi_create_array_with_length(env, 2, &result) != napi_ok) goto cleanup;
  for (uint32_t i = 0; i < 2; ++i) {
    if (napi_create_int32(env, fds[i], &value) != napi_ok ||
        napi_set_element(env, result, i, value) != napi_ok) goto cleanup;
  }
  return result;
cleanup:
  close(fds[0]);
  close(fds[1]);
  return fail(env, "ELECTRON_MBT_TRANSPORT_IO", "Cannot initialize private channel");
}

static int int_arg(napi_env env, napi_value value, int32_t *result) {
  double number;
  if (napi_get_value_double(env, value, &number) != napi_ok ||
      !isfinite(number) || number < 0 || number > 2147483647 || number != (int32_t)number) return 0;
  *result = (int32_t)number;
  return 1;
}

static napi_value close_channel(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1], result;
  int32_t fd;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok ||
      argc != 1 || !int_arg(env, argv[0], &fd))
    return fail(env, "ELECTRON_MBT_INVALID_ARGUMENT", "Expected an owned channel");
  // Retrying close after EINTR can close a reused descriptor on some platforms.
  close(fd);
  napi_get_undefined(env, &result);
  return result;
}

static napi_value interrupt_channel(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1], result;
  int32_t fd;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok ||
      argc != 1 || !int_arg(env, argv[0], &fd))
    return fail(env, "ELECTRON_MBT_INVALID_ARGUMENT", "Expected a private channel");
  // Closing an fd while a worker polls it can reuse the number beneath that
  // worker. SHUT_RDWR wakes the blocked request without releasing ownership.
  if (shutdown(fd, SHUT_RDWR) != 0 && errno != ENOTCONN)
    return fail(env, "ELECTRON_MBT_TRANSPORT_CLOSED", "Cannot interrupt private channel");
  napi_get_undefined(env, &result);
  return result;
}

static napi_value request(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  int32_t fd, timeout;
  size_t length = 0;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 3 ||
      !int_arg(env, argv[0], &fd) || !int_arg(env, argv[2], &timeout) ||
      timeout < 1 || timeout > 60000 ||
      napi_get_value_string_utf8(env, argv[1], NULL, 0, &length) != napi_ok)
    return fail(env, "ELECTRON_MBT_INVALID_ARGUMENT", "Expected channel, text and watchdog milliseconds");
  if (length > MAX_FRAME)
    return fail(env, "ELECTRON_MBT_LIMIT", "Control frame exceeds byte limit");
  int flags = fcntl(fd, F_GETFL);
  if (flags < 0) return fail(env, "ELECTRON_MBT_TRANSPORT_CLOSED", "Control channel is not open");
  if (!(flags & O_NONBLOCK))
    return fail(env, "ELECTRON_MBT_INVALID_ARGUMENT", "Control channel must be nonblocking");
  unsigned char *buffer = malloc(length + 1);
  if (!buffer) return fail(env, "ELECTRON_MBT_TRANSPORT_IO", "Cannot allocate control frame");
  size_t copied;
  if (napi_get_value_string_utf8(env, argv[1], (char *)buffer, length + 1, &copied) != napi_ok || copied != length) {
    free(buffer);
    return fail(env, "ELECTRON_MBT_INVALID_ARGUMENT", "Cannot encode control frame");
  }
  int64_t now = milliseconds();
  if (now < 0) { free(buffer); return fail(env, "ELECTRON_MBT_TRANSPORT_IO", "Cannot read watchdog clock"); }
  int64_t deadline = now + timeout;
  unsigned char header[4] = {(unsigned char)(length >> 24), (unsigned char)(length >> 16),
                              (unsigned char)(length >> 8), (unsigned char)length};
  int status = transfer(fd, header, 4, 1, deadline);
  if (status == 0) status = transfer(fd, buffer, length, 1, deadline);
  free(buffer);
  if (status == 0) status = transfer(fd, header, 4, 0, deadline);
  if (status != 0) goto io_error;
  uint32_t reply_size = ((uint32_t)header[0] << 24) | ((uint32_t)header[1] << 16) |
                        ((uint32_t)header[2] << 8) | header[3];
  if (reply_size > MAX_FRAME) {
    shutdown(fd, SHUT_RDWR);
    return fail(env, "ELECTRON_MBT_LIMIT", "Reply frame exceeds byte limit");
  }
  buffer = malloc((size_t)reply_size + 1);
  if (!buffer) {
    shutdown(fd, SHUT_RDWR);
    return fail(env, "ELECTRON_MBT_TRANSPORT_IO", "Cannot allocate reply frame");
  }
  status = transfer(fd, buffer, reply_size, 0, deadline);
  if (status != 0) { free(buffer); goto io_error; }
  napi_value result;
  napi_status napi_status = napi_create_buffer_copy(env, reply_size, buffer, NULL, &result);
  free(buffer);
  if (napi_status != napi_ok)
    return fail(env, "ELECTRON_MBT_TRANSPORT_IO", "Cannot return reply frame");
  return result;
io_error:
  // Late replies cannot safely be reinterpreted as a subsequent request's reply.
  shutdown(fd, SHUT_RDWR);
  return fail(env, status == -2 ? "ELECTRON_MBT_TRANSPORT_TIMEOUT" : "ELECTRON_MBT_TRANSPORT_CLOSED",
              status == -2 ? "Control transport watchdog expired" : "Control transport closed or truncated");
}

static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
    {"pair", NULL, pair, NULL, NULL, NULL, napi_default, NULL},
    {"request", NULL, request, NULL, NULL, NULL, napi_default, NULL},
    {"close", NULL, close_channel, NULL, NULL, NULL, napi_default, NULL},
    {"interrupt", NULL, interrupt_channel, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, 4, descriptors);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
