/*
 * Experimental Linux GTK/WebKitGTK host for the Node-less adapted profile.
 *
 * This is a native leaf, not a second policy engine. MoonBit in
 * cmd/emoon and runtime/app_runner owns lifecycle, identifiers, limits,
 * grants, document generations and request terminal state. This process owns
 * the actual GTK window, WebKitWebView, snapshot files and the private
 * control/load/event socketpairs. It must never accept renderer-claimed
 * window/generation/sender values as authority.
 *
 * The macOS host in platform/macos/NativeHost.m is the reference for the
 * protocol subset implemented here. This file intentionally implements the
 * adapted/plain fixture path plus exact-file, directory and GTK dialog
 * surfaces and bounded offscreen PDF/HTML/PNG export paths. It has no original
 * preload, contextBridge, ipcRenderer, directory grants, menu, clipboard or
 * IME parity; unsupported operations return a typed failure.
 */
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <gtk/gtk.h>
#include <cairo.h>
#include <cairo-pdf.h>
#include <jsc/jsc.h>
#include <math.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>
#include <zlib.h>
#include <stdarg.h>
#include <webkit2/webkit2.h>

#include "control_frame.h"

#define EBT_MAX_FRAME (1024 * 1024)
#define EBT_MAX_SNAPSHOT_FILE (16 * 1024 * 1024)
#define EBT_MAX_SNAPSHOT_TOTAL (64ULL * 1024ULL * 1024ULL)
#define EBT_MAX_SNAPSHOT_FILES 4096
#define EBT_MAX_ADAPTER 65536
#define EBT_MAX_APP_PAYLOAD 65536
#define EBT_MAX_PENDING 128
#define EBT_MAX_EVENTS 1024
#define EBT_MAX_TITLE 4096
#define EBT_MAX_URL 8192
#define EBT_MAX_SAFE_INTEGER 9007199254740991.0
#define EBT_MAX_MAIN_READ (256 * 1024)
#define EBT_MAX_MAIN_WRITE (256 * 1024)
#define EBT_MAX_MAIN_OFFSET (256 * 1024 * 1024)
#define EBT_MAX_CAPTURE_BYTES (16 * 1024 * 1024)
#define EBT_MAX_MAIN_BASE64 (400 * 1024)
#define EBT_MAX_MAIN_PATH 4096
#define EBT_MAX_DIALOG_PATHS 16
#define EBT_GRANT_READ 1
#define EBT_GRANT_WRITE 2

#define EBT_CONTROL_CHANNEL 3
#define EBT_LOAD_CHANNEL 4
#define EBT_EVENT_CHANNEL 5

typedef struct PendingReply {
  WebKitScriptMessageReply *reply;
  JSCContext *context;
  gint64 generation;
} PendingReply;

typedef struct Request Request;

typedef struct ExportWait {
  GMainLoop *loop;
  gboolean failed;
  char *error;
  char *json;
  cairo_surface_t *surface;
  guint timeout_id;
  gint refs;
  gboolean timed_out;
} ExportWait;

static ExportWait *export_wait_new(void);
static void export_wait_ref(ExportWait *wait);
static void export_wait_unref(ExportWait *wait);
static void export_wait_cleanup(ExportWait *wait);
static gboolean export_wait_timeout(gpointer data);

typedef struct Snapshot {
  char *root;
  GHashTable *by_relative;
  GHashTable *by_source;
  char *entry;
  char *entry_staged;
  char *entry_sha256;
  char *manifest_sha256;
  char *asset_root;
  guint64 total_bytes;
} Snapshot;

typedef struct Host {
  char *root;
  char session[33];
  int control_fd;
  int load_fd;
  int event_fd;
  JSCContext *json;
  GtkWidget *window;
  WebKitWebView *web;
  WebKitUserContentManager *manager;
  gboolean created;
  gboolean content_alive;
  gboolean handlers_installed;
  gint64 generation;
  gboolean load_in_progress;
  gboolean load_failed;
  gboolean loaded;
  gboolean loaded_is_snapshot;
  gint64 loaded_generation;
  char *loaded_uri;
  char *loaded_file;
  Snapshot *snapshot;
  Request *load_request;
  char *adapter_source;
  char *message_nonce;
  char *adapter_nonce;
  gboolean adapter_observed;
  gboolean adapter_before_load;
  gint64 adapter_generation;
  gboolean ingress_released;
  gint64 ingress_released_generation;
  guint64 next_event;
  guint64 next_request;
  guint64 ingress_admitted;
  guint64 ingress_denied;
  guint64 ingress_unhandled;
  char ingress_last_code[128];
  GHashTable *pending;
  GHashTable *file_grants;
  GAsyncQueue *events;
  GtkWidget *active_dialog;
  gboolean close_after_dialog;
  GtkWidget *export_window;
  WebKitWebView *export_web;
  ExportWait *export_load_wait;
  cairo_surface_t *export_capture;
  z_stream *export_zlib;
  guint64 export_zlib_token;
  GThread *control_thread;
  GThread *load_thread;
  GThread *event_thread;
  gboolean shutting_down;
} Host;

struct Request {
  Host *host;
  EbtControlFrame frame;
  char *raw;
  size_t raw_length;
  gboolean is_load;
  gboolean completed;
  GMutex lock;
  GCond cond;
  char *reply;
};

static void request_complete(Request *request, const char *terminal,
                             JSCValue *payload);
static void fail_pending(Host *host, const char *code);

static void ebt_debug(const char *format, ...) {
  if (getenv("ELECTRON_MBT_LINUX_DEBUG") == NULL) return;
  va_list arguments;
  va_start(arguments, format);
  vfprintf(stderr, format, arguments);
  va_end(arguments);
  fflush(stderr);
}

static void __attribute__((noreturn)) host_exit(int status, const char *reason) {
  ebt_debug("host-exit status=%d reason=%s\n", status, reason);
  syscall(SYS_exit_group, status);
  __builtin_unreachable();
}
#define _exit(status) host_exit((status), __func__)

/* ---- bounded frame I/O ---- */

static gboolean write_all(int fd, const void *buffer, size_t length) {
  const unsigned char *cursor = buffer;
  while (length > 0) {
    ssize_t written = write(fd, cursor, length);
    if (written < 0) {
      if (errno == EINTR) continue;
      return FALSE;
    }
    if (written == 0) return FALSE;
    cursor += written;
    length -= (size_t)written;
  }
  return TRUE;
}

static gboolean read_all(int fd, void *buffer, size_t length) {
  unsigned char *cursor = buffer;
  while (length > 0) {
    ssize_t count = read(fd, cursor, length);
    if (count < 0) {
      if (errno == EINTR) continue;
      return FALSE;
    }
    if (count == 0) return FALSE;
    cursor += count;
    length -= (size_t)count;
  }
  return TRUE;
}

static gboolean write_frame(int fd, const char *text, size_t length) {
  if (fd < 0 || text == NULL || length == 0 || length > EBT_MAX_FRAME) return FALSE;
  uint32_t header = htonl((uint32_t)length);
  return write_all(fd, &header, sizeof(header)) &&
         write_all(fd, text, length);
}

static gboolean read_frame_alloc(int fd, char **out, size_t *out_length) {
  if (fd < 0 || out == NULL || out_length == NULL) return FALSE;
  uint32_t header = 0;
  if (!read_all(fd, &header, sizeof(header))) return FALSE;
  uint32_t length = ntohl(header);
  if (length == 0 || length > EBT_MAX_FRAME) return FALSE;
  char *buffer = malloc((size_t)length + 1);
  if (buffer == NULL) return FALSE;
  if (!read_all(fd, buffer, length)) {
    free(buffer);
    return FALSE;
  }
  buffer[length] = 0;
  *out = buffer;
  *out_length = length;
  return TRUE;
}

/* ---- JSC JSON helpers (main thread only) ---- */

static JSCValue *json_parse(Host *host, const char *text, size_t length) {
  if (host == NULL || host->json == NULL || text == NULL) return NULL;
  char *copy = g_strndup(text, length);
  JSCValue *value = jsc_value_new_from_json(host->json, copy);
  g_free(copy);
  if (value == NULL) return NULL;
  if (jsc_context_get_exception(host->json) != NULL) {
    jsc_context_clear_exception(host->json);
    g_object_unref(value);
    return NULL;
  }
  return value;
}

static JSCValue *object_new(Host *host) {
  return jsc_value_new_object(host->json, NULL, NULL);
}

static void object_set_number(Host *host, JSCValue *object, const char *key,
                              double value) {
  JSCValue *number = jsc_value_new_number(host->json, value);
  jsc_value_object_set_property(object, key, number);
  g_object_unref(number);
}

static void object_set_string(Host *host, JSCValue *object, const char *key,
                              const char *value) {
  JSCValue *string = jsc_value_new_string(host->json, value == NULL ? "" : value);
  jsc_value_object_set_property(object, key, string);
  g_object_unref(string);
}

static void object_set_boolean(Host *host, JSCValue *object, const char *key,
                               gboolean value) {
  JSCValue *boolean = jsc_value_new_boolean(host->json, value);
  jsc_value_object_set_property(object, key, boolean);
  g_object_unref(boolean);
}

static char *object_get_string(JSCValue *object, const char *key) {
  if (object == NULL || !jsc_value_is_object(object)) return NULL;
  JSCValue *value = jsc_value_object_get_property(object, key);
  if (value == NULL || !jsc_value_is_string(value)) {
    if (value != NULL) g_object_unref(value);
    return NULL;
  }
  char *text = jsc_value_to_string(value);
  g_object_unref(value);
  return text;
}

static gboolean object_get_integer(JSCValue *object, const char *key,
                                   gint64 *out) {
  if (object == NULL || out == NULL || !jsc_value_is_object(object)) return FALSE;
  JSCValue *value = jsc_value_object_get_property(object, key);
  if (value == NULL || !jsc_value_is_number(value)) {
    if (value != NULL) g_object_unref(value);
    return FALSE;
  }
  double number = jsc_value_to_double(value);
  g_object_unref(value);
  if (!isfinite(number) || floor(number) != number ||
      number < 0.0 || number > EBT_MAX_SAFE_INTEGER) return FALSE;
  *out = (gint64)number;
  return TRUE;
}

static gboolean object_get_boolean(JSCValue *object, const char *key,
                                   gboolean *out) {
  if (object == NULL || out == NULL || !jsc_value_is_object(object)) return FALSE;
  JSCValue *value = jsc_value_object_get_property(object, key);
  if (value == NULL || !jsc_value_is_boolean(value)) {
    if (value != NULL) g_object_unref(value);
    return FALSE;
  }
  *out = jsc_value_to_boolean(value);
  g_object_unref(value);
  return TRUE;
}

static JSCValue *object_get_value(JSCValue *object, const char *key) {
  if (object == NULL || !jsc_value_is_object(object)) return NULL;
  return jsc_value_object_get_property(object, key);
}

static gboolean object_has_exact_keys(JSCValue *object, const char *const *keys,
                                      size_t key_count) {
  if (object == NULL || !jsc_value_is_object(object)) return FALSE;
  char **names = jsc_value_object_enumerate_properties(object);
  if (names == NULL) return key_count == 0;
  size_t count = 0;
  while (names[count] != NULL) count += 1;
  gboolean ok = count == key_count;
  for (size_t index = 0; ok && index < key_count; index++) {
    gboolean found = FALSE;
    for (size_t name_index = 0; name_index < count; name_index++) {
      if (strcmp(names[name_index], keys[index]) == 0) {
        found = TRUE;
        break;
      }
    }
    if (!found) ok = FALSE;
  }
  g_strfreev(names);
  return ok;
}

static gboolean valid_sha256(const char *text) {
  if (text == NULL || strlen(text) != 64) return FALSE;
  for (const char *cursor = text; *cursor != 0; cursor++) {
    if (!((*cursor >= '0' && *cursor <= '9') ||
          (*cursor >= 'a' && *cursor <= 'f'))) return FALSE;
  }
  return TRUE;
}

static gboolean safe_relative_path(const char *path) {
  if (path == NULL || path[0] == 0 || strlen(path) > 256) return FALSE;
  const char *cursor = path;
  while (*cursor != 0) {
    const char *slash = strchr(cursor, '/');
    size_t length = slash == NULL ? strlen(cursor) : (size_t)(slash - cursor);
    if (length == 0 || (length == 1 && cursor[0] == '.') ||
        (length == 2 && cursor[0] == '.' && cursor[1] == '.')) return FALSE;
    if (memchr(cursor, '\\', length) != NULL) return FALSE;
    if (memchr(cursor, 0, length) != NULL) return FALSE;
    if (slash == NULL) break;
    cursor = slash + 1;
  }
  return TRUE;
}

static char *canonical_file_under_root(const char *root, const char *relative) {
  if (root == NULL || relative == NULL) return NULL;
  char *joined = g_build_filename(root, relative, NULL);
  char *canonical = realpath(joined, NULL);
  g_free(joined);
  if (canonical == NULL) return NULL;
  size_t root_length = strlen(root);
  if (strncmp(canonical, root, root_length) != 0 ||
      canonical[root_length] != '/') {
    free(canonical);
    return NULL;
  }
  struct stat info;
  if (stat(canonical, &info) != 0 || !S_ISREG(info.st_mode)) {
    free(canonical);
    return NULL;
  }
  return canonical;
}

static char *sha256_hex(const void *data, size_t length) {
  GChecksum *checksum = g_checksum_new(G_CHECKSUM_SHA256);
  if (checksum == NULL) return NULL;
  g_checksum_update(checksum, data, (gssize)length);
  char *result = g_strdup(g_checksum_get_string(checksum));
  g_checksum_free(checksum);
  return result;
}

static void remove_tree(const char *path) {
  if (path == NULL) return;
  GDir *directory = g_dir_open(path, 0, NULL);
  if (directory != NULL) {
    const char *name = NULL;
    while ((name = g_dir_read_name(directory)) != NULL) {
      char *child = g_build_filename(path, name, NULL);
      struct stat info;
      if (lstat(child, &info) == 0) {
        if (S_ISDIR(info.st_mode)) remove_tree(child);
        else unlink(child);
      }
      g_free(child);
    }
    g_dir_close(directory);
  }
  rmdir(path);
}

static void snapshot_free(Snapshot *snapshot) {
  if (snapshot == NULL) return;
  if (snapshot->root != NULL) remove_tree(snapshot->root);
  g_free(snapshot->root);
  g_free(snapshot->entry);
  g_free(snapshot->entry_staged);
  g_free(snapshot->entry_sha256);
  g_free(snapshot->manifest_sha256);
  g_free(snapshot->asset_root);
  if (snapshot->by_relative != NULL) g_hash_table_destroy(snapshot->by_relative);
  if (snapshot->by_source != NULL) g_hash_table_destroy(snapshot->by_source);
  g_free(snapshot);
}

static const char *mime_type_for(const char *relative) {
  const char *extension = strrchr(relative, '.');
  if (extension == NULL) return "application/octet-stream";
  if (g_ascii_strcasecmp(extension, ".html") == 0 ||
      g_ascii_strcasecmp(extension, ".htm") == 0) return "text/html; charset=utf-8";
  if (g_ascii_strcasecmp(extension, ".js") == 0 ||
      g_ascii_strcasecmp(extension, ".mjs") == 0) return "text/javascript; charset=utf-8";
  if (g_ascii_strcasecmp(extension, ".css") == 0) return "text/css; charset=utf-8";
  if (g_ascii_strcasecmp(extension, ".json") == 0 ||
      g_ascii_strcasecmp(extension, ".map") == 0) return "application/json; charset=utf-8";
  if (g_ascii_strcasecmp(extension, ".svg") == 0) return "image/svg+xml";
  if (g_ascii_strcasecmp(extension, ".png") == 0) return "image/png";
  if (g_ascii_strcasecmp(extension, ".jpg") == 0 ||
      g_ascii_strcasecmp(extension, ".jpeg") == 0) return "image/jpeg";
  if (g_ascii_strcasecmp(extension, ".gif") == 0) return "image/gif";
  if (g_ascii_strcasecmp(extension, ".webp") == 0) return "image/webp";
  if (g_ascii_strcasecmp(extension, ".ico") == 0) return "image/x-icon";
  if (g_ascii_strcasecmp(extension, ".woff") == 0) return "font/woff";
  if (g_ascii_strcasecmp(extension, ".woff2") == 0) return "font/woff2";
  if (g_ascii_strcasecmp(extension, ".ttf") == 0) return "font/ttf";
  if (g_ascii_strcasecmp(extension, ".otf") == 0) return "font/otf";
  if (g_ascii_strcasecmp(extension, ".wasm") == 0) return "application/wasm";
  return "application/octet-stream";
}

/* ---- snapshot staging ---- */

static Snapshot *snapshot_build(Host *host, const char *file, const char **code) {
  *code = "ELECTRON_MBT_SOURCE_MANIFEST";
  char *manifest_path = g_build_filename(host->root, "source-manifest.json", NULL);
  char *manifest_text = NULL;
  gsize manifest_length = 0;
  if (!g_file_get_contents(manifest_path, &manifest_text, &manifest_length, NULL) ||
      manifest_length == 0 || manifest_length > 4 * 1024 * 1024) {
    g_free(manifest_path);
    g_free(manifest_text);
    return NULL;
  }
  g_free(manifest_path);
  char *manifest_sha = sha256_hex(manifest_text, manifest_length);
  JSCValue *manifest = json_parse(host, manifest_text, manifest_length);
  g_free(manifest_text);
  if (manifest == NULL || !jsc_value_is_object(manifest)) {
    if (manifest != NULL) g_object_unref(manifest);
    g_free(manifest_sha);
    return NULL;
  }

  gint64 schema = 0;
  char *app = object_get_string(manifest, "app");
  char *entry = object_get_string(manifest, "entry");
  JSCValue *files = object_get_value(manifest, "files");
  gboolean valid = object_get_integer(manifest, "schema", &schema) &&
    schema == 2 && app != NULL && app[0] != 0 && strlen(app) <= 128 &&
    entry != NULL && safe_relative_path(entry) && strcmp(entry, file) == 0 &&
    files != NULL && jsc_value_is_array(files);
  gint file_count = 0;
  if (valid) {
    JSCValue *length_value = object_get_value(files, "length");
    if (length_value == NULL || !jsc_value_is_number(length_value)) {
      valid = FALSE;
    } else {
      file_count = jsc_value_to_int32(length_value);
      if (file_count < 1 || file_count > EBT_MAX_SNAPSHOT_FILES) valid = FALSE;
    }
    if (length_value != NULL) g_object_unref(length_value);
  }
  if (!valid) {
    g_object_unref(files);
    g_object_unref(manifest);
    g_free(app);
    g_free(entry);
    g_free(manifest_sha);
    return NULL;
  }

  Snapshot *snapshot = g_new0(Snapshot, 1);
  snapshot->by_relative = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, g_free);
  snapshot->by_source = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, g_free);
  snapshot->manifest_sha256 = g_strdup(manifest_sha);
  snapshot->entry = g_strdup(entry);
  snapshot->total_bytes = 0;
  GError *error = NULL;
  char *root = g_dir_make_tmp("electron-mbt-snapshot-XXXXXX", &error);
  if (root == NULL) {
    g_clear_error(&error);
    g_object_unref(files);
    g_object_unref(manifest);
    g_free(app);
    g_free(entry);
    g_free(manifest_sha);
    snapshot_free(snapshot);
    *code = "ELECTRON_MBT_NATIVE_FAILURE";
    return NULL;
  }
  chmod(root, 0700);
  snapshot->root = root;
  gboolean entry_seen = FALSE;
  for (gint index = 0; valid && index < file_count; index++) {
    JSCValue *item = jsc_value_object_get_property_at_index(files, (guint)index);
    if (item == NULL || !jsc_value_is_object(item)) {
      if (item != NULL) g_object_unref(item);
      valid = FALSE;
      break;
    }
    char *path = object_get_string(item, "path");
    char *expected_sha = object_get_string(item, "sha256");
    gint64 expected_bytes = 0;
    gboolean item_ok = object_has_exact_keys(item,
      (const char *const[]){"path", "sha256", "bytes"}, 3) &&
      path != NULL && safe_relative_path(path) &&
      valid_sha256(expected_sha) &&
      object_get_integer(item, "bytes", &expected_bytes) &&
      expected_bytes > 0 && expected_bytes <= EBT_MAX_SNAPSHOT_FILE;
    g_object_unref(item);
    if (!item_ok) {
      g_free(path);
      g_free(expected_sha);
      valid = FALSE;
      break;
    }
    if (g_hash_table_contains(snapshot->by_relative, path)) {
      g_free(path);
      g_free(expected_sha);
      valid = FALSE;
      break;
    }
    char *source = canonical_file_under_root(host->root, path);
    if (source == NULL) {
      g_free(path);
      g_free(expected_sha);
      *code = "ELECTRON_MBT_SOURCE_DENIED";
      valid = FALSE;
      break;
    }
    struct stat info;
    if (stat(source, &info) != 0 || !S_ISREG(info.st_mode) ||
        info.st_size != (off_t)expected_bytes) {
      free(source);
      g_free(path);
      g_free(expected_sha);
      *code = "ELECTRON_MBT_SOURCE_MISMATCH";
      valid = FALSE;
      break;
    }
    char *data = NULL;
    gsize data_length = 0;
    if (!g_file_get_contents(source, &data, &data_length, NULL) ||
        data_length != (gsize)expected_bytes ||
        data_length > EBT_MAX_SNAPSHOT_FILE) {
      g_free(data);
      free(source);
      g_free(path);
      g_free(expected_sha);
      *code = "ELECTRON_MBT_SOURCE_MISMATCH";
      valid = FALSE;
      break;
    }
    char *actual_sha = sha256_hex(data, data_length);
    if (actual_sha == NULL || strcmp(actual_sha, expected_sha) != 0) {
      g_free(actual_sha);
      g_free(data);
      free(source);
      g_free(path);
      g_free(expected_sha);
      *code = "ELECTRON_MBT_SOURCE_MISMATCH";
      valid = FALSE;
      break;
    }
    if (snapshot->total_bytes + data_length > EBT_MAX_SNAPSHOT_TOTAL) {
      g_free(actual_sha);
      g_free(data);
      free(source);
      g_free(path);
      g_free(expected_sha);
      *code = "ELECTRON_MBT_SOURCE_MANIFEST";
      valid = FALSE;
      break;
    }
    snapshot->total_bytes += data_length;
    char *staged = g_build_filename(snapshot->root, path, NULL);
    char *parent = g_path_get_dirname(staged);
    if (g_mkdir_with_parents(parent, 0700) != 0) {
      g_free(parent);
      g_free(staged);
      g_free(actual_sha);
      g_free(data);
      free(source);
      g_free(path);
      g_free(expected_sha);
      *code = "ELECTRON_MBT_NATIVE_FAILURE";
      valid = FALSE;
      break;
    }
    g_free(parent);
    gboolean written = g_file_set_contents(staged, data, (gssize)data_length, NULL);
    if (written) chmod(staged, 0600);
    g_free(actual_sha);
    g_free(data);
    if (!written) {
      g_free(staged);
      free(source);
      g_free(path);
      g_free(expected_sha);
      *code = "ELECTRON_MBT_NATIVE_FAILURE";
      valid = FALSE;
      break;
    }
    g_hash_table_insert(snapshot->by_relative, g_strdup(path), g_strdup(staged));
    g_hash_table_insert(snapshot->by_source, g_strdup(source), g_strdup(staged));
    if (strcmp(path, entry) == 0) {
      entry_seen = TRUE;
      snapshot->entry_staged = g_strdup(staged);
      snapshot->entry_sha256 = g_strdup(expected_sha);
    }
    g_free(staged);
    free(source);
    g_free(path);
    g_free(expected_sha);
  }

  g_object_unref(files);
  g_object_unref(manifest);
  g_free(app);
  g_free(entry);
  g_free(manifest_sha);
  if (!valid || !entry_seen || snapshot->entry_staged == NULL ||
      snapshot->entry_sha256 == NULL) {
    if (*code == NULL || strcmp(*code, "ELECTRON_MBT_SOURCE_MANIFEST") == 0) {
      *code = "ELECTRON_MBT_SOURCE_MANIFEST";
    }
    snapshot_free(snapshot);
    return NULL;
  }
  char *asset_root = g_path_get_dirname(snapshot->entry);
  snapshot->asset_root = strcmp(asset_root, ".") == 0 ? g_strdup("") : g_strdup(asset_root);
  g_free(asset_root);
  *code = NULL;
  return snapshot;
}

/* ---- events ---- */

static gpointer event_writer(gpointer data_host) {
  Host *host = data_host;
  for (;;) {
    char *text = g_async_queue_pop(host->events);
    if (text == NULL) break;
    if (text == (char *)-1) {
      g_free(text);
      break;
    }
    if (!write_frame(host->event_fd, text, strlen(text))) _exit(2);
    g_free(text);
  }
  return NULL;
}

static gboolean publish_event(Host *host, const char *operation, gint64 generation,
                              JSCValue *payload) {
  if (host == NULL || operation == NULL) {
    if (payload != NULL) g_object_unref(payload);
    return FALSE;
  }
  if (g_async_queue_length(host->events) >= EBT_MAX_EVENTS) {
    if (payload != NULL) g_object_unref(payload);
    return FALSE;
  }
  JSCValue *notice = object_new(host);
  object_set_number(host, notice, "version", 1);
  object_set_string(host, notice, "session", host->session);
  object_set_number(host, notice, "request", (double)(++host->next_event));
  object_set_number(host, notice, "window", 1);
  object_set_number(host, notice, "generation", (double)generation);
  object_set_string(host, notice, "operation", operation);
  if (payload == NULL) {
    JSCValue *empty = object_new(host);
    jsc_value_object_set_property(notice, "payload", empty);
    g_object_unref(empty);
  } else {
    jsc_value_object_set_property(notice, "payload", payload);
    g_object_unref(payload);
  }
  char *text = jsc_value_to_json(notice, 0);
  g_object_unref(notice);
  if (text == NULL || strlen(text) > EBT_MAX_FRAME) {
    g_free(text);
    return FALSE;
  }
  g_async_queue_push(host->events, text);
  return TRUE;
}

/* ---- pending page replies ---- */

static void pending_free(gpointer data) {
  PendingReply *pending = data;
  if (pending == NULL) return;
  if (pending->reply != NULL) webkit_script_message_reply_unref(pending->reply);
  if (pending->context != NULL) g_object_unref(pending->context);
  g_free(pending);
}

static void fail_pending(Host *host, const char *code) {
  if (host == NULL || host->pending == NULL) return;
  GHashTableIter iterator;
  gpointer key;
  gpointer value;
  g_hash_table_iter_init(&iterator, host->pending);
  while (g_hash_table_iter_next(&iterator, &key, &value)) {
    (void)key;
    PendingReply *pending = value;
    if (pending != NULL && pending->reply != NULL) {
      webkit_script_message_reply_return_error_message(pending->reply, code);
    }
    g_hash_table_iter_remove(&iterator);
  }
  g_strlcpy(host->ingress_last_code, code, sizeof(host->ingress_last_code));
}

/* ---- reply construction ---- */

static void request_complete_manual(Request *request, const char *terminal,
                                    const char *code) {
  Host *host = request->host;
  g_mutex_lock(&request->lock);
  if (request->completed) {
    g_mutex_unlock(&request->lock);
    return;
  }
  GString *text = g_string_new("{\"version\":1,\"session\":\"");
  g_string_append(text, request->frame.session);
  g_string_append_printf(text,
    "\",\"request\":%lld,\"window\":%lld,\"generation\":%lld,"
    "\"terminal\":\"%s\",\"payload\":",
    (long long)request->frame.request, (long long)request->frame.window,
    (long long)request->frame.generation, terminal);
  if (code == NULL) g_string_append(text, "{}");
  else g_string_append_printf(text, "{\"code\":\"%s\"}", code);
  g_string_append(text, "}");
  request->reply = g_string_free(text, FALSE);
  request->completed = TRUE;
  g_cond_signal(&request->cond);
  g_mutex_unlock(&request->lock);
  (void)host;
}

static void request_complete(Request *request, const char *terminal,
                             JSCValue *payload) {
  Host *host = request->host;
  if (host->json == NULL) {
    if (payload != NULL) g_object_unref(payload);
    _exit(2);
  }
  g_mutex_lock(&request->lock);
  if (request->completed) {
    g_mutex_unlock(&request->lock);
    if (payload != NULL) g_object_unref(payload);
    return;
  }
  JSCValue *reply = object_new(host);
  object_set_number(host, reply, "version", 1);
  object_set_string(host, reply, "session", request->frame.session);
  object_set_number(host, reply, "request", (double)request->frame.request);
  object_set_number(host, reply, "window", (double)request->frame.window);
  object_set_number(host, reply, "generation", (double)request->frame.generation);
  object_set_string(host, reply, "terminal", terminal);
  if (payload == NULL) {
    JSCValue *empty = object_new(host);
    jsc_value_object_set_property(reply, "payload", empty);
    g_object_unref(empty);
  } else {
    jsc_value_object_set_property(reply, "payload", payload);
    g_object_unref(payload);
  }
  char *text = jsc_value_to_json(reply, 0);
  g_object_unref(reply);
  if (text == NULL || strlen(text) > EBT_MAX_FRAME) {
    g_free(text);
    _exit(2);
  }
  request->reply = text;
  request->completed = TRUE;
  g_cond_signal(&request->cond);
  g_mutex_unlock(&request->lock);
}

static void request_failure(Request *request, const char *code) {
  Host *host = request->host;
  if (host->json == NULL) {
    request_complete_manual(request, "failure", code);
    return;
  }
  JSCValue *payload = object_new(host);
  object_set_string(host, payload, "code", code);
  request_complete(request, "failure", payload);
}

static void request_success_empty(Request *request) {
  Host *host = request->host;
  if (host->json == NULL) {
    request_complete_manual(request, "success", NULL);
    return;
  }
  JSCValue *payload = object_new(host);
  request_complete(request, "success", payload);
}

static void wait_for_request(Request *request, gint64 seconds) {
  g_mutex_lock(&request->lock);
  gint64 deadline = g_get_monotonic_time() + seconds * G_TIME_SPAN_SECOND;
  while (!request->completed) {
    if (!g_cond_wait_until(&request->cond, &request->lock, deadline)) {
      g_mutex_unlock(&request->lock);
      /* A timeout is a host failure, not a result. Never continue with a
       * half-processed request or let the caller reuse the session. */
      _exit(2);
    }
  }
  g_mutex_unlock(&request->lock);
}

static Request *request_new(Host *host, const char *raw, size_t raw_length,
                            const EbtControlFrame *frame, gboolean is_load) {
  Request *request = g_new0(Request, 1);
  request->host = host;
  request->frame = *frame;
  request->raw = g_strndup(raw, raw_length);
  request->raw_length = raw_length;
  request->is_load = is_load;
  g_mutex_init(&request->lock);
  g_cond_init(&request->cond);
  return request;
}

static void request_free(Request *request) {
  if (request == NULL) return;
  g_free(request->raw);
  g_free(request->reply);
  g_mutex_clear(&request->lock);
  g_cond_clear(&request->cond);
  g_free(request);
}

/* ---- window/load state ---- */

static void fail_load_request(Host *host, const char *code) {
  if (host == NULL || host->load_request == NULL) return;
  Request *request = host->load_request;
  host->load_request = NULL;
  request_failure(request, code);
}

static char *random_hex(void) {
  unsigned char bytes[16];
  static const char hex[] = "0123456789abcdef";
  for (size_t index = 0; index < sizeof(bytes); index++) {
    bytes[index] = (unsigned char)(g_random_int() & 0xff);
  }
  char *out = g_malloc(33);
  for (size_t index = 0; index < sizeof(bytes); index++) {
    out[index * 2] = hex[(bytes[index] >> 4) & 0xf];
    out[index * 2 + 1] = hex[bytes[index] & 0xf];
  }
  out[32] = 0;
  return out;
}

typedef struct ReleaseContext {
  Host *host;
  gint64 generation;
} ReleaseContext;

static void ingress_ready_finished(GObject *source, GAsyncResult *result,
                                   gpointer data) {
  ReleaseContext *context = data;
  Host *host = context->host;
  GError *error = NULL;
  JSCValue *value = webkit_web_view_evaluate_javascript_finish(
    WEBKIT_WEB_VIEW(source), result, &error);
  if (value != NULL) g_object_unref(value);
  if (error == NULL && host != NULL && host->content_alive && host->loaded &&
      !host->load_in_progress && host->generation == context->generation &&
      host->loaded_generation == context->generation) {
    host->ingress_released = TRUE;
    host->ingress_released_generation = context->generation;
  }
  g_clear_error(&error);
  g_free(context);
}

static void release_ingress(Host *host) {
  if (host == NULL || host->web == NULL || host->adapter_source == NULL) return;
  static const char script[] =
    "if (typeof window.__electronMbtIngressReady === 'function') { "
    "window.__electronMbtIngressReady(); true; } else { "
    "throw new Error('ELECTRON_MBT_INGRESS_READY_MISSING'); }";
  ReleaseContext *context = g_new0(ReleaseContext, 1);
  context->host = host;
  context->generation = host->generation;
  webkit_web_view_evaluate_javascript(host->web, script, -1, NULL, NULL, NULL,
                                      ingress_ready_finished, context);
}

static gboolean on_load_failed(WebKitWebView *web_view, WebKitLoadEvent event,
                               const gchar *failing_uri, GError *error,
                               gpointer data) {
  (void)web_view;
  (void)event;
  (void)failing_uri;
  (void)error;
  Host *host = data;
  if (host == NULL) return FALSE;
  ebt_debug("load-failed uri=%s error=%s\n", failing_uri == NULL ? "(null)" : failing_uri, error == NULL ? "(null)" : error->message);
  host->load_failed = TRUE;
  host->load_in_progress = FALSE;
  if (host->load_request != NULL) fail_load_request(host, "ELECTRON_MBT_LOAD_FAILED");
  fail_pending(host, "ELECTRON_MBT_STALE_DOCUMENT");
  return TRUE;
}

static void on_load_changed(WebKitWebView *web_view, WebKitLoadEvent event,
                            gpointer data) {
  Host *host = data;
  ebt_debug("load-changed event=%d\n", (int)event);
  if (host == NULL || event != WEBKIT_LOAD_FINISHED) return;
  if (host->load_failed) return;
  if (!host->load_in_progress || host->loaded_uri == NULL) return;
  const char *uri = webkit_web_view_get_uri(web_view);
  ebt_debug("load-finished current=%s expected=%s\n", uri == NULL ? "(null)" : uri, host->loaded_uri == NULL ? "(null)" : host->loaded_uri);
  if (uri == NULL || strcmp(uri, host->loaded_uri) != 0) {
    host->load_in_progress = FALSE;
    fail_load_request(host, "ELECTRON_MBT_STALE_DOCUMENT");
    return;
  }
  host->loaded = TRUE;
  host->load_in_progress = FALSE;
  host->loaded_generation = host->generation;
  if (host->adapter_source != NULL) release_ingress(host);
  if (host->load_request != NULL) {
    Request *request = host->load_request;
    host->load_request = NULL;
    JSCValue *payload = object_new(host);
    object_set_boolean(host, payload, "didFinishLoad", TRUE);
    object_set_string(host, payload, "url", host->loaded_uri);
    request_complete(request, "success", payload);
  }
}

static void on_web_process_terminated(WebKitWebView *web_view,
                                      WebKitWebProcessTerminationReason reason,
                                      gpointer data) {
  (void)web_view;
  (void)reason;
  Host *host = data;
  if (host == NULL) return;
  host->content_alive = FALSE;
  host->load_in_progress = FALSE;
  host->loaded = FALSE;
  if (host->load_request != NULL) fail_load_request(host, "ELECTRON_MBT_WEB_PROCESS_TERMINATED");
  fail_pending(host, "ELECTRON_MBT_STALE_DOCUMENT");
  JSCValue *payload = object_new(host);
  object_set_string(host, payload, "reason", "web-process-terminated");
  publish_event(host, "web-content-gone", host->generation, payload);
}

/* ---- page scripts ---- */

static char *page_shim_source(const char *adapter_source,
                              const char *message_nonce,
                              const char *adapter_nonce) {
  return g_strdup_printf(
    "(function(__messageNonce, __adapterNonce) {\n"
    "const readyCallbacks = [];\n"
    "const host = Object.freeze({\n"
    "  whenReady: function (callback) {\n"
    "    if (typeof callback === 'function') readyCallbacks.push(callback);\n"
    "  },\n"
    "  dispatch: function (operation, args) {\n"
    "    try { if (window.top !== window) throw new Error('ELECTRON_MBT_ADAPTER_SUBFRAME'); } catch (error) {\n"
    "      return Promise.reject(error);\n"
    "    }\n"
    "    const handler = window.webkit && window.webkit.messageHandlers &&\n"
    "      window.webkit.messageHandlers.electronMbtApp;\n"
    "    if (!handler) return Promise.reject(new Error('ELECTRON_MBT_INGRESS_UNAVAILABLE'));\n"
    "    const parsed = args === null ? null : JSON.parse(args);\n"
    "    const payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed)\n"
    "      ? parsed : { args: parsed };\n"
    "    return handler.postMessage({ operation: operation, payload: payload,\n"
    "      nonce: __messageNonce }).catch(function (error) {\n"
    "      const message = String((error && error.message) || error || '');\n"
    "      const match = message.match(/ELECTRON_MBT_[A-Z0-9_]+/);\n"
    "      const wrapped = new Error(message);\n"
    "      wrapped.code = match ? match[0] : 'ELECTRON_MBT_INGRESS_FAILED';\n"
    "      throw wrapped;\n"
    "    });\n"
    "  },\n"
    "  onEvent: function (emit) {\n"
    "    Object.defineProperty(window, '__electronMbtDispatch', {\n"
    "      value: function (nonce, topic, payload) {\n"
    "        if (nonce !== __adapterNonce) throw new Error('ELECTRON_MBT_ADAPTER_EVENT_DENIED');\n"
    "        emit(topic, payload);\n"
    "      }, enumerable: false, configurable: false, writable: false\n"
    "    });\n"
    "  }\n"
    "});\n"
    "Object.defineProperty(window, '__electronMbtIngress', {\n"
    "  value: host, enumerable: false, configurable: true, writable: false\n"
    "});\n"
    "Object.defineProperty(window, '__electronMbtIngressReady', {\n"
    "  value: function () {\n"
    "    const batch = readyCallbacks.splice(0, readyCallbacks.length);\n"
    "    for (let index = 0; index < batch.length; index += 1) batch[index]();\n"
    "  }, enumerable: false, configurable: false, writable: false\n"
    "});\n"
    "%s\n"
    "try {\n"
    "  const installed = window.webkit && window.webkit.messageHandlers &&\n"
    "    window.webkit.messageHandlers.electronMbtAdapterInstalled;\n"
    "  if (installed) installed.postMessage({ nonce: __adapterNonce });\n"
    "} catch (_) {}\n"
    "})(%s, %s);\n",
    adapter_source == NULL ? "" : adapter_source,
    message_nonce, adapter_nonce);
}

static void install_page_scripts(Host *host) {
  if (host == NULL || host->manager == NULL) return;
  webkit_user_content_manager_remove_all_scripts(host->manager);
  if (host->adapter_source == NULL) return;
  g_free(host->message_nonce);
  g_free(host->adapter_nonce);
  host->message_nonce = random_hex();
  host->adapter_nonce = random_hex();
  char *quoted_message = g_strdup_printf("\"%s\"", host->message_nonce);
  char *quoted_adapter = g_strdup_printf("\"%s\"", host->adapter_nonce);
  char *source = page_shim_source(host->adapter_source,
                                  quoted_message, quoted_adapter);
  g_free(quoted_message);
  g_free(quoted_adapter);
  if (source == NULL) return;
  WebKitUserScript *script = webkit_user_script_new(
    source, WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
    WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, NULL, NULL);
  webkit_user_content_manager_add_script(host->manager, script);
  webkit_user_script_unref(script);
  g_free(source);
}

/* ---- page message handlers ---- */

static gboolean on_app_message(WebKitUserContentManager *manager,
                               JSCValue *value, WebKitScriptMessageReply *reply,
                               gpointer data) {
  (void)manager;
  Host *host = data;
  if (host == NULL || value == NULL || !jsc_value_is_object(value)) {
    if (reply != NULL) webkit_script_message_reply_return_error_message(reply, "ELECTRON_MBT_INVALID_ENVELOPE");
    if (host != NULL) host->ingress_denied += 1;
    return TRUE;
  }
  JSCValue *operation_value = object_get_value(value, "operation");
  JSCValue *payload_value = object_get_value(value, "payload");
  JSCValue *nonce_value = object_get_value(value, "nonce");
  char *operation = operation_value != NULL && jsc_value_is_string(operation_value)
    ? jsc_value_to_string(operation_value) : NULL;
  char *nonce = nonce_value != NULL && jsc_value_is_string(nonce_value)
    ? jsc_value_to_string(nonce_value) : NULL;
  char *payload_json = payload_value != NULL && jsc_value_is_object(payload_value)
    ? jsc_value_to_json(payload_value, 0) : NULL;
  if (operation_value != NULL) g_object_unref(operation_value);
  if (payload_value != NULL) g_object_unref(payload_value);
  if (nonce_value != NULL) g_object_unref(nonce_value);

  const char *code = NULL;
  if (operation == NULL || operation[0] == 0 || strlen(operation) > 128 ||
      payload_json == NULL || strlen(payload_json) > EBT_MAX_APP_PAYLOAD) {
    code = "ELECTRON_MBT_INVALID_ENVELOPE";
  } else if (nonce == NULL || host->message_nonce == NULL ||
             strcmp(nonce, host->message_nonce) != 0) {
    code = "ELECTRON_MBT_ADAPTER_NONCE";
  } else if (!host->content_alive || !host->loaded ||
             host->loaded_generation != host->generation ||
             host->load_in_progress) {
    code = "ELECTRON_MBT_STALE_DOCUMENT";
  } else if (g_hash_table_size(host->pending) >= EBT_MAX_PENDING) {
    code = "ELECTRON_MBT_MAIN_BUSY";
  }
  if (code != NULL) {
    host->ingress_denied += 1;
    g_strlcpy(host->ingress_last_code, code, sizeof(host->ingress_last_code));
    if (reply != NULL) webkit_script_message_reply_return_error_message(reply, code);
    g_free(operation);
    g_free(nonce);
    g_free(payload_json);
    return TRUE;
  }

  ebt_debug("app-request op=%s\n", operation);
  char *request_id = g_strdup_printf("r%" G_GUINT64_FORMAT, ++host->next_request);
  PendingReply *pending = g_new0(PendingReply, 1);
  pending->reply = webkit_script_message_reply_ref(reply);
  pending->context = g_object_ref(jsc_value_get_context(value));
  pending->generation = host->generation;
  g_hash_table_insert(host->pending, g_strdup(request_id), pending);

  JSCValue *event_payload = object_new(host);
  object_set_string(host, event_payload, "request", request_id);
  object_set_string(host, event_payload, "operation", operation);
  JSCValue *payload_control = json_parse(host, payload_json, strlen(payload_json));
  if (payload_control == NULL) {
    JSCValue *empty = object_new(host);
    jsc_value_object_set_property(event_payload, "payload", empty);
    g_object_unref(empty);
  } else {
    jsc_value_object_set_property(event_payload, "payload", payload_control);
    g_object_unref(payload_control);
  }
  if (!publish_event(host, "app-request", host->generation, event_payload)) {
    webkit_script_message_reply_return_error_message(pending->reply,
                                                     "ELECTRON_MBT_MAIN_BUSY");
    host->ingress_denied += 1;
    g_strlcpy(host->ingress_last_code, "ELECTRON_MBT_MAIN_BUSY",
              sizeof(host->ingress_last_code));
    g_hash_table_remove(host->pending, request_id);
    g_free(request_id);
    g_free(operation);
    g_free(nonce);
    g_free(payload_json);
    return TRUE;
  }
  host->ingress_admitted += 1;
  host->ingress_last_code[0] = 0;
  g_free(request_id);
  g_free(operation);
  g_free(nonce);
  g_free(payload_json);
  return TRUE;
}

static void on_adapter_installed(WebKitUserContentManager *manager,
                                 WebKitJavascriptResult *result, gpointer data) {
  (void)manager;
  Host *host = data;
  if (host == NULL || result == NULL) return;
  JSCValue *value = webkit_javascript_result_get_js_value(result);
  if (value == NULL || !jsc_value_is_object(value)) return;
  char *nonce = object_get_string(value, "nonce");
  if (nonce != NULL && host->adapter_nonce != NULL &&
      strcmp(nonce, host->adapter_nonce) == 0 && host->content_alive &&
      host->generation > 0) {
    host->adapter_observed = TRUE;
    host->adapter_generation = host->generation;
    host->adapter_before_load = host->load_in_progress || !host->loaded;
  }
  g_free(nonce);
}

static void install_message_handlers(Host *host) {
  if (host == NULL || host->manager == NULL || host->handlers_installed) return;
  g_signal_connect(host->manager,
                   "script-message-received::electronMbtAdapterInstalled",
                   G_CALLBACK(on_adapter_installed), host);
  g_signal_connect(host->manager,
                   "script-message-with-reply-received::electronMbtApp",
                   G_CALLBACK(on_app_message), host);
  if (!webkit_user_content_manager_register_script_message_handler(
        host->manager, "electronMbtAdapterInstalled")) {
    _exit(2);
  }
  if (!webkit_user_content_manager_register_script_message_handler_with_reply(
        host->manager, "electronMbtApp", NULL)) {
    _exit(2);
  }
  host->handlers_installed = TRUE;
}

/* ---- custom scheme ---- */

static void on_uri_scheme_request(WebKitURISchemeRequest *request,
                                  gpointer data) {
  Host *host = data;
  ebt_debug("scheme-entry\n");
  if (host == NULL || request == NULL || host->snapshot == NULL ||
      !host->content_alive) {
    GError *error = g_error_new_literal(G_IO_ERROR, G_IO_ERROR_NOT_FOUND, "not found");
    webkit_uri_scheme_request_finish_error(request, error);
    g_error_free(error);
    return;
  }
  const char *method = webkit_uri_scheme_request_get_http_method(request);
  if (method == NULL) method = "GET";
  if (g_ascii_strcasecmp(method, "GET") != 0 &&
      g_ascii_strcasecmp(method, "HEAD") != 0) {
    GError *error = g_error_new_literal(G_IO_ERROR, G_IO_ERROR_PERMISSION_DENIED, "method");
    webkit_uri_scheme_request_finish_error(request, error);
    g_error_free(error);
    return;
  }
  const char *uri = webkit_uri_scheme_request_get_uri(request);
  ebt_debug("scheme request uri=%s\n", uri == NULL ? "(null)" : uri);
  if (uri == NULL || strchr(uri, '?') != NULL || strchr(uri, '#') != NULL) {
    GError *error = g_error_new_literal(G_IO_ERROR, G_IO_ERROR_INVALID_ARGUMENT, "uri");
    webkit_uri_scheme_request_finish_error(request, error);
    g_error_free(error);
    return;
  }
  const char *path = webkit_uri_scheme_request_get_path(request);
  if (path == NULL || path[0] != '/' || strlen(path) < 2) {
    GError *error = g_error_new_literal(G_IO_ERROR, G_IO_ERROR_INVALID_ARGUMENT, "path");
    webkit_uri_scheme_request_finish_error(request, error);
    g_error_free(error);
    return;
  }
  const char *relative = path + 1;
  if (!safe_relative_path(relative)) {
    GError *error = g_error_new_literal(G_IO_ERROR, G_IO_ERROR_PERMISSION_DENIED, "escape");
    webkit_uri_scheme_request_finish_error(request, error);
    g_error_free(error);
    return;
  }
  const char *asset_root = host->snapshot->asset_root;
  if (asset_root != NULL && asset_root[0] != 0) {
    size_t prefix_length = strlen(asset_root);
    if (strncmp(relative, asset_root, prefix_length) != 0 ||
        relative[prefix_length] != '/') {
      GError *error = g_error_new_literal(G_IO_ERROR, G_IO_ERROR_PERMISSION_DENIED, "asset root");
      webkit_uri_scheme_request_finish_error(request, error);
      g_error_free(error);
      return;
    }
  }
  const char *staged = g_hash_table_lookup(host->snapshot->by_relative, relative);
  ebt_debug("scheme relative=%s assetRoot=%s staged=%s\n", relative, asset_root == NULL ? "(null)" : asset_root, staged == NULL ? "(null)" : staged);
  if (staged == NULL) {
    GError *error = g_error_new_literal(G_IO_ERROR, G_IO_ERROR_NOT_FOUND, "not found");
    webkit_uri_scheme_request_finish_error(request, error);
    g_error_free(error);
    return;
  }
  char *bytes = NULL;
  gsize data_length = 0;
  if (!g_file_get_contents(staged, &bytes, &data_length, NULL) ||
      data_length == 0 || data_length > EBT_MAX_SNAPSHOT_FILE) {
    g_free(bytes);
    GError *error = g_error_new_literal(G_IO_ERROR, G_IO_ERROR_FAILED, "read");
    webkit_uri_scheme_request_finish_error(request, error);
    g_error_free(error);
    return;
  }
  GInputStream *stream = g_memory_input_stream_new_from_data(bytes, (gssize)data_length, g_free);
  webkit_uri_scheme_request_finish(request, stream, (gssize)data_length,
                                   mime_type_for(relative));
  g_object_unref(stream);
}

/* ---- request handlers ---- */

static gboolean require_current(Host *host, Request *request) {
  if (!host->created || request->frame.window != 1 ||
      request->frame.generation != host->generation) {
    request_failure(request, "ELECTRON_MBT_STALE_DOCUMENT");
    return FALSE;
  }
  return TRUE;
}

static JSCValue *request_payload(Request *request) {
  if (request->host->json == NULL) return NULL;
  return json_parse(request->host, request->raw + request->frame.payload_offset,
                    request->frame.payload_length);
}

static gboolean payload_is_empty(Request *request) {
  return request->frame.payload_length == 2 &&
    request->raw[request->frame.payload_offset] == '{' &&
    request->raw[request->frame.payload_offset + 1] == '}';
}

static gboolean on_window_delete(GtkWidget *widget, GdkEvent *event, gpointer data);

static void handle_create_window(Host *host, Request *request) {
  if (request->frame.window != 1 || request->frame.generation != 0 || host->created) {
    request_failure(request, "ELECTRON_MBT_WINDOW_OPTIONS");
    return;
  }
  host->manager = webkit_user_content_manager_new();
  host->web = WEBKIT_WEB_VIEW(
    webkit_web_view_new_with_user_content_manager(host->manager));
  /* A private JSCContext created before WebKit initializes its own VM can
   * stall page loading on this WebKitGTK build. Create it only after the first
   * WebView exists; control frames before create-window are empty and use the
   * manual reply path. */
  if (host->json == NULL) host->json = jsc_context_new();
  if (host->json == NULL) {
    g_object_unref(host->web);
    host->web = NULL;
    g_object_unref(host->manager);
    host->manager = NULL;
    host->handlers_installed = FALSE;
    request_failure(request, "ELECTRON_MBT_NATIVE_FAILURE");
    return;
  }
  install_message_handlers(host);
  JSCValue *payload = request_payload(request);
  if (payload == NULL || !jsc_value_is_object(payload)) {
    if (payload != NULL) g_object_unref(payload);
    g_object_unref(host->web);
    host->web = NULL;
    g_object_unref(host->manager);
    host->manager = NULL;
    host->handlers_installed = FALSE;
    request_failure(request, "ELECTRON_MBT_WINDOW_OPTIONS");
    return;
  }
  static const char *const expected[] = {"width", "height", "title", "show"};
  if (!object_has_exact_keys(payload, expected, 4)) {
    JSCValue *preload_source = object_get_value(payload, "preloadSource");
    JSCValue *preload_sha = object_get_value(payload, "preloadSHA256");
    gboolean wants_preload = preload_source != NULL || preload_sha != NULL;
    if (preload_source != NULL) g_object_unref(preload_source);
    if (preload_sha != NULL) g_object_unref(preload_sha);
    g_object_unref(payload);
    g_object_unref(host->web);
    host->web = NULL;
    g_object_unref(host->manager);
    host->manager = NULL;
    host->handlers_installed = FALSE;
    request_failure(request, wants_preload ? "ELECTRON_MBT_UNSUPPORTED_API"
                                           : "ELECTRON_MBT_WINDOW_OPTIONS");
    return;
  }
  gint64 width = 0;
  gint64 height = 0;
  char *title = object_get_string(payload, "title");
  gboolean show = FALSE;
  if (!object_get_integer(payload, "width", &width) ||
      !object_get_integer(payload, "height", &height) ||
      width < 100 || width > 4096 || height < 100 || height > 4096 ||
      title == NULL || strlen(title) > 256 ||
      !object_get_boolean(payload, "show", &show)) {
    g_free(title);
    g_object_unref(payload);
    g_object_unref(host->web);
    host->web = NULL;
    g_object_unref(host->manager);
    host->manager = NULL;
    host->handlers_installed = FALSE;
    request_failure(request, "ELECTRON_MBT_WINDOW_OPTIONS");
    return;
  }
  g_object_unref(payload);

  WebKitSettings *settings = webkit_web_view_get_settings(host->web);
  webkit_settings_set_enable_developer_extras(settings, FALSE);
  webkit_settings_set_javascript_can_open_windows_automatically(settings, FALSE);
  host->window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_title(GTK_WINDOW(host->window), title);
  gtk_window_set_default_size(GTK_WINDOW(host->window), (gint)width, (gint)height);
  gtk_container_add(GTK_CONTAINER(host->window), GTK_WIDGET(host->web));
  g_signal_connect(host->window, "delete-event", G_CALLBACK(on_window_delete), host);
  g_signal_connect(host->web, "load-changed", G_CALLBACK(on_load_changed), host);
  g_signal_connect(host->web, "load-failed", G_CALLBACK(on_load_failed), host);
  g_signal_connect(host->web, "web-process-terminated",
                   G_CALLBACK(on_web_process_terminated), host);
  gtk_widget_show_all(host->window);
  ebt_debug("window-realized=%d mapped=%d\n",
            gtk_widget_get_realized(host->window),
            gtk_widget_get_mapped(host->window));
  host->created = TRUE;
  host->content_alive = TRUE;
  host->generation = 0;
  host->loaded = FALSE;
  host->load_in_progress = FALSE;

  JSCValue *reply = object_new(host);
  object_set_boolean(host, reply, "webViewAttached", TRUE);
  object_set_boolean(host, reply, "visible", show);
  object_set_number(host, reply, "width", (double)width);
  object_set_number(host, reply, "height", (double)height);
  g_free(title);
  request_complete(request, "success", reply);
}

static void handle_prepare_source(Host *host, Request *request, JSCValue *payload) {
  static const char *const expected[] = {"file"};
  if (!require_current(host, request)) return;
  if (host->load_in_progress) {
    request_failure(request, "ELECTRON_MBT_STALE_DOCUMENT");
    return;
  }
  if (!object_has_exact_keys(payload, expected, 1)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *file = object_get_string(payload, "file");
  if (file == NULL || !safe_relative_path(file)) {
    g_free(file);
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  const char *code = NULL;
  Snapshot *snapshot = snapshot_build(host, file, &code);
  if (snapshot == NULL) {
    request_failure(request, code == NULL ? "ELECTRON_MBT_SOURCE_MANIFEST" : code);
    g_free(file);
    return;
  }
  snapshot_free(host->snapshot);
  host->snapshot = snapshot;
  JSCValue *reply = object_new(host);
  object_set_boolean(host, reply, "prepared", TRUE);
  object_set_string(host, reply, "sha256", snapshot->entry_sha256);
  object_set_number(host, reply, "bytes", (double)snapshot->total_bytes);
  object_set_number(host, reply, "files", (double)g_hash_table_size(snapshot->by_relative));
  object_set_string(host, reply, "manifestSHA256", snapshot->manifest_sha256);
  request_complete(request, "success", reply);
  g_free(file);
}

static void handle_install_adapter(Host *host, Request *request, JSCValue *payload) {
  static const char *const expected[] = {"file"};
  if (!require_current(host, request)) return;
  if (host->load_in_progress) {
    request_failure(request, "ELECTRON_MBT_STALE_DOCUMENT");
    return;
  }
  if (!object_has_exact_keys(payload, expected, 1)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *file = object_get_string(payload, "file");
  if (file == NULL) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *read_path = NULL;
  if (host->snapshot != NULL) {
    char *canonical = realpath(file, NULL);
    if (canonical != NULL) {
      const char *staged = g_hash_table_lookup(host->snapshot->by_source, canonical);
      if (staged != NULL) read_path = g_strdup(staged);
      free(canonical);
    }
    if (read_path == NULL) {
      canonical = canonical_file_under_root(host->root, file);
      if (canonical != NULL) read_path = g_strdup(canonical);
      free(canonical);
    }
  } else {
    read_path = canonical_file_under_root(host->root, file);
  }
  if (read_path == NULL) {
    request_failure(request, "ELECTRON_MBT_SOURCE_DENIED");
    g_free(file);
    return;
  }
  char *data = NULL;
  gsize length = 0;
  if (!g_file_get_contents(read_path, &data, &length, NULL) ||
      length == 0 || length > EBT_MAX_ADAPTER) {
    g_free(data);
    g_free(read_path);
    g_free(file);
    request_failure(request, "ELECTRON_MBT_WINDOW_OPTIONS");
    return;
  }
  g_free(host->adapter_source);
  host->adapter_source = data;
  install_message_handlers(host);
  JSCValue *reply = object_new(host);
  object_set_boolean(host, reply, "installed", TRUE);
  request_complete(request, "success", reply);
  g_free(read_path);
  g_free(file);
}

static void handle_begin_load(Host *host, Request *request) {
  if (!host->created || request->frame.window != 1 ||
      request->frame.generation <= host->generation ||
      request->frame.generation <= 0) {
    request_failure(request, "ELECTRON_MBT_STALE_DOCUMENT");
    return;
  }
  if (!host->content_alive) {
    request_failure(request, "ELECTRON_MBT_WEB_PROCESS_TERMINATED");
    return;
  }
  if (host->load_request != NULL) fail_load_request(host, "ELECTRON_MBT_STALE_DOCUMENT");
  fail_pending(host, "ELECTRON_MBT_STALE_DOCUMENT");
  host->generation = request->frame.generation;
  host->load_in_progress = FALSE;
  host->load_failed = FALSE;
  host->loaded = FALSE;
  host->loaded_generation = 0;
  g_free(host->loaded_uri);
  host->loaded_uri = NULL;
  g_free(host->loaded_file);
  host->loaded_file = NULL;
  host->adapter_observed = FALSE;
  host->adapter_before_load = FALSE;
  host->adapter_generation = 0;
  host->ingress_released = FALSE;
  host->ingress_released_generation = 0;
  host->ingress_admitted = 0;
  host->ingress_denied = 0;
  host->ingress_unhandled = 0;
  host->ingress_last_code[0] = 0;
  g_free(host->message_nonce);
  host->message_nonce = NULL;
  g_free(host->adapter_nonce);
  host->adapter_nonce = NULL;
  webkit_web_view_stop_loading(host->web);
  webkit_user_content_manager_remove_all_scripts(host->manager);
  JSCValue *reply = object_new(host);
  object_set_number(host, reply, "generation", (double)host->generation);
  request_complete(request, "success", reply);
}

static void start_load(Host *host, Request *request, JSCValue *payload,
                       gboolean snapshot_load) {
  static const char *const expected[] = {"file"};
  if (!require_current(host, request)) return;
  if (!host->content_alive) {
    request_failure(request, "ELECTRON_MBT_WEB_PROCESS_TERMINATED");
    return;
  }
  if (host->load_in_progress || host->loaded_generation >= host->generation) {
    request_failure(request, "ELECTRON_MBT_FILE_OR_GENERATION_DENIED");
    return;
  }
  if (!object_has_exact_keys(payload, expected, 1)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *file = object_get_string(payload, "file");
  if (file == NULL) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *url = NULL;
  char *loaded_file = NULL;
  if (snapshot_load) {
    if (host->snapshot == NULL || strcmp(file, host->snapshot->entry) != 0) {
      g_free(file);
      request_failure(request, "ELECTRON_MBT_FILE_OR_GENERATION_DENIED");
      return;
    }
    url = g_strdup_printf("electron-mbt-app://app/%s", file);
    loaded_file = g_strdup(file);
  } else {
    char *canonical = NULL;
    if (file[0] == '/') canonical = realpath(file, NULL);
    else {
      char *joined = g_build_filename(host->root, file, NULL);
      canonical = realpath(joined, NULL);
      g_free(joined);
    }
    size_t root_length = strlen(host->root);
    if (canonical == NULL || strncmp(canonical, host->root, root_length) != 0 ||
        canonical[root_length] != '/') {
      free(canonical);
      g_free(file);
      request_failure(request, "ELECTRON_MBT_FILE_OR_GENERATION_DENIED");
      return;
    }
    url = g_filename_to_uri(canonical, NULL, NULL);
    loaded_file = g_strdup(canonical);
    free(canonical);
  }
  g_free(file);
  if (url == NULL || loaded_file == NULL) {
    g_free(url);
    g_free(loaded_file);
    request_failure(request, "ELECTRON_MBT_LOAD_FAILED");
    return;
  }
  install_page_scripts(host);
  host->load_in_progress = TRUE;
  host->load_failed = FALSE;
  host->loaded = FALSE;
  host->loaded_is_snapshot = snapshot_load;
  host->load_request = request;
  g_free(host->loaded_uri);
  host->loaded_uri = url;
  g_free(host->loaded_file);
  host->loaded_file = loaded_file;
  ebt_debug("start-load uri=%s snapshot=%d webMapped=%d webRealized=%d\n",
            host->loaded_uri, snapshot_load ? 1 : 0,
            gtk_widget_get_mapped(GTK_WIDGET(host->web)),
            gtk_widget_get_realized(GTK_WIDGET(host->web)));
  webkit_web_view_load_uri(host->web, host->loaded_uri);
  ebt_debug("start-load-called loading=%d uri=%s\n",
            webkit_web_view_is_loading(host->web),
            webkit_web_view_get_uri(host->web) == NULL ? "(null)" : webkit_web_view_get_uri(host->web));
}

typedef struct ProbeContext {
  Host *host;
  Request *request;
} ProbeContext;

static void probe_renderer_finished(GObject *source, GAsyncResult *result,
                                    gpointer data) {
  ProbeContext *context = data;
  GError *error = NULL;
  JSCValue *value = webkit_web_view_evaluate_javascript_finish(
    WEBKIT_WEB_VIEW(source), result, &error);
  if (error != NULL || value == NULL) {
    g_clear_error(&error);
    if (value != NULL) g_object_unref(value);
    request_failure(context->request, "ELECTRON_MBT_RENDERER_PROBE");
    g_free(context);
    return;
  }
  char *json = jsc_value_to_json(value, 0);
  g_object_unref(value);
  JSCValue *payload = json == NULL ? NULL : json_parse(context->host, json, strlen(json));
  g_free(json);
  if (payload == NULL) {
    request_failure(context->request, "ELECTRON_MBT_RENDERER_PROBE");
  } else {
    request_complete(context->request, "success", payload);
  }
  g_free(context);
}

static void handle_probe_renderer(Host *host, Request *request) {
  if (!require_current(host, request)) return;
  if (!host->content_alive || !host->loaded) {
    request_failure(request, "ELECTRON_MBT_STALE_DOCUMENT");
    return;
  }
  static const char script[] =
    "(function(){ const root=document.getElementById('root'); "
    "return {api: !!(window.api && typeof window.api.getSettings === 'function'), "
    "rootChildren: root ? root.childElementCount : 0, title: document.title, "
    "text: (document.body && document.body.innerText || '').slice(0, 160), "
    "apiProbe: window.__mojiApiProbe ? JSON.stringify(window.__mojiApiProbe) : '', "
    "editSave: window.__mojiEditSaveProbe ? JSON.stringify(window.__mojiEditSaveProbe) : ''}; })()";
  ProbeContext *context = g_new0(ProbeContext, 1);
  context->host = host;
  context->request = request;
  webkit_web_view_evaluate_javascript(host->web, script, -1, NULL, NULL, NULL,
                                      probe_renderer_finished, context);
}

static void handle_get_ingress_status(Host *host, Request *request) {
  if (!require_current(host, request)) return;
  JSCValue *reply = object_new(host);
  object_set_number(host, reply, "admitted", (double)host->ingress_admitted);
  object_set_number(host, reply, "denied", (double)host->ingress_denied);
  object_set_number(host, reply, "unhandled", (double)host->ingress_unhandled);
  object_set_number(host, reply, "fileSaveAdmitted", 0);
  object_set_number(host, reply, "fileSaveDenied", 0);
  object_set_string(host, reply, "lastCode", host->ingress_last_code);
  object_set_number(host, reply, "generation", (double)host->generation);
  request_complete(request, "success", reply);
}

static void handle_get_adapted_status(Host *host, Request *request) {
  if (!require_current(host, request)) return;
  gboolean observed = host->adapter_observed &&
    host->adapter_generation == host->generation;
  gboolean released = observed && host->ingress_released &&
    host->ingress_released_generation == host->generation;
  JSCValue *reply = object_new(host);
  object_set_boolean(host, reply, "observed", observed);
  object_set_boolean(host, reply, "released", released);
  object_set_number(host, reply, "generation", (double)host->generation);
  object_set_boolean(host, reply, "documentStartBeforeLoad", host->adapter_before_load);
  object_set_string(host, reply, "ingress", "absent");
  request_complete(request, "success", reply);
}

static void handle_get_document_identity(Host *host, Request *request) {
  if (!require_current(host, request)) return;
  const char *uri = host->web == NULL ? NULL : webkit_web_view_get_uri(host->web);
  gboolean observed = host->content_alive && host->loaded &&
    host->loaded_generation == host->generation && host->loaded_uri != NULL &&
    uri != NULL && strcmp(uri, host->loaded_uri) == 0 &&
    !host->load_in_progress;
  if (!observed) {
    request_failure(request, "ELECTRON_MBT_STALE_DOCUMENT");
    return;
  }
  JSCValue *reply = object_new(host);
  object_set_number(host, reply, "generation", (double)host->generation);
  object_set_string(host, reply, "source",
                    host->loaded_is_snapshot ? "snapshot" : "app");
  object_set_string(host, reply,
                    "sha256",
                    host->loaded_is_snapshot && host->snapshot != NULL
                      ? host->snapshot->entry_sha256 : "");
  object_set_string(host, reply,
                    "manifestSHA256",
                    host->loaded_is_snapshot && host->snapshot != NULL
                      ? host->snapshot->manifest_sha256 : "");
  request_complete(request, "success", reply);
}

static void handle_app_reply(Host *host, Request *request, JSCValue *payload) {
  static const char *const expected[] = {"request", "json"};
  if (!require_current(host, request)) return;
  if (!object_has_exact_keys(payload, expected, 2)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *request_id = object_get_string(payload, "request");
  char *json = object_get_string(payload, "json");
  if (request_id == NULL || strlen(request_id) > 64 ||
      json == NULL || strlen(json) > EBT_MAX_APP_PAYLOAD) {
    g_free(request_id);
    g_free(json);
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  PendingReply *pending = NULL;
  gpointer pending_key = NULL;
  if (!g_hash_table_steal_extended(host->pending, request_id, &pending_key, (gpointer *)&pending)) {
    g_free(request_id);
    g_free(json);
    request_failure(request, "ELECTRON_MBT_MAIN_UNKNOWN_REQUEST");
    return;
  }
  g_free(pending_key);
  JSCValue *parsed = jsc_value_new_from_json(pending->context, json);
  if (jsc_context_get_exception(pending->context) != NULL) {
    jsc_context_clear_exception(pending->context);
  }
  g_free(request_id);
  g_free(json);
  if (parsed == NULL || !jsc_value_is_object(parsed)) {
    ebt_debug("app-reply invalid json=%s\n", json == NULL ? "(null)" : json);
    webkit_script_message_reply_return_error_message(pending->reply,
                                                     "ELECTRON_MBT_MAIN_ERROR");
  } else {
    JSCValue *ok_value = object_get_value(parsed, "ok");
    gboolean ok = ok_value != NULL && jsc_value_is_boolean(ok_value) &&
      jsc_value_to_boolean(ok_value);
    if (ok_value != NULL) g_object_unref(ok_value);
    if (ok) {
      JSCValue *result = object_get_value(parsed, "result");
      if (result == NULL) {
        JSCValue *null_value = jsc_value_new_null(pending->context);
        webkit_script_message_reply_return_value(pending->reply, null_value);
        g_object_unref(null_value);
      } else {
        webkit_script_message_reply_return_value(pending->reply, result);
        g_object_unref(result);
      }
    } else {
      char *code = object_get_string(parsed, "code");
      char *message = object_get_string(parsed, "message");
      char *short_message = message == NULL ? NULL : g_strndup(message, 1024);
      char *error_text = g_strdup_printf("%s%s%s",
        code == NULL ? "ELECTRON_MBT_MAIN_ERROR" : code,
        short_message == NULL || short_message[0] == 0 ? "" : ": ",
        short_message == NULL ? "" : short_message);
      ebt_debug("app-reply error code=%s message=%s\n",
                code == NULL ? "(null)" : code,
                short_message == NULL ? "(null)" : short_message);
      webkit_script_message_reply_return_error_message(pending->reply, error_text);
      g_free(error_text);
      g_free(short_message);
      g_free(message);
      g_free(code);
    }
  }
  if (parsed != NULL) g_object_unref(parsed);
  pending_free(pending);
  request_success_empty(request);
}

static void handle_inject_app_request(Host *host, Request *request,
                                      JSCValue *payload) {
  const char *test_mode = getenv("ELECTRON_MBT_TEST_MODE");
  static const char *const expected[] = {"generation", "request"};
  if (!require_current(host, request)) return;
  if (test_mode == NULL || strcmp(test_mode, "1") != 0 ||
      !object_has_exact_keys(payload, expected, 2)) {
    request_failure(request, "ELECTRON_MBT_INGRESS_INJECTION_DENIED");
    return;
  }
  gint64 generation = 0;
  JSCValue *injected = object_get_value(payload, "request");
  if (!object_get_integer(payload, "generation", &generation) ||
      injected == NULL || !jsc_value_is_object(injected)) {
    if (injected != NULL) g_object_unref(injected);
    request_failure(request, "ELECTRON_MBT_INGRESS_INJECTION_DENIED");
    return;
  }
  static const char *const request_keys[] = {"request", "operation", "payload"};
  char *request_id = object_get_string(injected, "request");
  char *operation = object_get_string(injected, "operation");
  JSCValue *injected_payload = object_get_value(injected, "payload");
  gboolean valid = object_has_exact_keys(injected, request_keys, 3) &&
    request_id != NULL && request_id[0] != 0 && strlen(request_id) <= 64 &&
    operation != NULL && operation[0] != 0 && strlen(operation) <= 128 &&
    injected_payload != NULL && jsc_value_is_object(injected_payload);
  if (!valid) {
    g_free(request_id);
    g_free(operation);
    if (injected_payload != NULL) g_object_unref(injected_payload);
    g_object_unref(injected);
    request_failure(request, "ELECTRON_MBT_INGRESS_INJECTION_DENIED");
    return;
  }
  char *payload_json = jsc_value_to_json(injected_payload, 0);
  g_object_unref(injected_payload);
  JSCValue *event_payload = object_new(host);
  object_set_string(host, event_payload, "request", request_id);
  object_set_string(host, event_payload, "operation", operation);
  if (payload_json != NULL) {
    JSCValue *control_payload = json_parse(host, payload_json, strlen(payload_json));
    if (control_payload != NULL) {
      jsc_value_object_set_property(event_payload, "payload", control_payload);
      g_object_unref(control_payload);
    }
  }
  gboolean published = publish_event(host, "app-request", generation, event_payload);
  if (!published) {
    request_failure(request, "ELECTRON_MBT_MAIN_BUSY");
  } else {
    JSCValue *reply = object_new(host);
    object_set_boolean(host, reply, "injected", TRUE);
    request_complete(request, "success", reply);
  }
  g_free(request_id);
  g_free(operation);
  g_free(payload_json);
  g_object_unref(injected);
}

/* ---- minimal main fs and GTK open/save dialogs ---- */

static gboolean path_is_under(const char *path, const char *root) {
  if (path == NULL || root == NULL) return FALSE;
  size_t root_length = strlen(root);
  if (root_length == 0 || strncmp(path, root, root_length) != 0) return FALSE;
  return path[root_length] == 0 || path[root_length] == '/';
}

static char *host_join_path(Host *host, const char *path) {
  if (host == NULL || path == NULL || path[0] == 0 ||
      strlen(path) > EBT_MAX_MAIN_PATH) return NULL;
  if (g_path_is_absolute(path)) return strdup(path);
  size_t root_length = strlen(host->root);
  size_t path_length = strlen(path);
  size_t needed = root_length + 1 + path_length + 1;
  char *joined = (char *)malloc(needed);
  if (joined == NULL) return NULL;
  snprintf(joined, needed, "%s/%s", host->root, path);
  return joined;
}

static char *canonical_existing_path(Host *host, const char *path) {
  char *joined = host_join_path(host, path);
  if (joined == NULL) return NULL;
  char *canonical = realpath(joined, NULL);
  free(joined);
  return canonical;
}

static char *canonical_write_path(Host *host, const char *path) {
  char *joined = host_join_path(host, path);
  if (joined == NULL) return NULL;
  char *canonical = realpath(joined, NULL);
  if (canonical != NULL) {
    free(joined);
    return canonical;
  }
  if (errno != ENOENT) {
    free(joined);
    return NULL;
  }
  char *directory = g_path_get_dirname(joined);
  char *base = g_path_get_basename(joined);
  gboolean valid = base != NULL && base[0] != 0 &&
    strcmp(base, ".") != 0 && strcmp(base, "..") != 0 && strchr(base, '/') == NULL;
  if (!valid) {
    g_free(directory);
    g_free(base);
    free(joined);
    return NULL;
  }
  char *parent = realpath(directory, NULL);
  struct stat info;
  if (parent == NULL || stat(parent, &info) != 0 || !S_ISDIR(info.st_mode)) {
    free(parent);
    g_free(directory);
    g_free(base);
    free(joined);
    return NULL;
  }
  size_t needed = strlen(parent) + 1 + strlen(base) + 1;
  canonical = (char *)malloc(needed);
  if (canonical != NULL) snprintf(canonical, needed, "%s/%s", parent, base);
  free(parent);
  g_free(directory);
  g_free(base);
  free(joined);
  if (canonical != NULL && strlen(canonical) > EBT_MAX_MAIN_PATH) {
    free(canonical);
    return NULL;
  }
  return canonical;
}

static int file_grant_mode(Host *host, const char *canonical) {
  if (host == NULL || host->file_grants == NULL || canonical == NULL) return 0;
  return GPOINTER_TO_INT(g_hash_table_lookup(host->file_grants, canonical));
}

static void grant_file(Host *host, const char *canonical, int mode) {
  if (host == NULL || host->file_grants == NULL || canonical == NULL) return;
  int current = file_grant_mode(host, canonical);
  g_hash_table_insert(host->file_grants, g_strdup(canonical),
                      GINT_TO_POINTER(current | mode));
}

static gboolean app_data_allows_write(Host *host, const char *canonical) {
  char *app_data = g_build_filename(host->root, ".appData", NULL);
  char *user_data = g_build_filename(host->root, ".userData", NULL);
  gboolean allowed = path_is_under(canonical, app_data) ||
    path_is_under(canonical, user_data);
  g_free(app_data);
  g_free(user_data);
  return allowed;
}

static gboolean main_read_allowed(Host *host, const char *canonical) {
  if (path_is_under(canonical, host->root)) return TRUE;
  return (file_grant_mode(host, canonical) &
          (EBT_GRANT_READ | EBT_GRANT_WRITE)) != 0;
}

static gboolean main_write_allowed(Host *host, const char *canonical) {
  if (app_data_allows_write(host, canonical)) return TRUE;
  return (file_grant_mode(host, canonical) & EBT_GRANT_WRITE) != 0;
}

static void handle_main_read_file(Host *host, Request *request, JSCValue *payload) {
  static const char *const expected[] = {"path"};
  if (!object_has_exact_keys(payload, expected, 1)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *path = object_get_string(payload, "path");
  char *canonical = path == NULL ? NULL : canonical_existing_path(host, path);
  if (canonical == NULL || !main_read_allowed(host, canonical)) {
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_DENIED");
    return;
  }
  struct stat info;
  if (stat(canonical, &info) != 0) {
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_NOT_FOUND");
    return;
  }
  if (!S_ISREG(info.st_mode)) {
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_TYPE");
    return;
  }
  if (info.st_size < 0 || (guint64)info.st_size > EBT_MAX_MAIN_READ) {
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_LIMIT");
    return;
  }
  gchar *data = NULL;
  gsize length = 0;
  if (!g_file_get_contents(canonical, &data, &length, NULL)) {
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_READ");
    return;
  }
  if (length > EBT_MAX_MAIN_READ) {
    g_free(data);
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_LIMIT");
    return;
  }
  gchar *base64 = g_base64_encode((const guchar *)(data == NULL ? (gchar *)"" : data),
                                  length);
  JSCValue *reply = object_new(host);
  object_set_string(host, reply, "path", canonical);
  object_set_string(host, reply, "base64", base64 == NULL ? "" : base64);
  object_set_number(host, reply, "bytes", (double)length);
  request_complete(request, "success", reply);
  g_free(base64);
  g_free(data);
  g_free(path);
  free(canonical);
}

static gboolean direct_write_file(const char *path, const char *data, size_t length,
                                  int *out_errno) {
  int fd = open(path, O_WRONLY | O_TRUNC | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) {
    if (out_errno != NULL) *out_errno = errno;
    return FALSE;
  }
  size_t offset = 0;
  while (offset < length) {
    ssize_t written = write(fd, data + offset, length - offset);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) {
      if (out_errno != NULL) *out_errno = written < 0 ? errno : EIO;
      close(fd);
      return FALSE;
    }
    offset += (size_t)written;
  }
  if (close(fd) != 0) {
    if (out_errno != NULL) *out_errno = errno;
    return FALSE;
  }
  return TRUE;
}

static void handle_main_write_file(Host *host, Request *request, JSCValue *payload) {
  static const char *const expected[] = {"path", "base64"};
  if (!object_has_exact_keys(payload, expected, 2)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *path = object_get_string(payload, "path");
  char *base64 = object_get_string(payload, "base64");
  if (path == NULL || base64 == NULL || strlen(base64) > EBT_MAX_MAIN_BASE64) {
    g_free(path);
    g_free(base64);
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  gsize length = 0;
  guchar *data = g_base64_decode(base64, &length);
  if ((data == NULL && length != 0) || length > EBT_MAX_MAIN_WRITE) {
    g_free(data);
    g_free(path);
    g_free(base64);
    request_failure(request, length > EBT_MAX_MAIN_WRITE ? "ELECTRON_MBT_FILE_LIMIT"
                                                         : "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *canonical = canonical_write_path(host, path);
  ebt_debug("main-write path=%s canonical=%s allowed=%d\n", path,
            canonical == NULL ? "(null)" : canonical,
            canonical == NULL ? 0 : main_write_allowed(host, canonical));
  if (canonical == NULL || !main_write_allowed(host, canonical)) {
    g_free(data);
    g_free(path);
    g_free(base64);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_DENIED");
    return;
  }
  struct stat info;
  if (stat(canonical, &info) == 0 && S_ISDIR(info.st_mode)) {
    g_free(data);
    g_free(path);
    g_free(base64);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_TYPE");
    return;
  }
  const char *bytes = data == NULL ? "" : (const char *)data;
  GError *error = NULL;
  gboolean written = g_file_set_contents(canonical, bytes, (gssize)length, &error);
  if (!written) {
    gboolean readonly = (error != NULL && error->domain == G_FILE_ERROR &&
                         error->code == G_FILE_ERROR_ROFS);
    gboolean parent_permission = (error != NULL && error->domain == G_FILE_ERROR &&
                                  (error->code == G_FILE_ERROR_ACCES ||
                                   error->code == G_FILE_ERROR_PERM));
    ebt_debug("main-write atomic failed path=%s readonly=%d parent-permission=%d error=%s\n",
              canonical, readonly, parent_permission,
              error == NULL ? "(null)" : error->message);
    g_clear_error(&error);
    if (readonly) {
      g_free(data);
      g_free(path);
      g_free(base64);
      free(canonical);
      request_failure(request, "ELECTRON_MBT_FILE_READ_ONLY");
      return;
    }
    if (!parent_permission) {
      g_free(data);
      g_free(path);
      g_free(base64);
      free(canonical);
      request_failure(request, "ELECTRON_MBT_FILE_WRITE");
      return;
    }
    /* g_file_set_contents writes a sibling temp file and renames it. That
     * requires write permission on the parent directory even when the exact
     * file is writable. Electron/Node fs.writeFile opens the file itself, so
     * fall back to a direct exact-file write only for the parent-permission
     * case; a full disk or read-only filesystem must not truncate the file. */
    struct stat direct_info;
    int direct_errno = 0;
    gboolean direct = stat(canonical, &direct_info) == 0 &&
      S_ISREG(direct_info.st_mode) &&
      direct_write_file(canonical, bytes, (size_t)length, &direct_errno);
    if (!direct) {
      g_free(data);
      g_free(path);
      g_free(base64);
      free(canonical);
      request_failure(request,
        direct_errno == EROFS ? "ELECTRON_MBT_FILE_READ_ONLY"
        : direct_errno == EACCES || direct_errno == EPERM
          ? "ELECTRON_MBT_FILE_DENIED" : "ELECTRON_MBT_FILE_WRITE");
      return;
    }
    written = TRUE;
  }
  g_clear_error(&error);
  JSCValue *reply = object_new(host);
  object_set_string(host, reply, "path", canonical);
  object_set_number(host, reply, "bytes", (double)length);
  request_complete(request, "success", reply);
  g_free(data);
  g_free(path);
  g_free(base64);
  free(canonical);
}

static const char *main_fs_error_code(int error) {
  switch (error) {
    case ENOENT: return "ELECTRON_MBT_FILE_NOT_FOUND";
    case EACCES:
    case EPERM: return "ELECTRON_MBT_FILE_DENIED";
    case EROFS: return "ELECTRON_MBT_FILE_READ_ONLY";
    case EEXIST: return "ELECTRON_MBT_FILE_EXISTS";
    case EISDIR:
    case ENOTDIR: return "ELECTRON_MBT_FILE_TYPE";
    case EFBIG:
    case ENOSPC:
    case EDQUOT: return "ELECTRON_MBT_FILE_LIMIT";
    default: return "ELECTRON_MBT_FILE_WRITE";
  }
}

static void handle_main_rename(Host *host, Request *request, JSCValue *payload) {
  static const char *const expected[] = {"path", "destination"};
  if (!object_has_exact_keys(payload, expected, 2)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *path = object_get_string(payload, "path");
  char *destination = object_get_string(payload, "destination");
  if (path == NULL || destination == NULL) {
    g_free(path);
    g_free(destination);
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *source = canonical_existing_path(host, path);
  char *target = canonical_write_path(host, destination);
  if (source == NULL) {
    g_free(path);
    g_free(destination);
    free(target);
    request_failure(request, "ELECTRON_MBT_FILE_NOT_FOUND");
    return;
  }
  if (target == NULL || !main_write_allowed(host, source) ||
      !main_write_allowed(host, target)) {
    g_free(path);
    g_free(destination);
    free(source);
    free(target);
    request_failure(request, "ELECTRON_MBT_FILE_DENIED");
    return;
  }
  struct stat info;
  if (stat(source, &info) != 0) {
    g_free(path);
    g_free(destination);
    free(source);
    free(target);
    request_failure(request, "ELECTRON_MBT_FILE_NOT_FOUND");
    return;
  }
  if (!S_ISREG(info.st_mode)) {
    g_free(path);
    g_free(destination);
    free(source);
    free(target);
    request_failure(request, "ELECTRON_MBT_FILE_TYPE");
    return;
  }
  if (rename(source, target) != 0) {
    int error = errno;
    g_free(path);
    g_free(destination);
    free(source);
    free(target);
    request_failure(request, main_fs_error_code(error));
    return;
  }
  JSCValue *reply = object_new(host);
  object_set_string(host, reply, "path", target);
  request_complete(request, "success", reply);
  g_free(path);
  g_free(destination);
  free(source);
  free(target);
}

static void handle_main_unlink(Host *host, Request *request, JSCValue *payload) {
  static const char *const expected[] = {"path"};
  if (!object_has_exact_keys(payload, expected, 1)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *path = object_get_string(payload, "path");
  char *canonical = path == NULL ? NULL : canonical_existing_path(host, path);
  if (canonical == NULL || !main_write_allowed(host, canonical)) {
    const char *code = canonical == NULL ? "ELECTRON_MBT_FILE_NOT_FOUND"
                                          : "ELECTRON_MBT_FILE_DENIED";
    g_free(path);
    free(canonical);
    request_failure(request, code);
    return;
  }
  struct stat info;
  if (lstat(canonical, &info) != 0) {
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_NOT_FOUND");
    return;
  }
  if (S_ISDIR(info.st_mode)) {
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_TYPE");
    return;
  }
  if (unlink(canonical) != 0) {
    int error = errno;
    g_free(path);
    free(canonical);
    request_failure(request, main_fs_error_code(error));
    return;
  }
  JSCValue *reply = object_new(host);
  object_set_string(host, reply, "path", canonical);
  request_complete(request, "success", reply);
  g_free(path);
  free(canonical);
}

static void handle_main_read_dir(Host *host, Request *request, JSCValue *payload) {
  static const char *const expected[] = {"path"};
  if (!object_has_exact_keys(payload, expected, 1)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *path = object_get_string(payload, "path");
  char *canonical = path == NULL ? NULL : canonical_existing_path(host, path);
  if (canonical == NULL || !main_read_allowed(host, canonical)) {
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_DENIED");
    return;
  }
  struct stat info;
  if (stat(canonical, &info) != 0) {
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_NOT_FOUND");
    return;
  }
  if (!S_ISDIR(info.st_mode)) {
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_TYPE");
    return;
  }
  GError *error = NULL;
  GDir *directory = g_dir_open(canonical, 0, &error);
  if (directory == NULL) {
    g_clear_error(&error);
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_READ");
    return;
  }
  GString *json = g_string_new("[");
  guint count = 0;
  const char *name = NULL;
  while ((name = g_dir_read_name(directory)) != NULL && count < 4096) {
    if (name[0] == 0 || strlen(name) > 255 ||
        strcmp(name, ".") == 0 || strcmp(name, "..") == 0) {
      continue;
    }
    char *full = g_build_filename(canonical, name, NULL);
    if (full == NULL) continue;
    struct stat entry_info;
    const char *kind = "other";
    if (lstat(full, &entry_info) == 0) {
      if (S_ISREG(entry_info.st_mode)) kind = "file";
      else if (S_ISDIR(entry_info.st_mode)) kind = "directory";
      else if (S_ISLNK(entry_info.st_mode)) kind = "symlink";
    }
    g_free(full);
    JSCValue *name_value = jsc_value_new_string(host->json, name);
    char *quoted_name = name_value == NULL ? NULL : jsc_value_to_json(name_value, 0);
    if (name_value != NULL) g_object_unref(name_value);
    if (quoted_name == NULL) continue;
    if (count > 0) g_string_append_c(json, ',');
    g_string_append_printf(json, "{\"name\":%s,\"kind\":\"%s\"}", quoted_name, kind);
    g_free(quoted_name);
    count += 1;
  }
  g_dir_close(directory);
  if (json->len > 480 * 1024) {
    g_string_free(json, TRUE);
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_LIMIT");
    return;
  }
  g_string_append_c(json, ']');
  if (json->len > 512 * 1024) {
    g_string_free(json, TRUE);
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_LIMIT");
    return;
  }
  JSCValue *entries = json_parse(host, json->str, json->len);
  g_string_free(json, TRUE);
  if (entries == NULL) {
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_MAIN_ERROR");
    return;
  }
  JSCValue *reply = object_new(host);
  object_set_string(host, reply, "path", canonical);
  jsc_value_object_set_property(reply, "entries", entries);
  g_object_unref(entries);
  request_complete(request, "success", reply);
  g_free(path);
  free(canonical);
}

static void handle_main_mkdir(Host *host, Request *request, JSCValue *payload) {
  static const char *const expected[] = {"path", "recursive"};
  if (!object_has_exact_keys(payload, expected, 2)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *path = object_get_string(payload, "path");
  JSCValue *recursive_value = object_get_value(payload, "recursive");
  gboolean recursive = recursive_value != NULL && jsc_value_is_boolean(recursive_value) &&
    jsc_value_to_boolean(recursive_value);
  if (recursive_value != NULL) g_object_unref(recursive_value);
  if (path == NULL) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *canonical = canonical_write_path(host, path);
  gboolean created = FALSE;
  /* Missing parent directories are not created here. Recursive creation via
   * g_mkdir_with_parents would follow a symlinked ancestor outside the app
   * data roots; callers must create parents through the same policy first. */
  if (canonical == NULL) {
    g_free(path);
    request_failure(request, "ELECTRON_MBT_FILE_NOT_FOUND");
    return;
  }
  if (!main_write_allowed(host, canonical)) {
    g_free(path);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_DENIED");
    return;
  }
  struct stat info;
  if (stat(canonical, &info) == 0) {
    if (!S_ISDIR(info.st_mode)) {
      g_free(path);
      free(canonical);
      request_failure(request, "ELECTRON_MBT_FILE_TYPE");
      return;
    }
    if (!recursive) {
      g_free(path);
      free(canonical);
      request_failure(request, "ELECTRON_MBT_FILE_EXISTS");
      return;
    }
  } else if (!created && mkdir(canonical, 0700) != 0) {
    int error = errno;
    g_free(path);
    free(canonical);
    request_failure(request, main_fs_error_code(error));
    return;
  } else {
    created = TRUE;
  }
  JSCValue *reply = object_new(host);
  object_set_string(host, reply, "path", canonical);
  object_set_string(host, reply, "firstCreated", created ? canonical : "");
  request_complete(request, "success", reply);
  g_free(path);
  free(canonical);
}

static void cleanup_export_zlib(Host *host) {
  if (host == NULL || host->export_zlib == NULL) return;
  deflateEnd(host->export_zlib);
  g_free(host->export_zlib);
  host->export_zlib = NULL;
  host->export_zlib_token = 0;
}

static void handle_zlib_deflate_start(Host *host, Request *request,
                                      JSCValue *payload) {
  if (!object_has_exact_keys(payload, NULL, 0)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  if (host->export_zlib != NULL) {
    request_failure(request, "ELECTRON_MBT_WINDOW_OPTIONS");
    return;
  }
  z_stream *stream = g_new0(z_stream, 1);
  int result = deflateInit(stream, Z_DEFAULT_COMPRESSION);
  if (result != Z_OK) {
    g_free(stream);
    request_failure(request, "ELECTRON_MBT_NATIVE_FAILURE");
    return;
  }
  host->export_zlib = stream;
  /* One zlib stream per host. A small token keeps the JS number exact. */
  host->export_zlib_token = 1;
  JSCValue *reply = object_new(host);
  object_set_number(host, reply, "token", (double)host->export_zlib_token);
  request_complete(request, "success", reply);
}

static void handle_zlib_deflate_write(Host *host, Request *request,
                                      JSCValue *payload) {
  static const char *const expected[] = {"token", "base64"};
  if (!object_has_exact_keys(payload, expected, 2)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  gint64 token = 0;
  char *base64 = object_get_string(payload, "base64");
  if (base64 == NULL || !object_get_integer(payload, "token", &token) ||
      host->export_zlib == NULL || (guint64)token != host->export_zlib_token ||
      strlen(base64) > EBT_MAX_MAIN_BASE64) {
    g_free(base64);
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  gsize length = 0;
  guchar *data = g_base64_decode(base64, &length);
  g_free(base64);
  if ((data == NULL && length != 0) || length > EBT_MAX_MAIN_WRITE) {
    g_free(data);
    request_failure(request, "ELECTRON_MBT_FILE_LIMIT");
    return;
  }
  z_stream *stream = host->export_zlib;
  stream->next_in = data;
  stream->avail_in = (uInt)length;
  GByteArray *out = g_byte_array_new();
  guchar buffer[65536];
  do {
    stream->next_out = buffer;
    stream->avail_out = sizeof(buffer);
    int result = deflate(stream, Z_NO_FLUSH);
    if (result != Z_OK && result != Z_BUF_ERROR) {
      g_byte_array_free(out, TRUE);
      g_free(data);
      cleanup_export_zlib(host);
      request_failure(request, "ELECTRON_MBT_NATIVE_FAILURE");
      return;
    }
    gsize produced = sizeof(buffer) - stream->avail_out;
    if (produced > 0) g_byte_array_append(out, buffer, (guint)produced);
  } while (stream->avail_in > 0 || stream->avail_out == 0);
  g_free(data);
  char *encoded = g_base64_encode(out->data, out->len);
  g_byte_array_free(out, TRUE);
  JSCValue *reply = object_new(host);
  object_set_string(host, reply, "base64", encoded);
  request_complete(request, "success", reply);
  g_free(encoded);
}

static void handle_zlib_deflate_end(Host *host, Request *request,
                                    JSCValue *payload) {
  static const char *const expected[] = {"token"};
  if (!object_has_exact_keys(payload, expected, 1)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  gint64 token = 0;
  if (!object_get_integer(payload, "token", &token) ||
      host->export_zlib == NULL || (guint64)token != host->export_zlib_token) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  z_stream *stream = host->export_zlib;
  GByteArray *out = g_byte_array_new();
  guchar buffer[65536];
  int result = Z_OK;
  do {
    stream->next_out = buffer;
    stream->avail_out = sizeof(buffer);
    result = deflate(stream, Z_FINISH);
    if (result != Z_OK && result != Z_STREAM_END && result != Z_BUF_ERROR) {
      g_byte_array_free(out, TRUE);
      cleanup_export_zlib(host);
      request_failure(request, "ELECTRON_MBT_NATIVE_FAILURE");
      return;
    }
    gsize produced = sizeof(buffer) - stream->avail_out;
    if (produced > 0) g_byte_array_append(out, buffer, (guint)produced);
  } while (result != Z_STREAM_END);
  cleanup_export_zlib(host);
  char *encoded = g_base64_encode(out->data, out->len);
  g_byte_array_free(out, TRUE);
  JSCValue *reply = object_new(host);
  object_set_string(host, reply, "base64", encoded);
  request_complete(request, "success", reply);
  g_free(encoded);
}

static void handle_zlib_deflate_abort(Host *host, Request *request,
                                      JSCValue *payload) {
  if (!object_has_exact_keys(payload, NULL, 0)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  cleanup_export_zlib(host);
  request_success_empty(request);
}

static void handle_main_write_at(Host *host, Request *request, JSCValue *payload) {
  static const char *const expected[] = {"path", "base64", "offset", "truncate"};
  if (!object_has_exact_keys(payload, expected, 4)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *path = object_get_string(payload, "path");
  char *base64 = object_get_string(payload, "base64");
  gint64 offset = 0;
  gboolean truncate = FALSE;
  if (path == NULL || base64 == NULL || strlen(base64) > EBT_MAX_MAIN_BASE64 ||
      !object_get_integer(payload, "offset", &offset) || offset < 0 ||
      !object_get_boolean(payload, "truncate", &truncate)) {
    g_free(path);
    g_free(base64);
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  if (offset > EBT_MAX_MAIN_OFFSET) {
    g_free(path);
    g_free(base64);
    request_failure(request, "ELECTRON_MBT_FILE_LIMIT");
    return;
  }
  gsize length = 0;
  guchar *data = g_base64_decode(base64, &length);
  if ((data == NULL && length != 0) || length > EBT_MAX_MAIN_WRITE) {
    g_free(data);
    g_free(path);
    g_free(base64);
    request_failure(request, length > EBT_MAX_MAIN_WRITE ? "ELECTRON_MBT_FILE_LIMIT"
                                                         : "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *canonical = canonical_write_path(host, path);
  if (canonical == NULL || !main_write_allowed(host, canonical)) {
    g_free(data);
    g_free(path);
    g_free(base64);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_DENIED");
    return;
  }
  int fd = open(canonical, O_WRONLY | O_CREAT | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0666);
  if (fd < 0) {
    int error = errno;
    g_free(data);
    g_free(path);
    g_free(base64);
    free(canonical);
    request_failure(request, main_fs_error_code(error));
    return;
  }
  if (truncate && ftruncate(fd, 0) != 0) {
    int error = errno;
    close(fd);
    g_free(data);
    g_free(path);
    g_free(base64);
    free(canonical);
    request_failure(request, main_fs_error_code(error));
    return;
  }
  const guchar *bytes = data == NULL ? (const guchar *)"" : data;
  size_t written = 0;
  while (written < length) {
    ssize_t got = pwrite(fd, bytes + written, length - written, (off_t)(offset + (gint64)written));
    if (got < 0) {
      if (errno == EINTR) continue;
      int error = errno;
      close(fd);
      g_free(data);
      g_free(path);
      g_free(base64);
      free(canonical);
      request_failure(request, main_fs_error_code(error));
      return;
    }
    if (got == 0) break;
    written += (size_t)got;
  }
  if (written != length) {
    close(fd);
    g_free(data);
    g_free(path);
    g_free(base64);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_WRITE");
    return;
  }
  if (close(fd) != 0) {
    int error = errno;
    g_free(data);
    g_free(path);
    g_free(base64);
    free(canonical);
    request_failure(request, main_fs_error_code(error));
    return;
  }
  JSCValue *reply = object_new(host);
  object_set_string(host, reply, "path", canonical);
  object_set_number(host, reply, "bytesWritten", (double)written);
  object_set_number(host, reply, "offset", (double)offset);
  request_complete(request, "success", reply);
  g_free(data);
  g_free(path);
  g_free(base64);
  free(canonical);
}

static void handle_resize_export_window(Host *host, Request *request,
                                        JSCValue *payload) {
  static const char *const expected[] = {"width", "height"};
  if (!object_has_exact_keys(payload, expected, 2)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  gint64 width = 0;
  gint64 height = 0;
  if (!object_get_integer(payload, "width", &width) ||
      !object_get_integer(payload, "height", &height) ||
      width < 100 || width > 4096 || height < 100 || height > 8192 ||
      host->export_window == NULL || host->export_web == NULL) {
    request_failure(request, "ELECTRON_MBT_WINDOW_OPTIONS");
    return;
  }
  gtk_window_resize(GTK_WINDOW(host->export_window), (gint)width, (gint)height);
  gtk_widget_set_size_request(GTK_WIDGET(host->export_web), (gint)width, (gint)height);
  gtk_widget_queue_resize(host->export_window);
  /* The GTK resize is asynchronous. Let the export WebView allocate the new
   * viewport before the next capture request; otherwise capturePage would see
   * the old height. */
  for (int i = 0; i < 100 && gtk_events_pending(); i++) gtk_main_iteration_do(FALSE);
  g_usleep(10000);
  for (int i = 0; i < 100 && gtk_events_pending(); i++) gtk_main_iteration_do(FALSE);
  JSCValue *reply = object_new(host);
  object_set_number(host, reply, "width", (double)width);
  object_set_number(host, reply, "height", (double)height);
  request_complete(request, "success", reply);
}

static void export_capture_snapshot_finished(GObject *source, GAsyncResult *result,
                                             gpointer data) {
  ExportWait *wait = data;
  GError *error = NULL;
  cairo_surface_t *surface = webkit_web_view_get_snapshot_finish(
    WEBKIT_WEB_VIEW(source), result, &error);
  if (error != NULL || surface == NULL) {
    g_clear_error(&error);
    wait->failed = TRUE;
    g_free(wait->error);
    wait->error = g_strdup("snapshot-failed");
  } else {
    wait->surface = surface;
  }
  if (wait->loop != NULL) g_main_loop_quit(wait->loop);
  export_wait_unref(wait);
}

static void handle_export_capture_page(Host *host, Request *request,
                                       JSCValue *payload) {
  static const char *const expected[] = {"x", "y", "width", "height"};
  if (!object_has_exact_keys(payload, expected, 4)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  gint64 x = 0, y = 0, width = 0, height = 0;
  if (host->export_web == NULL ||
      !object_get_integer(payload, "x", &x) ||
      !object_get_integer(payload, "y", &y) ||
      !object_get_integer(payload, "width", &width) ||
      !object_get_integer(payload, "height", &height) ||
      x < 0 || y < 0 || width < 1 || width > 4096 || height < 1 || height > 8192 ||
      (gint64)width * height * 4 > EBT_MAX_CAPTURE_BYTES) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  for (int i = 0; i < 100 && gtk_events_pending(); i++) gtk_main_iteration_do(FALSE);
  ExportWait *wait = export_wait_new();
  wait->timeout_id = g_timeout_add(12000, export_wait_timeout, wait);
  export_wait_ref(wait);
  webkit_web_view_get_snapshot(host->export_web, WEBKIT_SNAPSHOT_REGION_VISIBLE,
                               WEBKIT_SNAPSHOT_OPTIONS_NONE, NULL,
                               export_capture_snapshot_finished, wait);
  g_main_loop_run(wait->loop);
  export_wait_cleanup(wait);
  if (wait->failed || wait->surface == NULL) {
    request_failure(request, wait->timed_out ? "ELECTRON_MBT_TIMEOUT"
                                             : "ELECTRON_MBT_RENDERER_PROBE");
    export_wait_unref(wait);
    return;
  }
  cairo_surface_t *visible = wait->surface;
  wait->surface = NULL;
  /* WebKitGTK may return a CSS-sized snapshot even when the widget reports a
   * device scale factor. Derive the real ratio from the allocated CSS width;
   * when the surface is device-sized, downscale it to CSS for capturePage. */
  int surface_width = cairo_image_surface_get_width(visible);
  int surface_height = cairo_image_surface_get_height(visible);
  int allocated_width = gtk_widget_get_allocated_width(GTK_WIDGET(host->export_web));
  int scale = 1;
  if (allocated_width > 0 && surface_width > allocated_width &&
      surface_width % allocated_width == 0) {
    scale = surface_width / allocated_width;
  }
  if (scale < 1) scale = 1;
  int visible_width = surface_width / scale;
  int visible_height = surface_height / scale;
  if (x >= visible_width || y >= visible_height ||
      x + width > visible_width || y + height > visible_height) {
    cairo_surface_destroy(visible);
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    export_wait_unref(wait);
    return;
  }
  int crop_width = (int)width;
  int crop_height = (int)height;
  cairo_surface_t *crop = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, crop_width, crop_height);
  cairo_t *cr = cairo_create(crop);
  cairo_scale(cr, 1.0 / (double)scale, 1.0 / (double)scale);
  cairo_set_source_surface(cr, visible, -(double)x * scale, -(double)y * scale);
  cairo_paint(cr);
  cairo_destroy(cr);
  cairo_surface_destroy(visible);
  if (host->export_capture != NULL) cairo_surface_destroy(host->export_capture);
  host->export_capture = crop;
  JSCValue *reply = object_new(host);
  object_set_number(host, reply, "width", (double)crop_width);
  object_set_number(host, reply, "height", (double)crop_height);
  request_complete(request, "success", reply);
  export_wait_unref(wait);
}

static void handle_export_capture_read(Host *host, Request *request,
                                       JSCValue *payload) {
  static const char *const expected[] = {"offset", "length"};
  if (!object_has_exact_keys(payload, expected, 2)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  gint64 offset = 0;
  gint64 length = 0;
  if (host->export_capture == NULL ||
      !object_get_integer(payload, "offset", &offset) ||
      !object_get_integer(payload, "length", &length) ||
      offset < 0 || length < 1 || length > 65536) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  cairo_surface_flush(host->export_capture);
  int stride = cairo_image_surface_get_stride(host->export_capture);
  int total = stride * cairo_image_surface_get_height(host->export_capture);
  if (offset >= total) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  if (length > total - offset) length = total - offset;
  const unsigned char *data = cairo_image_surface_get_data(host->export_capture);
  char *base64 = g_base64_encode(data + offset, (gsize)length);
  JSCValue *reply = object_new(host);
  object_set_string(host, reply, "base64", base64);
  object_set_number(host, reply, "bytes", (double)length);
  request_complete(request, "success", reply);
  g_free(base64);
}

static void handle_main_stat(Host *host, Request *request, JSCValue *payload) {
  static const char *const expected[] = {"path"};
  if (!object_has_exact_keys(payload, expected, 1)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *path = object_get_string(payload, "path");
  if (path == NULL) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  char *canonical = canonical_existing_path(host, path);
  if (canonical == NULL) {
    char *joined = host_join_path(host, path);
    gboolean under_root = joined != NULL && path_is_under(joined, host->root);
    free(joined);
    JSCValue *reply = object_new(host);
    object_set_boolean(host, reply, "exists", FALSE);
    object_set_boolean(host, reply, "denied", under_root ? FALSE : TRUE);
    request_complete(request, "success", reply);
    g_free(path);
    return;
  }
  if (!main_read_allowed(host, canonical)) {
    JSCValue *reply = object_new(host);
    object_set_boolean(host, reply, "exists", FALSE);
    object_set_boolean(host, reply, "denied", TRUE);
    request_complete(request, "success", reply);
    g_free(path);
    free(canonical);
    return;
  }
  struct stat info;
  if (stat(canonical, &info) != 0) {
    JSCValue *reply = object_new(host);
    object_set_boolean(host, reply, "exists", FALSE);
    object_set_boolean(host, reply, "denied", FALSE);
    request_complete(request, "success", reply);
    g_free(path);
    free(canonical);
    return;
  }
  JSCValue *reply = object_new(host);
  object_set_boolean(host, reply, "exists", TRUE);
  object_set_boolean(host, reply, "isFile", S_ISREG(info.st_mode));
  object_set_boolean(host, reply, "isDirectory", S_ISDIR(info.st_mode));
  object_set_number(host, reply, "size", (double)info.st_size);
  double mtime_ms = (double)info.st_mtime * 1000.0 +
    (double)info.st_mtim.tv_nsec / 1000000.0;
  object_set_number(host, reply, "mtimeMs", mtime_ms);
  object_set_string(host, reply, "path", canonical);
  object_set_boolean(host, reply, "denied", FALSE);
  request_complete(request, "success", reply);
  g_free(path);
  free(canonical);
}

static void reply_open_dialog(Host *host, Request *request, gboolean canceled,
                              GPtrArray *paths) {
  JSCValue *reply = object_new(host);
  object_set_boolean(host, reply, "canceled", canceled);
  guint count = paths == NULL ? 0 : paths->len;
  char **strv = g_new0(char *, count + 1);
  for (guint index = 0; index < count; index++) {
    strv[index] = g_strdup((const char *)g_ptr_array_index(paths, index));
  }
  JSCValue *array = jsc_value_new_array_from_strv(host->json,
                                                  (const char *const *)strv);
  jsc_value_object_set_property(reply, "filePaths", array);
  g_object_unref(array);
  g_strfreev(strv);
  request_complete(request, "success", reply);
}

static gboolean close_window_idle(gpointer data) {
  Host *host = data;
  if (host != NULL && host->window != NULL) {
    gtk_window_close(GTK_WINDOW(host->window));
  }
  return G_SOURCE_REMOVE;
}

static gboolean dialog_auto_accept(gpointer data) {
  GtkWidget *dialog = data;
  gtk_dialog_response(GTK_DIALOG(dialog), GTK_RESPONSE_ACCEPT);
  return G_SOURCE_REMOVE;
}

/* Test-only control-thread hold for the dialog-wait regression. A real modal
 * chooser on an interactive desktop takes focus, and the next Enter or click
 * from the person at the machine accepts it long before the requested delay.
 * This hold keeps the open-dialog request pending for a bounded interval so the
 * control thread's dialog-specific wait can be exercised without mapping any
 * window. It is gated on ELECTRON_MBT_TEST_MODE=1, a valid AUTOSELECT target and
 * an explicit env var; production dialogs and the normal dialog tests still use
 * the real GTK chooser. */
static guint dialog_test_hold_ms(void) {
  const char *mode = getenv("ELECTRON_MBT_TEST_MODE");
  const char *selected = getenv("ELECTRON_MBT_LINUX_DIALOG_AUTOSELECT");
  const char *hold = getenv("ELECTRON_MBT_LINUX_DIALOG_HOLD_MS");
  if (mode == NULL || strcmp(mode, "1") != 0 ||
      selected == NULL || selected[0] == 0 ||
      hold == NULL || hold[0] == 0) return 0;
  long parsed = strtol(hold, NULL, 10);
  if (parsed < 1 || parsed > 60000) return 0;
  return (guint)parsed;
}

static void install_dialog_auto_response(GtkWidget *dialog, gboolean save) {
  const char *test_mode = getenv("ELECTRON_MBT_TEST_MODE");
  const char *selected = getenv("ELECTRON_MBT_LINUX_DIALOG_AUTOSELECT");
  if (test_mode == NULL || strcmp(test_mode, "1") != 0 ||
      selected == NULL || selected[0] == 0) return;
  char *canonical = save ? (g_path_is_absolute(selected) ? g_strdup(selected) : NULL)
                         : realpath(selected, NULL);
  if (canonical != NULL) {
    if (save) {
      char *directory = g_path_get_dirname(canonical);
      char *base = g_path_get_basename(canonical);
      gtk_file_chooser_set_current_folder(GTK_FILE_CHOOSER(dialog), directory);
      gtk_file_chooser_set_current_name(GTK_FILE_CHOOSER(dialog), base);
      /* Also set the full filename; GTK accepts a non-existent save target
       * and this avoids a current-name/current-folder timing race. */
      gtk_file_chooser_set_filename(GTK_FILE_CHOOSER(dialog), canonical);
      g_free(directory);
      g_free(base);
    } else {
      gtk_file_chooser_set_filename(GTK_FILE_CHOOSER(dialog), canonical);
    }
    free(canonical);
  }
  guint delay_ms = 300;
  const char *delay = getenv("ELECTRON_MBT_LINUX_DIALOG_AUTOSELECT_DELAY_MS");
  if (delay != NULL && delay[0] != 0) {
    long parsed = strtol(delay, NULL, 10);
    if (parsed >= 1 && parsed <= 60000) delay_ms = (guint)parsed;
  }
  ebt_debug("dialog-auto selected=%s delay=%u\n", selected, delay_ms);
  g_timeout_add(delay_ms, dialog_auto_accept, dialog);
}

static void handle_main_open_dialog(Host *host, Request *request,
                                    JSCValue *payload) {
  gint64 parent_window = 0;
  char *default_path = object_get_string(payload, "defaultPath");
  char *title = object_get_string(payload, "title");
  char *button = object_get_string(payload, "buttonLabel");
  if (title != NULL && strlen(title) > 256) {
    g_free(default_path);
    g_free(title);
    g_free(button);
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  if (button != NULL && strlen(button) > 64) {
    g_free(default_path);
    g_free(title);
    g_free(button);
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  guint hold_ms = dialog_test_hold_ms();
  if (hold_ms > 0) {
    const char *held = getenv("ELECTRON_MBT_LINUX_DIALOG_AUTOSELECT");
    ebt_debug("main-open-dialog test-hold ms=%u\n", hold_ms);
    g_usleep((gulong)hold_ms * 1000);
    GPtrArray *held_paths = g_ptr_array_new_with_free_func(g_free);
    char *canonical = held == NULL ? NULL : realpath(held, NULL);
    if (canonical != NULL) {
      grant_file(host, canonical, EBT_GRANT_READ | EBT_GRANT_WRITE);
      g_ptr_array_add(held_paths, canonical);
    }
    g_free(default_path);
    g_free(title);
    g_free(button);
    if (held_paths->len == 0) {
      reply_open_dialog(host, request, TRUE, NULL);
    } else {
      reply_open_dialog(host, request, FALSE, held_paths);
    }
    g_ptr_array_free(held_paths, TRUE);
    return;
  }
  GtkWindow *parent = NULL;
  if (object_get_integer(payload, "window", &parent_window) && parent_window == 1 &&
      host->window != NULL) {
    parent = GTK_WINDOW(host->window);
  }
  GtkWidget *dialog = gtk_file_chooser_dialog_new(
    title == NULL || title[0] == 0 ? "Open" : title, parent,
    GTK_FILE_CHOOSER_ACTION_OPEN, "_Cancel", GTK_RESPONSE_CANCEL,
    button == NULL || button[0] == 0 ? "_Open" : button, GTK_RESPONSE_ACCEPT, NULL);
  if (default_path != NULL && default_path[0] != 0) {
    char *joined = host_join_path(host, default_path);
    if (joined != NULL) {
      if (g_file_test(joined, G_FILE_TEST_IS_DIR)) {
        gtk_file_chooser_set_current_folder(GTK_FILE_CHOOSER(dialog), joined);
      } else if (g_file_test(joined, G_FILE_TEST_EXISTS)) {
        gtk_file_chooser_set_filename(GTK_FILE_CHOOSER(dialog), joined);
      } else {
        char *directory = g_path_get_dirname(joined);
        gtk_file_chooser_set_current_folder(GTK_FILE_CHOOSER(dialog), directory);
        g_free(directory);
      }
      free(joined);
    }
  }
  install_dialog_auto_response(dialog, FALSE);
  host->active_dialog = dialog;
  gint response = gtk_dialog_run(GTK_DIALOG(dialog));
  host->active_dialog = NULL;
  ebt_debug("main-open-dialog response=%d\n", response);
  GPtrArray *paths = g_ptr_array_new_with_free_func(g_free);
  if (response == GTK_RESPONSE_ACCEPT) {
    char *selected = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
    ebt_debug("main-open-dialog selected=%s\n", selected == NULL ? "(null)" : selected);
    char *canonical = selected == NULL ? NULL : realpath(selected, NULL);
    if (canonical != NULL) {
      /* A native open selection is an exact-file consent for this session.
       * Grant read+write so an editor can save back to the file it opened;
       * directory subtrees are still never granted. */
      grant_file(host, canonical, EBT_GRANT_READ | EBT_GRANT_WRITE);
      g_ptr_array_add(paths, canonical);
    }
    g_free(selected);
  }
  gtk_widget_destroy(dialog);
  if (host->close_after_dialog) {
    host->close_after_dialog = FALSE;
    if (host->window != NULL) g_idle_add(close_window_idle, host);
  }
  g_free(default_path);
  g_free(title);
  g_free(button);
  if (response != GTK_RESPONSE_ACCEPT) {
    reply_open_dialog(host, request, TRUE, NULL);
    g_ptr_array_free(paths, TRUE);
    return;
  }
  ebt_debug("main-open-dialog paths=%u\n", paths->len);
  if (paths->len == 0 || paths->len > EBT_MAX_DIALOG_PATHS) {
    request_failure(request, "ELECTRON_MBT_FILE_DENIED");
    g_ptr_array_free(paths, TRUE);
    return;
  }
  reply_open_dialog(host, request, FALSE, paths);
  ebt_debug("main-open-dialog replied\n");
  g_ptr_array_free(paths, TRUE);
}

static void handle_main_save_dialog(Host *host, Request *request,
                                    JSCValue *payload) {
  gint64 parent_window = 0;
  char *default_path = object_get_string(payload, "defaultPath");
  char *title = object_get_string(payload, "title");
  char *button = object_get_string(payload, "buttonLabel");
  if ((title != NULL && strlen(title) > 256) ||
      (button != NULL && strlen(button) > 64)) {
    g_free(default_path);
    g_free(title);
    g_free(button);
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  GtkWindow *parent = NULL;
  if (object_get_integer(payload, "window", &parent_window) && parent_window == 1 &&
      host->window != NULL) {
    parent = GTK_WINDOW(host->window);
  }
  GtkWidget *dialog = gtk_file_chooser_dialog_new(
    title == NULL || title[0] == 0 ? "Save" : title, parent,
    GTK_FILE_CHOOSER_ACTION_SAVE, "_Cancel", GTK_RESPONSE_CANCEL,
    button == NULL || button[0] == 0 ? "_Save" : button, GTK_RESPONSE_ACCEPT, NULL);
  gtk_file_chooser_set_do_overwrite_confirmation(GTK_FILE_CHOOSER(dialog), TRUE);
  if (default_path != NULL && default_path[0] != 0) {
    char *joined = host_join_path(host, default_path);
    if (joined != NULL) {
      if (g_file_test(joined, G_FILE_TEST_IS_DIR)) {
        gtk_file_chooser_set_current_folder(GTK_FILE_CHOOSER(dialog), joined);
      } else {
        char *directory = g_path_get_dirname(joined);
        char *base = g_path_get_basename(joined);
        gtk_file_chooser_set_current_folder(GTK_FILE_CHOOSER(dialog), directory);
        gtk_file_chooser_set_current_name(GTK_FILE_CHOOSER(dialog), base);
        g_free(directory);
        g_free(base);
      }
      free(joined);
    }
  }
  install_dialog_auto_response(dialog, TRUE);
  host->active_dialog = dialog;
  gint response = gtk_dialog_run(GTK_DIALOG(dialog));
  host->active_dialog = NULL;
  ebt_debug("main-save-dialog response=%d\n", response);
  char *selected = response == GTK_RESPONSE_ACCEPT
    ? gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog)) : NULL;
  ebt_debug("main-save-dialog selected=%s\n", selected == NULL ? "(null)" : selected);
  char *canonical = selected == NULL ? NULL : canonical_write_path(host, selected);
  gtk_widget_destroy(dialog);
  if (host->close_after_dialog) {
    host->close_after_dialog = FALSE;
    if (host->window != NULL) g_idle_add(close_window_idle, host);
  }
  g_free(default_path);
  g_free(title);
  g_free(button);
  if (response != GTK_RESPONSE_ACCEPT) {
    g_free(selected);
    free(canonical);
    JSCValue *reply = object_new(host);
    object_set_boolean(host, reply, "canceled", TRUE);
    object_set_string(host, reply, "filePath", "");
    request_complete(request, "success", reply);
    return;
  }
  if (canonical == NULL) {
    g_free(selected);
    request_failure(request, "ELECTRON_MBT_FILE_DENIED");
    return;
  }
  grant_file(host, canonical, EBT_GRANT_WRITE);
  char *temporary_sibling = g_strdup_printf("%s.tmp", canonical);
  if (temporary_sibling != NULL) {
    grant_file(host, temporary_sibling, EBT_GRANT_WRITE);
    g_free(temporary_sibling);
  }
  JSCValue *reply = object_new(host);
  object_set_boolean(host, reply, "canceled", FALSE);
  object_set_string(host, reply, "filePath", canonical);
  request_complete(request, "success", reply);
  g_free(selected);
  free(canonical);
}


static void destroy_export_window(Host *host) {
  if (host == NULL) return;
  host->export_load_wait = NULL;
  GtkWidget *window = host->export_window;
  WebKitWebView *web = host->export_web;
  host->export_window = NULL;
  host->export_web = NULL;
  if (host->export_capture != NULL) {
    cairo_surface_destroy(host->export_capture);
    host->export_capture = NULL;
  }
  cleanup_export_zlib(host);
  if (window != NULL) {
    /* The window owns the child WebView; destroying the window releases it. */
    gtk_widget_destroy(window);
  } else if (web != NULL) {
    g_object_unref(web);
  }
}

static gboolean export_wait_timeout(gpointer data) {
  ExportWait *wait = data;
  wait->timeout_id = 0;
  if (!wait->failed) {
    wait->failed = TRUE;
    wait->error = g_strdup("timeout");
  }
  if (wait->loop != NULL) g_main_loop_quit(wait->loop);
  return G_SOURCE_REMOVE;
}

static void export_wait_cleanup(ExportWait *wait) {
  if (wait == NULL) return;
  if (wait->timeout_id != 0) {
    g_source_remove(wait->timeout_id);
    wait->timeout_id = 0;
  }
  if (wait->loop != NULL) {
    g_main_loop_unref(wait->loop);
    wait->loop = NULL;
  }
}

static ExportWait *export_wait_new(void) {
  ExportWait *wait = g_new0(ExportWait, 1);
  wait->loop = g_main_loop_new(NULL, FALSE);
  wait->refs = 1;
  return wait;
}

static void export_wait_ref(ExportWait *wait) {
  if (wait != NULL) wait->refs += 1;
}

static void export_wait_unref(ExportWait *wait) {
  if (wait == NULL) return;
  wait->refs -= 1;
  if (wait->refs > 0) return;
  export_wait_cleanup(wait);
  g_free(wait->error);
  g_free(wait->json);
  if (wait->surface != NULL) cairo_surface_destroy(wait->surface);
  g_free(wait);
}

static void on_export_load_changed(WebKitWebView *web_view, WebKitLoadEvent event,
                                   gpointer data) {
  (void)web_view;
  Host *host = data;
  ExportWait *wait = host == NULL ? NULL : host->export_load_wait;
  if (wait == NULL) return;
  if (event == WEBKIT_LOAD_FINISHED) {
    if (wait->loop != NULL) g_main_loop_quit(wait->loop);
  }
}

static gboolean on_export_load_failed(WebKitWebView *web_view, WebKitLoadEvent event,
                                      const char *failing_uri, GError *error,
                                      gpointer data) {
  (void)web_view;
  (void)event;
  (void)failing_uri;
  Host *host = data;
  ExportWait *wait = host == NULL ? NULL : host->export_load_wait;
  if (wait != NULL) {
    wait->failed = TRUE;
    if (wait->error == NULL) {
      wait->error = g_strdup(error == NULL ? "load-failed" : error->message);
    }
    if (wait->loop != NULL) g_main_loop_quit(wait->loop);
  }
  return TRUE;
}

static void handle_create_export_window(Host *host, Request *request,
                                        JSCValue *payload) {
  static const char *const expected[] = {"width", "height"};
  if (!object_has_exact_keys(payload, expected, 2)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  gint64 width = 0;
  gint64 height = 0;
  if (!object_get_integer(payload, "width", &width) ||
      !object_get_integer(payload, "height", &height) ||
      width < 100 || width > 4096 || height < 100 || height > 4096) {
    request_failure(request, "ELECTRON_MBT_WINDOW_OPTIONS");
    return;
  }
  if (host->export_web != NULL || host->export_window != NULL) {
    request_failure(request, "ELECTRON_MBT_WINDOW_OPTIONS");
    return;
  }
  /* WebKitGTK printing requires a realized GtkWindow. Keep the export window
   * off-screen, undecorated and out of the taskbar/pager so the app never sees
   * a second visible window. */
  host->export_window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  host->export_web = WEBKIT_WEB_VIEW(webkit_web_view_new());
  if (host->export_window == NULL || host->export_web == NULL) {
    destroy_export_window(host);
    request_failure(request, "ELECTRON_MBT_NATIVE_FAILURE");
    return;
  }
  GtkWindow *export_window = GTK_WINDOW(host->export_window);
  gtk_window_set_title(export_window, "emoon-export");
  gtk_window_set_decorated(export_window, FALSE);
  gtk_window_set_default_size(export_window, (gint)width, (gint)height);
  gtk_window_set_skip_taskbar_hint(export_window, TRUE);
  gtk_window_set_skip_pager_hint(export_window, TRUE);
  gtk_window_set_accept_focus(export_window, FALSE);
  gtk_window_move(export_window, -10000, -10000);
  gtk_widget_set_size_request(GTK_WIDGET(host->export_web), (gint)width, (gint)height);
  gtk_container_add(GTK_CONTAINER(host->export_window), GTK_WIDGET(host->export_web));
  g_signal_connect(host->export_web, "load-changed",
                   G_CALLBACK(on_export_load_changed), host);
  g_signal_connect(host->export_web, "load-failed",
                   G_CALLBACK(on_export_load_failed), host);
  WebKitSettings *settings = webkit_web_view_get_settings(host->export_web);
  webkit_settings_set_enable_javascript(settings, TRUE);
  webkit_settings_set_enable_developer_extras(settings, FALSE);
  gtk_widget_show_all(host->export_window);
  JSCValue *reply = object_new(host);
  object_set_boolean(host, reply, "webViewAttached", TRUE);
  request_complete(request, "success", reply);
}

static void handle_load_export_file(Host *host, Request *request,
                                    JSCValue *payload) {
  static const char *const expected[] = {"file"};
  if (!object_has_exact_keys(payload, expected, 1)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  if (host->export_web == NULL || host->export_window == NULL) {
    request_failure(request, "ELECTRON_MBT_WINDOW_UNKNOWN");
    return;
  }
  char *file = object_get_string(payload, "file");
  char *canonical = file == NULL ? NULL : canonical_existing_path(host, file);
  if (canonical == NULL || !main_read_allowed(host, canonical)) {
    g_free(file);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_DENIED");
    return;
  }
  struct stat info;
  if (stat(canonical, &info) != 0 || !S_ISREG(info.st_mode)) {
    g_free(file);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_FILE_NOT_FOUND");
    return;
  }
  GError *error = NULL;
  char *uri = g_filename_to_uri(canonical, NULL, &error);
  if (uri == NULL) {
    g_clear_error(&error);
    g_free(file);
    free(canonical);
    request_failure(request, "ELECTRON_MBT_NATIVE_FAILURE");
    return;
  }
  ExportWait wait;
  memset(&wait, 0, sizeof(wait));
  wait.loop = g_main_loop_new(NULL, FALSE);
  host->export_load_wait = &wait;
  wait.timeout_id = g_timeout_add(12000, export_wait_timeout, &wait);
  webkit_web_view_load_uri(host->export_web, uri);
  ebt_debug("export-load uri=%s\n", uri);
  g_main_loop_run(wait.loop);
  host->export_load_wait = NULL;
  export_wait_cleanup(&wait);
  g_free(uri);
  g_free(file);
  free(canonical);
  if (wait.failed || wait.error != NULL) {
    g_free(wait.error);
    request_failure(request, "ELECTRON_MBT_LOAD_FAILED");
    return;
  }
  JSCValue *reply = object_new(host);
  object_set_boolean(host, reply, "loaded", TRUE);
  request_complete(request, "success", reply);
}

static void export_eval_finished(GObject *source, GAsyncResult *result,
                                 gpointer data) {
  ExportWait *wait = data;
  GError *error = NULL;
  JSCValue *value = webkit_web_view_evaluate_javascript_finish(
    WEBKIT_WEB_VIEW(source), result, &error);
  if (error != NULL || value == NULL) {
    ebt_debug("export-eval error=%s\n",
              error == NULL ? "(null)" : error->message);
    g_clear_error(&error);
    /* A Promise-valued expression (for example document.fonts.ready) is not
     * directly serializable by this private export path. The renderer treats
     * a null result as "continue"; PDF printing does not depend on it. */
    wait->json = g_strdup("null");
  } else {
    wait->json = jsc_value_to_json(value, 0);
    if (wait->json == NULL) wait->json = g_strdup("null");
    g_object_unref(value);
  }
  if (wait->loop != NULL) g_main_loop_quit(wait->loop);
  export_wait_unref(wait);
}

static void handle_export_execute_js(Host *host, Request *request,
                                     JSCValue *payload) {
  static const char *const expected[] = {"code"};
  if (!object_has_exact_keys(payload, expected, 1)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  if (host->export_web == NULL) {
    request_failure(request, "ELECTRON_MBT_WINDOW_UNKNOWN");
    return;
  }
  char *code = object_get_string(payload, "code");
  if (code == NULL || strlen(code) > 65536) {
    g_free(code);
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  ExportWait *wait = export_wait_new();
  wait->timeout_id = g_timeout_add(10000, export_wait_timeout, wait);
  export_wait_ref(wait);
  webkit_web_view_evaluate_javascript(host->export_web, code, -1, NULL, NULL, NULL,
                                      export_eval_finished, wait);
  g_free(code);
  g_main_loop_run(wait->loop);
  export_wait_cleanup(wait);
  if (wait->failed) {
    request_failure(request, "ELECTRON_MBT_RENDERER_PROBE");
    export_wait_unref(wait);
    return;
  }
  JSCValue *parsed = wait->json == NULL ? NULL : json_parse(host, wait->json, strlen(wait->json));
  JSCValue *reply = object_new(host);
  if (parsed != NULL) {
    jsc_value_object_set_property(reply, "value", parsed);
    g_object_unref(parsed);
  } else {
    JSCValue *null_value = jsc_value_new_null(host->json);
    jsc_value_object_set_property(reply, "value", null_value);
    g_object_unref(null_value);
  }
  request_complete(request, "success", reply);
  export_wait_unref(wait);
}



static void export_snapshot_finished(GObject *source, GAsyncResult *result,
                                     gpointer data) {
  ExportWait *wait = data;
  GError *error = NULL;
  cairo_surface_t *surface = webkit_web_view_get_snapshot_finish(
    WEBKIT_WEB_VIEW(source), result, &error);
  if (error != NULL || surface == NULL) {
    ebt_debug("export-snapshot error=%s\n",
              error == NULL ? "(null)" : error->message);
    g_clear_error(&error);
    wait->failed = TRUE;
    wait->error = g_strdup("snapshot-failed");
  } else {
    wait->surface = surface;
  }
  if (wait->loop != NULL) g_main_loop_quit(wait->loop);
  export_wait_unref(wait);
}

static void handle_export_print_pdf(Host *host, Request *request,
                                    JSCValue *payload) {
  static const char *const expected[] = {"pageSize", "landscape"};
  if (!object_has_exact_keys(payload, expected, 2)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  if (host->export_web == NULL) {
    request_failure(request, "ELECTRON_MBT_WINDOW_UNKNOWN");
    return;
  }
  char *page_size = object_get_string(payload, "pageSize");
  gboolean landscape = FALSE;
  JSCValue *landscape_value = object_get_value(payload, "landscape");
  if (landscape_value != NULL && jsc_value_is_boolean(landscape_value)) {
    landscape = jsc_value_to_boolean(landscape_value);
  }
  if (landscape_value != NULL) g_object_unref(landscape_value);
  if (page_size == NULL ||
      (strcmp(page_size, "A4") != 0 && strcmp(page_size, "Letter") != 0 &&
       strcmp(page_size, "Legal") != 0)) {
    g_free(page_size);
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  GError *error = NULL;
  char *pdf_dir = g_build_filename(host->root, ".appData", "tmp", NULL);
  if (pdf_dir == NULL || g_mkdir_with_parents(pdf_dir, 0700) != 0) {
    g_free(pdf_dir);
    g_free(page_size);
    request_failure(request, "ELECTRON_MBT_NATIVE_FAILURE");
    return;
  }
  char *pdf_template = g_build_filename(pdf_dir, "emoon-export-XXXXXX.pdf", NULL);
  g_free(pdf_dir);
  if (pdf_template == NULL) {
    g_free(page_size);
    request_failure(request, "ELECTRON_MBT_NATIVE_FAILURE");
    return;
  }
  char *pdf_path = pdf_template;
  int pdf_fd = g_mkstemp(pdf_path);
  if (pdf_fd < 0) {
    g_free(pdf_template);
    g_free(page_size);
    request_failure(request, "ELECTRON_MBT_NATIVE_FAILURE");
    return;
  }
  close(pdf_fd);
  char *pdf_uri = g_filename_to_uri(pdf_path, NULL, &error);
  if (pdf_uri == NULL) {
    g_clear_error(&error);
    unlink(pdf_path);
    g_free(pdf_path);
    g_free(page_size);
    request_failure(request, "ELECTRON_MBT_NATIVE_FAILURE");
    return;
  }
  double page_width = 595.0;
  double page_height = 842.0;
  if (strcmp(page_size, "Letter") == 0) {
    page_width = 612.0;
    page_height = 792.0;
  } else if (strcmp(page_size, "Legal") == 0) {
    page_width = 612.0;
    page_height = 1008.0;
  }
  if (landscape) {
    double swap = page_width;
    page_width = page_height;
    page_height = swap;
  }
  ExportWait *wait = export_wait_new();
  wait->timeout_id = g_timeout_add(12000, export_wait_timeout, wait);
  export_wait_ref(wait);
  webkit_web_view_get_snapshot(host->export_web, WEBKIT_SNAPSHOT_REGION_FULL_DOCUMENT,
                               WEBKIT_SNAPSHOT_OPTIONS_NONE, NULL,
                               export_snapshot_finished, wait);
  g_main_loop_run(wait->loop);
  export_wait_cleanup(wait);
  if (wait->failed || wait->surface == NULL) {
    ebt_debug("export-snapshot failed=%s\n", wait->error == NULL ? "(null)" : wait->error);
    unlink(pdf_path);
    g_free(pdf_path);
    g_free(pdf_uri);
    g_free(page_size);
    request_failure(request, "ELECTRON_MBT_RENDERER_PROBE");
    export_wait_unref(wait);
    return;
  }
  cairo_surface_t *snapshot = wait->surface;
  wait->surface = NULL;
  int image_width = cairo_image_surface_get_width(snapshot);
  int image_height = cairo_image_surface_get_height(snapshot);
  if (image_width <= 0 || image_height <= 0) {
    cairo_surface_destroy(snapshot);
    unlink(pdf_path);
    g_free(pdf_path);
    g_free(pdf_uri);
    g_free(page_size);
    request_failure(request, "ELECTRON_MBT_RENDERER_PROBE");
    export_wait_unref(wait);
    return;
  }
  cairo_surface_t *pdf_surface = cairo_pdf_surface_create(pdf_path, page_width, page_height);
  if (cairo_surface_status(pdf_surface) != CAIRO_STATUS_SUCCESS) {
    cairo_surface_destroy(pdf_surface);
    cairo_surface_destroy(snapshot);
    unlink(pdf_path);
    g_free(pdf_path);
    g_free(pdf_uri);
    g_free(page_size);
    request_failure(request, "ELECTRON_MBT_FILE_WRITE");
    export_wait_unref(wait);
    return;
  }
  double scale = page_width / (double)image_width;
  double page_source_height = page_height / scale;
  int offset = 0;
  while (offset < image_height) {
    cairo_t *cr = cairo_create(pdf_surface);
    cairo_set_source_rgb(cr, 1.0, 1.0, 1.0);
    cairo_paint(cr);
    cairo_save(cr);
    cairo_scale(cr, scale, scale);
    cairo_set_source_surface(cr, snapshot, 0.0, -(double)offset);
    cairo_rectangle(cr, 0.0, 0.0, page_width / scale, page_height / scale);
    cairo_clip(cr);
    cairo_paint(cr);
    cairo_restore(cr);
    cairo_show_page(cr);
    cairo_destroy(cr);
    int step = (int)page_source_height;
    if (step < 1) step = 1;
    offset += step;
  }
  cairo_surface_flush(pdf_surface);
  cairo_status_t pdf_status = cairo_surface_status(pdf_surface);
  cairo_surface_destroy(pdf_surface);
  cairo_surface_destroy(snapshot);
  if (pdf_status != CAIRO_STATUS_SUCCESS) {
    unlink(pdf_path);
    g_free(pdf_path);
    g_free(pdf_uri);
    g_free(page_size);
    request_failure(request, "ELECTRON_MBT_FILE_WRITE");
    export_wait_unref(wait);
    return;
  }
    ebt_debug("export-snapshot wrote %s image=%dx%d pages=%d\n",
            pdf_path, image_width, image_height,
            (image_height + (int)page_source_height - 1) / (int)page_source_height);
  g_free(pdf_uri);
  g_free(page_size);
  gchar *data = NULL;
  gsize length = 0;
  if (!g_file_get_contents(pdf_path, &data, &length, &error) || length == 0) {
    g_clear_error(&error);
    g_free(data);
    unlink(pdf_path);
    g_free(pdf_path);
    request_failure(request, "ELECTRON_MBT_FILE_READ");
    export_wait_unref(wait);
    return;
  }
  unlink(pdf_path);
  g_free(pdf_path);
  if (length > 700 * 1024) {
    g_free(data);
    request_failure(request, "ELECTRON_MBT_FILE_LIMIT");
    export_wait_unref(wait);
    return;
  }
  gchar *base64 = g_base64_encode((const guchar *)data, length);
  g_free(data);
  JSCValue *reply = object_new(host);
  object_set_string(host, reply, "base64", base64);
  object_set_number(host, reply, "sizeBytes", (double)length);
  request_complete(request, "success", reply);
  g_free(base64);
  export_wait_unref(wait);
}

static void handle_destroy_export_window(Host *host, Request *request,
                                         JSCValue *payload) {
  if (!object_has_exact_keys(payload, NULL, 0)) {
    request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
    return;
  }
  destroy_export_window(host);
  JSCValue *reply = object_new(host);
  request_complete(request, "success", reply);
}

static void teardown_window_state(Host *host, const char *code) {
  if (host == NULL) return;
  if (host->load_request != NULL) fail_load_request(host, code);
  fail_pending(host, code);
  host->load_in_progress = FALSE;
  host->load_failed = FALSE;
  host->loaded = FALSE;
  host->loaded_is_snapshot = FALSE;
  host->content_alive = FALSE;
  host->created = FALSE;
  host->handlers_installed = FALSE;
  host->generation = 0;
  g_free(host->loaded_uri);
  host->loaded_uri = NULL;
  g_free(host->loaded_file);
  host->loaded_file = NULL;
  g_free(host->adapter_source);
  host->adapter_source = NULL;
  g_free(host->message_nonce);
  host->message_nonce = NULL;
  g_free(host->adapter_nonce);
  host->adapter_nonce = NULL;
  snapshot_free(host->snapshot);
  host->snapshot = NULL;
}

static void handle_destroy_window(Host *host, Request *request) {
  if (!require_current(host, request)) return;
  if (host->web != NULL) {
    webkit_web_view_stop_loading(host->web);
    if (host->manager != NULL) webkit_user_content_manager_remove_all_scripts(host->manager);
  }
  GtkWidget *window = host->window;
  host->window = NULL;
  host->web = NULL;
  host->manager = NULL;
  destroy_export_window(host);
  teardown_window_state(host, "ELECTRON_MBT_WINDOW_DESTROYED");
  if (window != NULL) gtk_widget_destroy(window);
  JSCValue *reply = object_new(host);
  object_set_boolean(host, reply, "destroyed", TRUE);
  request_complete(request, "success", reply);
}

static void dispatch_request(Request *request, JSCValue *payload) {
  Host *host = request->host;
  const char *operation = request->frame.operation;
  ebt_debug("dispatch op=%s window=%lld generation=%lld current=%lld\n",
            operation, (long long)request->frame.window,
            (long long)request->frame.generation, (long long)host->generation);

  if (strcmp(operation, "hello") == 0 || strcmp(operation, "ready") == 0) {
    if (request->frame.window != 0 || request->frame.generation != 0 ||
        payload != NULL) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    request_success_empty(request);
    return;
  }
  if (strcmp(operation, "shutdown") == 0) {
    if (request->frame.window != 0 || request->frame.generation != 0 ||
        payload != NULL) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    host->shutting_down = TRUE;
    request_success_empty(request);
    return;
  }
  if (strcmp(operation, "simulate-window-close") == 0) {
    const char *test_mode = getenv("ELECTRON_MBT_TEST_MODE");
    if (test_mode == NULL || strcmp(test_mode, "1") != 0 ||
        !object_has_exact_keys(payload, NULL, 0) || host->window == NULL) {
      request_failure(request, "ELECTRON_MBT_UNSUPPORTED_API");
      return;
    }
    /* Exercise the same GTK delete-event path a window-manager close uses.
     * Returning FALSE lets GTK destroy the window after on_window_delete has
     * cleared the host pointers. */
    gtk_window_close(GTK_WINDOW(host->window));
    request_success_empty(request);
    return;
  }
  if (strcmp(operation, "get-window-state") == 0) {
    if (!object_has_exact_keys(payload, NULL, 0)) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    JSCValue *reply = object_new(host);
    object_set_boolean(host, reply, "open",
                       host->created && host->window != NULL);
    object_set_number(host, reply, "generation", (double)host->generation);
    request_complete(request, "success", reply);
    return;
  }
  if (strcmp(operation, "prepare-source") == 0) {
    handle_prepare_source(host, request, payload);
    return;
  }
  if (strcmp(operation, "install-adapted-adapter") == 0) {
    handle_install_adapter(host, request, payload);
    return;
  }
  if (strcmp(operation, "begin-load") == 0) {
    if (!object_has_exact_keys(payload, NULL, 0)) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    handle_begin_load(host, request);
    return;
  }
  if (strcmp(operation, "load-app-file") == 0) {
    start_load(host, request, payload, TRUE);
    return;
  }
  if (strcmp(operation, "load-file") == 0) {
    start_load(host, request, payload, FALSE);
    return;
  }
  if (strcmp(operation, "probe-renderer") == 0) {
    if (!object_has_exact_keys(payload, NULL, 0)) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    handle_probe_renderer(host, request);
    return;
  }
  if (strcmp(operation, "get-adapted-status") == 0) {
    if (!object_has_exact_keys(payload, NULL, 0)) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    handle_get_adapted_status(host, request);
    return;
  }
  if (strcmp(operation, "get-document-identity") == 0) {
    if (!object_has_exact_keys(payload, NULL, 0)) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    handle_get_document_identity(host, request);
    return;
  }
  if (strcmp(operation, "get-ingress-status") == 0) {
    if (!object_has_exact_keys(payload, NULL, 0)) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    handle_get_ingress_status(host, request);
    return;
  }
  if (strcmp(operation, "app-reply") == 0) {
    handle_app_reply(host, request, payload);
    return;
  }
  if (strcmp(operation, "inject-app-request") == 0) {
    handle_inject_app_request(host, request, payload);
    return;
  }
  if (strcmp(operation, "get-web-contents-title") == 0) {
    if (!require_current(host, request)) return;
    if (!object_has_exact_keys(payload, NULL, 0)) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    if (!host->content_alive || host->web == NULL) {
      request_failure(request, "ELECTRON_MBT_WEB_PROCESS_TERMINATED");
      return;
    }
    const char *title = webkit_web_view_get_title(host->web);
    if (title == NULL) title = "";
    if (strlen(title) > EBT_MAX_TITLE) {
      request_failure(request, "ELECTRON_MBT_NATIVE_FAILURE");
      return;
    }
    JSCValue *reply = object_new(host);
    object_set_string(host, reply, "title", title);
    request_complete(request, "success", reply);
    return;
  }
  if (strcmp(operation, "get-web-contents-url") == 0) {
    if (!require_current(host, request)) return;
    if (!object_has_exact_keys(payload, NULL, 0)) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    if (!host->content_alive || host->web == NULL) {
      request_failure(request, "ELECTRON_MBT_WEB_PROCESS_TERMINATED");
      return;
    }
    const char *url = webkit_web_view_get_uri(host->web);
    if (url == NULL) url = "";
    if (strlen(url) > EBT_MAX_URL) {
      request_failure(request, "ELECTRON_MBT_NATIVE_FAILURE");
      return;
    }
    JSCValue *reply = object_new(host);
    object_set_string(host, reply, "url", url);
    request_complete(request, "success", reply);
    return;
  }
  if (strcmp(operation, "get-window-title") == 0) {
    if (!require_current(host, request)) return;
    if (!object_has_exact_keys(payload, NULL, 0) || host->window == NULL) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    const char *title = gtk_window_get_title(GTK_WINDOW(host->window));
    JSCValue *reply = object_new(host);
    object_set_string(host, reply, "title", title == NULL ? "" : title);
    request_complete(request, "success", reply);
    return;
  }
  if (strcmp(operation, "set-window-title") == 0) {
    static const char *const expected[] = {"title"};
    if (!require_current(host, request)) return;
    if (!object_has_exact_keys(payload, expected, 1) || host->window == NULL) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    char *title = object_get_string(payload, "title");
    if (title == NULL || strlen(title) > 256) {
      g_free(title);
      request_failure(request, "ELECTRON_MBT_WINDOW_OPTIONS");
      return;
    }
    gtk_window_set_title(GTK_WINDOW(host->window), title);
    JSCValue *reply = object_new(host);
    object_set_string(host, reply, "title", title);
    request_complete(request, "success", reply);
    g_free(title);
    return;
  }
  if (strcmp(operation, "destroy-window") == 0) {
    if (!object_has_exact_keys(payload, NULL, 0)) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    handle_destroy_window(host, request);
    return;
  }
  if (strcmp(operation, "send-adapted-event") == 0) {
    static const char *const expected[] = {"topic", "payload"};
    if (!object_has_exact_keys(payload, expected, 2)) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    char *topic = object_get_string(payload, "topic");
    char *payload_text = object_get_string(payload, "payload");
    if (topic == NULL || strlen(topic) > 128 ||
        payload_text == NULL || strlen(payload_text) > EBT_MAX_APP_PAYLOAD) {
      g_free(topic);
      g_free(payload_text);
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return;
    }
    if (host->web == NULL || host->json == NULL || host->adapter_nonce == NULL ||
        !host->content_alive || !host->loaded) {
      g_free(topic);
      g_free(payload_text);
      request_failure(request, "ELECTRON_MBT_STALE_DOCUMENT");
      return;
    }
    JSCValue *topic_value = jsc_value_new_string(host->json, topic);
    JSCValue *payload_value = jsc_value_new_string(host->json, payload_text);
    char *quoted_topic = topic_value == NULL ? NULL : jsc_value_to_json(topic_value, 0);
    char *quoted_payload = payload_value == NULL ? NULL : jsc_value_to_json(payload_value, 0);
    if (topic_value != NULL) g_object_unref(topic_value);
    if (payload_value != NULL) g_object_unref(payload_value);
    if (quoted_topic == NULL || quoted_payload == NULL) {
      g_free(quoted_topic);
      g_free(quoted_payload);
      g_free(topic);
      g_free(payload_text);
      request_failure(request, "ELECTRON_MBT_MAIN_ERROR");
      return;
    }
    char *script = g_strdup_printf(
      "if (typeof window.__electronMbtDispatch === 'function') { window.__electronMbtDispatch(\"%s\", %s, JSON.parse(%s)); }",
      host->adapter_nonce, quoted_topic, quoted_payload);
    ebt_debug("send-adapted-event topic=%s\n", topic);
    if (script != NULL) {
      webkit_web_view_evaluate_javascript(host->web, script, -1, NULL, NULL, NULL,
                                          NULL, NULL);
    }
    g_free(script);
    g_free(quoted_topic);
    g_free(quoted_payload);
    g_free(topic);
    g_free(payload_text);
    JSCValue *reply = object_new(host);
    request_complete(request, "success", reply);
    return;
  }
  if (strcmp(operation, "resize-export-window") == 0) {
    handle_resize_export_window(host, request, payload);
    return;
  }
  if (strcmp(operation, "export-capture-page") == 0) {
    handle_export_capture_page(host, request, payload);
    return;
  }
  if (strcmp(operation, "export-capture-read") == 0) {
    handle_export_capture_read(host, request, payload);
    return;
  }
  if (strcmp(operation, "create-export-window") == 0) {
    handle_create_export_window(host, request, payload);
    return;
  }
  if (strcmp(operation, "load-export-file") == 0) {
    handle_load_export_file(host, request, payload);
    return;
  }
  if (strcmp(operation, "export-execute-js") == 0) {
    handle_export_execute_js(host, request, payload);
    return;
  }
  if (strcmp(operation, "export-print-pdf") == 0) {
    handle_export_print_pdf(host, request, payload);
    return;
  }
  if (strcmp(operation, "destroy-export-window") == 0) {
    handle_destroy_export_window(host, request, payload);
    return;
  }
  if (strcmp(operation, "main-read-file") == 0) {
    handle_main_read_file(host, request, payload);
    return;
  }
  if (strcmp(operation, "main-write-file") == 0) {
    handle_main_write_file(host, request, payload);
    return;
  }
  if (strcmp(operation, "zlib-deflate-start") == 0) {
    handle_zlib_deflate_start(host, request, payload);
    return;
  }
  if (strcmp(operation, "zlib-deflate-write") == 0) {
    handle_zlib_deflate_write(host, request, payload);
    return;
  }
  if (strcmp(operation, "zlib-deflate-end") == 0) {
    handle_zlib_deflate_end(host, request, payload);
    return;
  }
  if (strcmp(operation, "zlib-deflate-abort") == 0) {
    handle_zlib_deflate_abort(host, request, payload);
    return;
  }
  if (strcmp(operation, "main-write-at") == 0) {
    handle_main_write_at(host, request, payload);
    return;
  }
  if (strcmp(operation, "main-rename") == 0) {
    handle_main_rename(host, request, payload);
    return;
  }
  if (strcmp(operation, "main-unlink") == 0) {
    handle_main_unlink(host, request, payload);
    return;
  }
  if (strcmp(operation, "main-read-dir") == 0) {
    handle_main_read_dir(host, request, payload);
    return;
  }
  if (strcmp(operation, "main-mkdir") == 0) {
    handle_main_mkdir(host, request, payload);
    return;
  }
  if (strcmp(operation, "main-stat") == 0) {
    handle_main_stat(host, request, payload);
    return;
  }
  if (strcmp(operation, "main-open-dialog") == 0) {
    handle_main_open_dialog(host, request, payload);
    return;
  }
  if (strcmp(operation, "main-save-dialog") == 0) {
    handle_main_save_dialog(host, request, payload);
    return;
  }
  request_failure(request, "ELECTRON_MBT_UNSUPPORTED_API");
}

static gboolean request_main_cb(gpointer data) {
  Request *request = data;
  Host *host = request->host;
  const char *operation = request->frame.operation;
  ebt_debug("request_main_cb thread=%p owner=%d op=%s\n",
            (void *)g_thread_self(), g_main_context_is_owner(g_main_context_default()),
            operation);
  if (strcmp(operation, "hello") == 0 || strcmp(operation, "ready") == 0 ||
      strcmp(operation, "shutdown") == 0) {
    if (!payload_is_empty(request)) {
      request_failure(request, "ELECTRON_MBT_INVALID_ENVELOPE");
      return G_SOURCE_REMOVE;
    }
    dispatch_request(request, NULL);
    return G_SOURCE_REMOVE;
  }
  if (strcmp(operation, "create-window") == 0) {
    handle_create_window(host, request);
    return G_SOURCE_REMOVE;
  }
  if (host->json == NULL) {
    request_failure(request, "ELECTRON_MBT_WINDOW_UNKNOWN");
    return G_SOURCE_REMOVE;
  }
  JSCValue *payload = request_payload(request);
  if (payload == NULL || !jsc_value_is_object(payload)) {
    if (payload != NULL) g_object_unref(payload);
    _exit(2);
  }
  dispatch_request(request, payload);
  g_object_unref(payload);
  return G_SOURCE_REMOVE;
}

static gboolean is_load_operation(const char *operation) {
  return strcmp(operation, "load-file") == 0 ||
         strcmp(operation, "load-app-file") == 0;
}

/* ---- threads ---- */

static gpointer control_thread_main(gpointer data) {
  Host *host = data;
  for (;;) {
    char *raw = NULL;
    size_t raw_length = 0;
    if (!read_frame_alloc(host->control_fd, &raw, &raw_length)) _exit(0);
    EbtControlFrame frame;
    if (!ebt_control_frame_validate(raw, raw_length, &frame) ||
        strcmp(frame.session, host->session) != 0 ||
        is_load_operation(frame.operation)) {
      g_free(raw);
      _exit(2);
    }
    Request *request = request_new(host, raw, raw_length, &frame, FALSE);
    g_free(raw);
    g_main_context_invoke(NULL, request_main_cb, request);
    // A human file chooser legitimately takes longer than an ordinary control
    // round trip. The client already waits one hour for open/save dialogs;
    // the host's control thread must use the same bound instead of the normal
    // 15-second request timeout.
    gboolean is_dialog = strcmp(frame.operation, "main-open-dialog") == 0 ||
                         strcmp(frame.operation, "main-save-dialog") == 0;
    wait_for_request(request, is_dialog ? 3600 : 15);
    gboolean shutting_down = host->shutting_down;
    if (request->reply != NULL) {
      if (!write_frame(host->control_fd, request->reply, strlen(request->reply))) {
        request_free(request);
        _exit(2);
      }
    }
    request_free(request);
    if (shutting_down) _exit(0);
  }
}

static gpointer load_thread_main(gpointer data) {
  Host *host = data;
  for (;;) {
    char *raw = NULL;
    size_t raw_length = 0;
    if (!read_frame_alloc(host->load_fd, &raw, &raw_length)) _exit(0);
    EbtControlFrame frame;
    if (!ebt_control_frame_validate(raw, raw_length, &frame) ||
        strcmp(frame.session, host->session) != 0 ||
        !is_load_operation(frame.operation)) {
      g_free(raw);
      _exit(2);
    }
    Request *request = request_new(host, raw, raw_length, &frame, TRUE);
    g_free(raw);
    g_main_context_invoke(NULL, request_main_cb, request);
    wait_for_request(request, 14);
    if (request->reply != NULL) {
      if (!write_frame(host->load_fd, request->reply, strlen(request->reply))) {
        request_free(request);
        _exit(2);
      }
    }
    request_free(request);
  }
}

static gboolean on_window_delete(GtkWidget *widget, GdkEvent *event,
                                 gpointer data) {
  (void)event;
  Host *host = data;
  if (host == NULL || widget == NULL || host->window != widget) return TRUE;
  if (host->active_dialog != NULL) {
    /* A modal chooser is running a nested loop. Destroying its parent first
     * can leave the control request and the GTK dialog inconsistent; cancel
     * the chooser, then close the window from an idle callback. */
    host->close_after_dialog = TRUE;
    gtk_dialog_response(GTK_DIALOG(host->active_dialog), GTK_RESPONSE_CANCEL);
    return TRUE;
  }
  if (host->web != NULL) {
    webkit_web_view_stop_loading(host->web);
    if (host->manager != NULL) webkit_user_content_manager_remove_all_scripts(host->manager);
  }
  /* Clear the host pointers before destroying the GTK tree: destroying the
   * WebView can synchronously emit load/termination callbacks. The host stays
   * alive so the control thread can answer the caller's liveness query and
   * shut down without a broken-pipe crash. */
  host->web = NULL;
  host->manager = NULL;
  host->window = NULL;
  teardown_window_state(host, "ELECTRON_MBT_WINDOW_CLOSED");
  /* Let GTK perform the default destroy after this handler returns. Calling
   * gtk_widget_destroy synchronously here re-enters the event/draw machinery
   * and produced BadDrawable under Xvfb. The host pointers are already cleared,
   * so the destroy path cannot use a dangling window. */
  return FALSE;
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--version") == 0) {
    printf("emoon-host 0.1.0\n");
    return 0;
  }
  if (argc != 2 || fcntl(EBT_CONTROL_CHANNEL, F_GETFD) < 0 ||
      fcntl(EBT_LOAD_CHANNEL, F_GETFD) < 0 ||
      fcntl(EBT_EVENT_CHANNEL, F_GETFD) < 0) {
    return 64;
  }
  const char *session = getenv("ELECTRON_MBT_HOST_SESSION");
  if (session == NULL || strlen(session) != 32) return 64;
  for (const char *cursor = session; *cursor != 0; cursor++) {
    if (!((*cursor >= '0' && *cursor <= '9') ||
          (*cursor >= 'a' && *cursor <= 'f'))) return 64;
  }
  char *root = realpath(argv[1], NULL);
  if (root == NULL) return 64;
  struct stat info;
  if (stat(root, &info) != 0 || !S_ISDIR(info.st_mode)) {
    free(root);
    return 64;
  }
  if (!gtk_init_check(&argc, &argv)) {
    free(root);
    return 64;
  }

  /* A closed peer must produce EPIPE in a write, not SIGPIPE that kills the
   * host before it can report the failed request. */
  signal(SIGPIPE, SIG_IGN);

  Host *host = g_new0(Host, 1);
  host->root = root;
  g_strlcpy(host->session, session, sizeof(host->session));
  host->control_fd = EBT_CONTROL_CHANNEL;
  host->load_fd = EBT_LOAD_CHANNEL;
  host->event_fd = EBT_EVENT_CHANNEL;
  host->pending = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, pending_free);
  host->file_grants = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, NULL);
  host->events = g_async_queue_new();
  /* App-local data roots are the only paths writable without a dialog grant.
   * Creating them here keeps the main-thread fs handler from having to create
   * arbitrary parents (and therefore from following an app-controlled symlink
   * before the policy check). */
  char *app_data = g_build_filename(root, ".appData", NULL);
  char *user_data = g_build_filename(root, ".userData", NULL);
  if (g_mkdir_with_parents(app_data, 0700) != 0 ||
      g_mkdir_with_parents(user_data, 0700) != 0) {
    g_free(app_data);
    g_free(user_data);
    free(root);
    return 64;
  }
  g_free(app_data);
  g_free(user_data);
  host->next_event = 0;
  host->next_request = 0;

  WebKitWebContext *context = webkit_web_context_get_default();
  webkit_web_context_register_uri_scheme(context, "electron-mbt-app",
                                         on_uri_scheme_request, host, NULL);
  WebKitSecurityManager *security = webkit_web_context_get_security_manager(context);
  webkit_security_manager_register_uri_scheme_as_secure(security, "electron-mbt-app");
  webkit_security_manager_register_uri_scheme_as_cors_enabled(security, "electron-mbt-app");
  /* The main fs/dialog surface is reachable before create-window (app ready
   * reads settings before creating a BrowserWindow), so the JSC context must
   * exist before the first request. It is created only after the WebKit
   * context/security setup, not before it. */
  host->json = jsc_context_new();
  if (host->json == NULL) return 64;

  host->event_thread = g_thread_new("electron-mbt-events", event_writer, host);
  host->control_thread = g_thread_new("electron-mbt-control", control_thread_main, host);
  host->load_thread = g_thread_new("electron-mbt-load", load_thread_main, host);

  for (;;) {
    gtk_main();
    ebt_debug("gtk-main-returned shutting_down=%d\n", host->shutting_down);
    if (host->shutting_down) break;
    /* GTK can return from gtk_main when the last window is destroyed or a
     * nested dialog loop quits it. The session is not over: keep the host
     * alive until the control thread answers the in-flight dialog/app-reply
     * and processes shutdown. */
    g_usleep(10000);
  }
  _exit(2);
}
