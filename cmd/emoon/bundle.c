#include "moonbit.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <ftw.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#include <zlib.h>

#define EBT_BUNDLE_FOOTER 512
#define EBT_BUNDLE_MAX_RAW (64u * 1024u * 1024u)
#define EBT_BUNDLE_MAX_HOST (16u * 1024u * 1024u)
#define EBT_BUNDLE_MAX_FILES 4096u
#define EBT_BUNDLE_MAX_FILE (32u * 1024u * 1024u)
#define EBT_BUNDLE_MAX_PATH 4096u

static const char bundle_payload_magic[8] = {'E','M','O','O','N','P','A','Y'};
static const char bundle_footer_magic[8] = {'E','M','O','O','N','B','1',0};

// ---- bounded bytes helpers (the native stub cannot use the MoonBit stdlib) ----
static char *bundle_copy_bytes(moonbit_bytes_t bytes) {
  if (bytes == NULL) return NULL;
  int32_t length = Moonbit_array_length(bytes);
  if (length < 0) return NULL;
  char *copy = (char *)malloc((size_t)length + 1);
  if (copy == NULL) return NULL;
  if (length > 0) memcpy(copy, bytes, (size_t)length);
  copy[length] = 0;
  if (strlen(copy) != (size_t)length) { free(copy); return NULL; }
  return copy;
}

static void bundle_set_data(moonbit_bytes_t out, int32_t capacity,
                            const char *text) {
  if (out == NULL || capacity <= 0 || Moonbit_array_length(out) < capacity) return;
  size_t length = text == NULL ? 0 : strlen(text);
  if (length + 1 > (size_t)capacity) length = (size_t)capacity - 1;
  if (length > 0) memcpy(out, text, length);
  out[length] = 0;
}

static void bundle_error(moonbit_bytes_t out, int32_t capacity,
                         const char *code, const char *message) {
  char text[4096];
  snprintf(text, sizeof(text), "{\"ok\":false,\"code\":\"%s\",\"message\":\"%s\"}",
           code == NULL ? "ELECTRON_MBT_BUNDLE_IO" : code,
           message == NULL ? "bundle failed" : message);
  bundle_set_data(out, capacity, text);
}

// ---- SHA-256, shared shape with cmd/emoon/file_io.c ----
static const uint32_t bundle_sha256_k[64] = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
};

static uint32_t bundle_rotr(uint32_t value, uint32_t count) {
  return (value >> count) | (value << (32 - count));
}

static void bundle_sha_block(uint32_t state[8], const unsigned char block[64]) {
  uint32_t w[64];
  for (int i = 0; i < 16; i++) {
    w[i] = ((uint32_t)block[i * 4] << 24) |
      ((uint32_t)block[i * 4 + 1] << 16) |
      ((uint32_t)block[i * 4 + 2] << 8) | (uint32_t)block[i * 4 + 3];
  }
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = bundle_rotr(w[i - 15], 7) ^ bundle_rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = bundle_rotr(w[i - 2], 17) ^ bundle_rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = state[0], b = state[1], c = state[2], d = state[3];
  uint32_t e = state[4], f = state[5], g = state[6], h = state[7];
  for (int i = 0; i < 64; i++) {
    uint32_t s1 = bundle_rotr(e, 6) ^ bundle_rotr(e, 11) ^ bundle_rotr(e, 25);
    uint32_t ch = (e & f) ^ ((~e) & g);
    uint32_t temp1 = h + s1 + ch + bundle_sha256_k[i] + w[i];
    uint32_t s0 = bundle_rotr(a, 2) ^ bundle_rotr(a, 13) ^ bundle_rotr(a, 22);
    uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    uint32_t temp2 = s0 + maj;
    h = g; g = f; f = e; e = d + temp1;
    d = c; c = b; b = a; a = temp1 + temp2;
  }
  state[0] += a; state[1] += b; state[2] += c; state[3] += d;
  state[4] += e; state[5] += f; state[6] += g; state[7] += h;
}

static void bundle_sha256(const unsigned char *data, size_t length,
                          unsigned char out[32]) {
  uint32_t state[8] = {
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  };
  size_t offset = 0;
  while (offset + 64 <= length) {
    bundle_sha_block(state, data + offset);
    offset += 64;
  }
  unsigned char tail[128];
  size_t remaining = length - offset;
  memcpy(tail, data + offset, remaining);
  size_t total = remaining;
  tail[total++] = 0x80;
  while ((total % 64) != 56) tail[total++] = 0;
  uint64_t bits = (uint64_t)length * 8;
  for (int i = 7; i >= 0; i--) tail[total++] = (unsigned char)((bits >> (i * 8)) & 0xff);
  for (size_t i = 0; i < total; i += 64) bundle_sha_block(state, tail + i);
  for (int i = 0; i < 8; i++) {
    out[i * 4] = (unsigned char)(state[i] >> 24);
    out[i * 4 + 1] = (unsigned char)(state[i] >> 16);
    out[i * 4 + 2] = (unsigned char)(state[i] >> 8);
    out[i * 4 + 3] = (unsigned char)state[i];
  }
}

static void bundle_sha_hex(const unsigned char digest[32], char out[65]) {
  static const char hex[] = "0123456789abcdef";
  for (int i = 0; i < 32; i++) {
    out[i * 2] = hex[(digest[i] >> 4) & 0xf];
    out[i * 2 + 1] = hex[digest[i] & 0xf];
  }
  out[64] = 0;
}

// ---- file helpers ----
static int bundle_read_file(const char *path, size_t limit,
                            unsigned char **data_out, size_t *size_out) {
  *data_out = NULL;
  *size_out = 0;
  if (path == NULL || limit == 0) return -1;
  int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) return -1;
  struct stat info;
  if (fstat(fd, &info) != 0 || !S_ISREG(info.st_mode) ||
      info.st_size < 0 || (uint64_t)info.st_size > limit) {
    close(fd);
    return -1;
  }
  size_t size = (size_t)info.st_size;
  unsigned char *buffer = (unsigned char *)malloc(size == 0 ? 1 : size);
  if (buffer == NULL) { close(fd); return -1; }
  size_t offset = 0;
  while (offset < size) {
    ssize_t got = read(fd, buffer + offset, size - offset);
    if (got <= 0) break;
    offset += (size_t)got;
  }
  close(fd);
  if (offset != size) { free(buffer); return -1; }
  *data_out = buffer;
  *size_out = size;
  return 0;
}

static int bundle_write_all(int fd, const void *data, size_t size) {
  const unsigned char *cursor = (const unsigned char *)data;
  while (size > 0) {
    ssize_t written = write(fd, cursor, size);
    if (written <= 0) return -1;
    cursor += written;
    size -= (size_t)written;
  }
  return 0;
}

static int bundle_self_path(char *out, size_t capacity) {
  if (out == NULL || capacity < 2) return -1;
#if defined(__APPLE__)
  uint32_t size = (uint32_t)capacity;
  if (_NSGetExecutablePath(out, &size) != 0) return -1;
  return 0;
#else
  ssize_t length = readlink("/proc/self/exe", out, capacity - 1);
  if (length <= 0 || (size_t)length >= capacity) return -1;
  out[length] = 0;
  return 0;
#endif
}

static int bundle_path_under(const char *path, const char *root) {
  if (path == NULL || root == NULL) return 0;
  size_t n = strlen(root);
  if (n == 0 || strncmp(path, root, n) != 0) return 0;
  return path[n] == 0 || path[n] == '/';
}

static int bundle_ensure_dir(const char *path, int mode) {
  if (path == NULL || path[0] != '/') return -1;
  char *copy = strdup(path);
  if (copy == NULL) return -1;
  size_t length = strlen(copy);
  for (size_t i = 1; i < length; i++) {
    if (copy[i] != '/') continue;
    copy[i] = 0;
    struct stat info;
    if (lstat(copy, &info) != 0) {
      if (errno != ENOENT || mkdir(copy, (mode_t)mode) != 0) {
        free(copy);
        return -1;
      }
    } else if (!S_ISDIR(info.st_mode)) {
      free(copy);
      return -1;
    }
    copy[i] = '/';
  }
  struct stat info;
  int result = 0;
  if (lstat(copy, &info) != 0) {
    if (errno != ENOENT || mkdir(copy, (mode_t)mode) != 0) result = -1;
  } else if (!S_ISDIR(info.st_mode)) {
    result = -1;
  }
  free(copy);
  return result;
}

static char *bundle_join(const char *left, const char *right) {
  if (left == NULL || right == NULL) return NULL;
  size_t a = strlen(left), b = strlen(right);
  if (a + b + 2 > EBT_BUNDLE_MAX_PATH * 2) return NULL;
  char *out = (char *)malloc(a + b + 2);
  if (out == NULL) return NULL;
  memcpy(out, left, a);
  out[a] = '/';
  memcpy(out + a + 1, right, b + 1);
  return out;
}

static int bundle_write_atomic(const char *directory, const char *name,
                               const unsigned char *data, size_t size,
                               mode_t mode) {
  if (directory == NULL || name == NULL || name[0] == 0 ||
      strchr(name, '/') != NULL) return -1;
  char temp_name[256];
  snprintf(temp_name, sizeof(temp_name), ".emoon-bundle-%ld-%u",
           (long)getpid(), (unsigned)rand());
  char *temp = bundle_join(directory, temp_name);
  if (temp == NULL) return -1;
  int fd = open(temp, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
                (mode_t)mode);
  if (fd < 0) { free(temp); return -1; }
  int failed = bundle_write_all(fd, data, size) != 0;
  if (!failed && fsync(fd) != 0) failed = 1;
  if (close(fd) != 0) failed = 1;
  if (!failed) {
    char *target = bundle_join(directory, name);
    if (target == NULL) failed = 1;
    else {
      if (rename(temp, target) != 0) failed = 1;
      free(target);
    }
  }
  if (failed) unlink(temp);
  free(temp);
  return failed ? -1 : 0;
}

static char *bundle_xdg_base(const char *variable, const char *fallback) {
  const char *value = getenv(variable);
  if (value != NULL && value[0] == '/') return strdup(value);
  const char *home = getenv("HOME");
  if (home == NULL || home[0] != '/') return NULL;
  size_t length = strlen(home) + strlen(fallback) + 2;
  char *out = (char *)malloc(length);
  if (out == NULL) return NULL;
  snprintf(out, length, "%s/%s", home, fallback);
  return out;
}

static int bundle_slug(const char *name, char out[80]) {
  if (name == NULL || name[0] == 0 || out == NULL) return -1;
  size_t index = 0;
  for (const unsigned char *cursor = (const unsigned char *)name;
       *cursor != 0 && index < 64; cursor++) {
    unsigned char ch = *cursor;
    if (ch >= 'A' && ch <= 'Z') ch = (unsigned char)(ch - 'A' + 'a');
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') ||
        ch == '.' || ch == '_' || ch == '-') out[index++] = (char)ch;
    else out[index++] = '_';
  }
  if (index == 0) return -1;
  out[index] = 0;
  if (strcmp(out, ".") == 0 || strcmp(out, "..") == 0) return -1;
  return 0;
}

// ---- bundle writer ----

typedef struct {
  char *path;
  size_t size;
} BundlePath;

typedef struct {
  BundlePath *items;
  size_t count;
  size_t capacity;
  const char *root;
  int failed;
} BundleWalk;

static BundleWalk *bundle_walk_state = NULL;

static int bundle_walk_callback(const char *path, const struct stat *info,
                                int type, struct FTW *ftw) {
  (void)info; (void)ftw;
  BundleWalk *walk = bundle_walk_state;
  if (walk == NULL) return -1;
  if (type == FTW_SL || type == FTW_DNR || type == FTW_NS) {
    walk->failed = 1;
    return -1;
  }
  if (type != FTW_F) return 0;
  size_t root_length = strlen(walk->root);
  if (strncmp(path, walk->root, root_length) != 0 ||
      path[root_length] != '/') return 0;
  const char *relative = path + root_length + 1;
  if (strcmp(relative, ".appData") == 0 ||
      strncmp(relative, ".appData/", 9) == 0 ||
      strcmp(relative, ".userData") == 0 ||
      strncmp(relative, ".userData/", 10) == 0 ||
      strcmp(relative, ".lock") == 0 ||
      strcmp(relative, "bundle.json") == 0) return 0;
  if (relative[0] == '/' || strstr(relative, "/../") != NULL ||
      strncmp(relative, "../", 3) == 0 || strcmp(relative, "..") == 0 ||
      strlen(relative) > EBT_BUNDLE_MAX_PATH) {
    walk->failed = 1;
    return -1;
  }
  if (walk->count >= EBT_BUNDLE_MAX_FILES) { walk->failed = 1; return -1; }
  struct stat stat_info;
  if (lstat(path, &stat_info) != 0 || !S_ISREG(stat_info.st_mode) ||
      stat_info.st_size < 0 || (uint64_t)stat_info.st_size > EBT_BUNDLE_MAX_FILE) {
    walk->failed = 1;
    return -1;
  }
  if (walk->count == walk->capacity) {
    size_t next = walk->capacity == 0 ? 32 : walk->capacity * 2;
    BundlePath *items = (BundlePath *)realloc(walk->items, next * sizeof(BundlePath));
    if (items == NULL) { walk->failed = 1; return -1; }
    walk->items = items;
    walk->capacity = next;
  }
  walk->items[walk->count].path = strdup(relative);
  walk->items[walk->count].size = (size_t)stat_info.st_size;
  if (walk->items[walk->count].path == NULL) { walk->failed = 1; return -1; }
  walk->count += 1;
  return 0;
}

static int bundle_path_compare(const void *left, const void *right) {
  const BundlePath *a = (const BundlePath *)left;
  const BundlePath *b = (const BundlePath *)right;
  return strcmp(a->path, b->path);
}

static void bundle_put_u16(unsigned char *out, uint16_t value) {
  out[0] = (unsigned char)(value & 0xff);
  out[1] = (unsigned char)((value >> 8) & 0xff);
}
static void bundle_put_u32(unsigned char *out, uint32_t value) {
  for (int i = 0; i < 4; i++) out[i] = (unsigned char)((value >> (i * 8)) & 0xff);
}
static void bundle_put_u64(unsigned char *out, uint64_t value) {
  for (int i = 0; i < 8; i++) out[i] = (unsigned char)((value >> (i * 8)) & 0xff);
}
static uint16_t bundle_get_u16(const unsigned char *in) {
  return (uint16_t)(in[0] | ((uint16_t)in[1] << 8));
}
static uint32_t bundle_get_u32(const unsigned char *in) {
  uint32_t value = 0;
  for (int i = 0; i < 4; i++) value |= (uint32_t)in[i] << (i * 8);
  return value;
}
static uint64_t bundle_get_u64(const unsigned char *in) {
  uint64_t value = 0;
  for (int i = 0; i < 8; i++) value |= (uint64_t)in[i] << (i * 8);
  return value;
}

static void bundle_footer_put(unsigned char footer[EBT_BUNDLE_FOOTER],
                              uint32_t compression, uint64_t offset,
                              uint64_t stored, uint64_t raw,
                              const unsigned char raw_sha[32],
                              const unsigned char stored_sha[32],
                              const unsigned char host_sha[32],
                              uint64_t host_size, uint32_t app_files,
                              const char *name, const char *version) {
  memset(footer, 0, EBT_BUNDLE_FOOTER);
  memcpy(footer, bundle_footer_magic, 8);
  bundle_put_u32(footer + 8, 1);
  bundle_put_u32(footer + 12, compression);
  bundle_put_u64(footer + 16, offset);
  bundle_put_u64(footer + 24, stored);
  bundle_put_u64(footer + 32, raw);
  memcpy(footer + 40, raw_sha, 32);
  memcpy(footer + 72, stored_sha, 32);
  memcpy(footer + 104, host_sha, 32);
  bundle_put_u64(footer + 136, 0);
  bundle_put_u64(footer + 144, host_size);
  bundle_put_u64(footer + 152, 0);
  bundle_put_u64(footer + 160, 0);
  bundle_put_u32(footer + 168, app_files);
  if (name != NULL) strncpy((char *)footer + 172, name, 63);
  if (version != NULL) strncpy((char *)footer + 236, version, 31);
}

static int bundle_footer_read(int fd, off_t file_size, unsigned char *footer) {
  if (file_size < EBT_BUNDLE_FOOTER) return -1;
  if (pread(fd, footer, EBT_BUNDLE_FOOTER, file_size - EBT_BUNDLE_FOOTER) !=
      EBT_BUNDLE_FOOTER) return -1;
  if (memcmp(footer, bundle_footer_magic, 8) != 0) return -1;
  if (bundle_get_u32(footer + 8) != 1) return -1;
  uint32_t compression = bundle_get_u32(footer + 12);
  if (compression > 1) return -1;
  uint64_t offset = bundle_get_u64(footer + 16);
  uint64_t stored = bundle_get_u64(footer + 24);
  uint64_t raw = bundle_get_u64(footer + 32);
  if (offset > (uint64_t)file_size ||
      stored > (uint64_t)file_size - EBT_BUNDLE_FOOTER ||
      offset > (uint64_t)file_size - EBT_BUNDLE_FOOTER - stored ||
      raw == 0 || raw > EBT_BUNDLE_MAX_RAW || stored == 0 ||
      bundle_get_u32(footer + 168) > EBT_BUNDLE_MAX_FILES) return -1;
  return 0;
}

static int bundle_read_payload(const char *self, unsigned char **raw_out,
                               size_t *raw_size, unsigned char footer[EBT_BUNDLE_FOOTER]) {
  int fd = open(self, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return -1;
  struct stat info;
  if (fstat(fd, &info) != 0 || info.st_size < EBT_BUNDLE_FOOTER ||
      bundle_footer_read(fd, info.st_size, footer) != 0) {
    close(fd);
    return -1;
  }
  uint64_t offset = bundle_get_u64(footer + 16);
  uint64_t stored = bundle_get_u64(footer + 24);
  uint64_t raw_length = bundle_get_u64(footer + 32);
  unsigned char *stored_data = (unsigned char *)malloc((size_t)stored);
  unsigned char *raw_data = (unsigned char *)malloc((size_t)raw_length);
  if (stored_data == NULL || raw_data == NULL) {
    free(stored_data); free(raw_data); close(fd); return -1;
  }
  if (pread(fd, stored_data, (size_t)stored, (off_t)offset) != (ssize_t)stored) {
    free(stored_data); free(raw_data); close(fd); return -1;
  }
  close(fd);
  unsigned char stored_sha[32], raw_sha[32];
  bundle_sha256(stored_data, (size_t)stored, stored_sha);
  if (memcmp(stored_sha, footer + 72, 32) != 0) {
    free(stored_data); free(raw_data); return -1;
  }
  uint32_t compression = bundle_get_u32(footer + 12);
  if (compression == 0) {
    if (stored != raw_length) {
      free(stored_data); free(raw_data); return -1;
    }
    memcpy(raw_data, stored_data, (size_t)raw_length);
  } else {
    uLongf destination = (uLongf)raw_length;
    if (uncompress(raw_data, &destination, stored_data, (uLong)stored) != Z_OK ||
        destination != (uLongf)raw_length) {
      free(stored_data); free(raw_data); return -1;
    }
  }
  free(stored_data);
  bundle_sha256(raw_data, (size_t)raw_length, raw_sha);
  if (memcmp(raw_sha, footer + 40, 32) != 0) {
    free(raw_data); return -1;
  }
  *raw_out = raw_data;
  *raw_size = (size_t)raw_length;
  return 0;
}

typedef struct {
  const unsigned char *host;
  size_t host_size;
  const unsigned char *files;
  size_t files_size;
  uint32_t count;
} BundlePayload;

static int bundle_payload_parse(const unsigned char *raw, size_t size,
                                BundlePayload *payload) {
  memset(payload, 0, sizeof(*payload));
  if (raw == NULL || size < 16 || memcmp(raw, bundle_payload_magic, 8) != 0 ||
      bundle_get_u32(raw + 8) != 1) return -1;
  uint32_t count = bundle_get_u32(raw + 12);
  if (count == 0 || count > EBT_BUNDLE_MAX_FILES + 1) return -1;
  size_t offset = 16;
  uint32_t app_files = 0;
  for (uint32_t i = 0; i < count; i++) {
    if (offset + 13 > size) return -1;
    uint16_t path_length = bundle_get_u16(raw + offset);
    unsigned char kind = raw[offset + 2];
    uint64_t data_size = bundle_get_u64(raw + offset + 5);
    offset += 13;
    if (path_length == 0 || path_length > EBT_BUNDLE_MAX_PATH ||
        offset + path_length > size) return -1;
    const unsigned char *path = raw + offset;
    offset += path_length;
    if (data_size > EBT_BUNDLE_MAX_RAW || offset + data_size > size) return -1;
    if (path[0] == '/' || memchr(path, 0, path_length) != NULL) return -1;
    if (kind == 1) {
      if (payload->host != NULL || path_length != 8 ||
          memcmp(path, "__host__", 8) != 0) return -1;
      payload->host = raw + offset;
      payload->host_size = (size_t)data_size;
    } else if (kind == 0) {
      app_files += 1;
    } else {
      return -1;
    }
    offset += (size_t)data_size;
  }
  if (offset != size || payload->host == NULL) return -1;
  payload->files = raw;
  payload->files_size = size;
  payload->count = count;
  (void)app_files;
  return 0;
}

static int bundle_write_payload(const unsigned char *raw, size_t raw_size,
                                unsigned char **stored_out, size_t *stored_size,
                                unsigned char stored_sha[32],
                                unsigned char raw_sha[32]) {
  if (raw == NULL || raw_size == 0) return -1;
  bundle_sha256(raw, raw_size, raw_sha);
  uLongf bound = compressBound((uLong)raw_size);
  unsigned char *compressed = (unsigned char *)malloc((size_t)bound);
  if (compressed == NULL) return -1;
  uLongf compressed_size = bound;
  int result = compress2(compressed, &compressed_size, raw, (uLong)raw_size, 9);
  if (result != Z_OK || compressed_size >= raw_size) {
    free(compressed);
    *stored_out = (unsigned char *)malloc(raw_size);
    if (*stored_out == NULL) return -1;
    memcpy(*stored_out, raw, raw_size);
    *stored_size = raw_size;
  } else {
    *stored_out = compressed;
    *stored_size = (size_t)compressed_size;
  }
  bundle_sha256(*stored_out, *stored_size, stored_sha);
  return 0;
}

static int bundle_make_payload(const char *stage, const char *host,
                               unsigned char **raw_out, size_t *raw_size,
                               unsigned char host_sha[32], uint32_t *file_count,
                               size_t *app_bytes, size_t *host_bytes) {
  unsigned char *host_data = NULL;
  size_t host_length = 0;
  if (bundle_read_file(host, EBT_BUNDLE_MAX_HOST, &host_data, &host_length) != 0) {
    return -1;
  }
  bundle_sha256(host_data, host_length, host_sha);
  char *canonical_stage = realpath(stage, NULL);
  if (canonical_stage == NULL) {
    free(host_data);
    return -1;
  }
  BundleWalk walk;
  memset(&walk, 0, sizeof(walk));
  walk.root = canonical_stage;
  bundle_walk_state = &walk;
  int walked = nftw(canonical_stage, bundle_walk_callback, 32, FTW_PHYS);
  bundle_walk_state = NULL;
  if (walked != 0 || walk.failed || walk.count == 0) {
    for (size_t i = 0; i < walk.count; i++) free(walk.items[i].path);
    free(walk.items);
    free(host_data);
    free(canonical_stage);
    return -1;
  }
  qsort(walk.items, walk.count, sizeof(BundlePath), bundle_path_compare);
  uint64_t total = 16;
  total += 13 + 8 + host_length; // kind, path, metadata
  for (size_t i = 0; i < walk.count; i++) {
    if (strlen(walk.items[i].path) > UINT16_MAX) {
      walked = -1;
      break;
    }
    total += 13 + strlen(walk.items[i].path) + walk.items[i].size;
  }
  if (walked != 0 || total > EBT_BUNDLE_MAX_RAW) {
    for (size_t i = 0; i < walk.count; i++) free(walk.items[i].path);
    free(walk.items);
    free(host_data);
    free(canonical_stage);
    return -1;
  }
  unsigned char *raw = (unsigned char *)malloc((size_t)total);
  if (raw == NULL) {
    for (size_t i = 0; i < walk.count; i++) free(walk.items[i].path);
    free(walk.items); free(host_data); free(canonical_stage);
    return -1;
  }
  size_t offset = 0;
  memcpy(raw, bundle_payload_magic, 8);
  bundle_put_u32(raw + 8, 1);
  bundle_put_u32(raw + 12, (uint32_t)(walk.count + 1));
  offset = 16;
  // host entry
  bundle_put_u16(raw + offset, 8);
  raw[offset + 2] = 1;
  bundle_put_u16(raw + offset + 3, 0700);
  bundle_put_u64(raw + offset + 5, host_length);
  offset += 13;
  memcpy(raw + offset, "__host__", 8);
  offset += 8;
  memcpy(raw + offset, host_data, host_length);
  offset += host_length;
  size_t app_total = 0;
  for (size_t i = 0; i < walk.count; i++) {
    const char *path = walk.items[i].path;
    size_t path_length = strlen(path);
    unsigned char *data = NULL;
    size_t data_length = 0;
    char *full = bundle_join(canonical_stage, path);
    if (full == NULL ||
        bundle_read_file(full, EBT_BUNDLE_MAX_FILE, &data, &data_length) != 0 ||
        data_length != walk.items[i].size) {
      free(full); free(data); free(raw);
      for (size_t j = 0; j < walk.count; j++) free(walk.items[j].path);
      free(walk.items); free(host_data); free(canonical_stage);
      return -1;
    }
    free(full);
    bundle_put_u16(raw + offset, (uint16_t)path_length);
    raw[offset + 2] = 0;
    bundle_put_u16(raw + offset + 3, 0600);
    bundle_put_u64(raw + offset + 5, data_length);
    offset += 13;
    memcpy(raw + offset, path, path_length);
    offset += path_length;
    memcpy(raw + offset, data, data_length);
    offset += data_length;
    app_total += data_length;
    free(data);
  }
  *raw_out = raw;
  *raw_size = offset;
  *file_count = (uint32_t)walk.count;
  *app_bytes = app_total;
  *host_bytes = host_length;
  for (size_t i = 0; i < walk.count; i++) free(walk.items[i].path);
  free(walk.items); free(host_data); free(canonical_stage);
  return 0;
}

static int bundle_json_escape(const char *input, char *out, size_t capacity) {
  if (input == NULL) input = "";
  size_t used = 0;
  for (const unsigned char *cursor = (const unsigned char *)input;
       *cursor != 0; cursor++) {
    unsigned char ch = *cursor;
    if (ch == '"' || ch == '\\') {
      if (used + 2 >= capacity) return -1;
      out[used++] = '\\'; out[used++] = (char)ch;
    } else if (ch < 0x20) {
      if (used + 6 >= capacity) return -1;
      int written = snprintf(out + used, capacity - used, "\\u%04x", ch);
      if (written != 6) return -1;
      used += 6;
    } else {
      if (used + 1 >= capacity) return -1;
      out[used++] = (char)ch;
    }
  }
  out[used] = 0;
  return 0;
}

int32_t moonbit_ebt_bundle_create(
    moonbit_bytes_t output_bytes, moonbit_bytes_t stage_bytes,
    moonbit_bytes_t host_bytes, moonbit_bytes_t name_bytes,
    moonbit_bytes_t version_bytes, moonbit_bytes_t report_out,
    int32_t report_capacity, moonbit_bytes_t error_out,
    int32_t error_capacity, int32_t force) {
  char *output = bundle_copy_bytes(output_bytes);
  char *stage = bundle_copy_bytes(stage_bytes);
  char *host = bundle_copy_bytes(host_bytes);
  char *name = bundle_copy_bytes(name_bytes);
  char *version = bundle_copy_bytes(version_bytes);
  if (output == NULL || stage == NULL || host == NULL || name == NULL ||
      version == NULL) {
    free(output); free(stage); free(host); free(name); free(version);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_ARGUMENT",
                 "bundle arguments are invalid");
    return 1;
  }
  char *canonical_stage = realpath(stage, NULL);
  char *canonical_output_parent = NULL;
  char *output_copy_for_parent = strdup(output);
  if (canonical_stage == NULL || output_copy_for_parent == NULL) {
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_STAGE",
                 "stage or output path is invalid");
    goto fail;
  }
  char *slash = strrchr(output_copy_for_parent, '/');
  const char *base = output;
  if (slash != NULL) {
    if (slash == output_copy_for_parent) {
      output_copy_for_parent[1] = 0;
    } else {
      *slash = 0;
    }
    canonical_output_parent = realpath(output_copy_for_parent, NULL);
    base = slash + 1;
  } else {
    canonical_output_parent = realpath(".", NULL);
  }
  if (canonical_output_parent == NULL || base[0] == 0 ||
      strchr(base, '/') != NULL) {
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_OUTPUT",
                 "output parent is not a directory");
    goto fail;
  }
  char *canonical_output = bundle_join(canonical_output_parent, base);
  if (canonical_output == NULL ||
      bundle_path_under(canonical_output, canonical_stage)) {
    free(canonical_output);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_OUTPUT",
                 "output must be outside the stage");
    goto fail;
  }
  if (!force) {
    struct stat existing;
    if (lstat(output, &existing) == 0) {
      free(canonical_output);
      bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_EXISTS",
                   "output exists; pass --force to replace it");
      goto fail;
    }
  } else {
    struct stat existing;
    if (lstat(output, &existing) == 0 &&
        (!S_ISREG(existing.st_mode) || S_ISLNK(existing.st_mode))) {
      free(canonical_output);
      bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_OUTPUT",
                   "output is not a regular file");
      goto fail;
    }
  }
  char self[EBT_BUNDLE_MAX_PATH];
  if (bundle_self_path(self, sizeof(self)) != 0) {
    free(canonical_output);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_SELF",
                 "cannot resolve the current executable");
    goto fail;
  }
  struct stat self_info, output_info;
  if (stat(self, &self_info) == 0 && stat(canonical_output, &output_info) == 0 &&
      self_info.st_dev == output_info.st_dev &&
      self_info.st_ino == output_info.st_ino) {
    free(canonical_output);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_OUTPUT",
                 "output is the running executable");
    goto fail;
  }
  unsigned char *raw = NULL;
  size_t raw_size = 0;
  unsigned char host_sha[32];
  uint32_t app_files = 0;
  size_t app_bytes = 0, host_size = 0;
  if (bundle_make_payload(stage, host, &raw, &raw_size, host_sha,
                          &app_files, &app_bytes, &host_size) != 0) {
    free(canonical_output);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_STAGE",
                 "stage cannot be read as a bounded bundle");
    goto fail;
  }
  unsigned char *stored = NULL;
  size_t stored_size = 0;
  unsigned char stored_sha[32], raw_sha[32];
  if (bundle_write_payload(raw, raw_size, &stored, &stored_size, stored_sha,
                           raw_sha) != 0) {
    free(raw); free(canonical_output);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_COMPRESS",
                 "payload compression failed");
    goto fail;
  }
  unsigned char *cli = NULL;
  size_t cli_size = 0;
  if (bundle_read_file(self, EBT_BUNDLE_MAX_RAW, &cli, &cli_size) != 0) {
    free(raw); free(stored); free(canonical_output);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_SELF",
                 "cannot read the current executable");
    goto fail;
  }
  char temp_name[256];
  snprintf(temp_name, sizeof(temp_name), ".emoon-bundle-%ld", (long)getpid());
  char *temp = bundle_join(canonical_output_parent, temp_name);
  if (temp == NULL) {
    free(raw); free(stored); free(cli); free(canonical_output);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_IO",
                 "cannot allocate output path");
    goto fail;
  }
  unlink(temp);
  int fd = open(temp, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0700);
  if (fd < 0) {
    free(raw); free(stored); free(cli); free(canonical_output); free(temp);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_IO",
                 "cannot create output file");
    goto fail;
  }
  unsigned char footer[EBT_BUNDLE_FOOTER];
  uint32_t compression = stored_size < raw_size ? 1 : 0;
  bundle_footer_put(footer, compression, (uint64_t)cli_size,
                    (uint64_t)stored_size, (uint64_t)raw_size, raw_sha,
                    stored_sha, host_sha, (uint64_t)host_size, app_files,
                    name, version);
  int failed = bundle_write_all(fd, cli, cli_size) != 0 ||
    bundle_write_all(fd, stored, stored_size) != 0 ||
    bundle_write_all(fd, footer, sizeof(footer)) != 0;
  if (!failed && fsync(fd) != 0) failed = 1;
  if (close(fd) != 0) failed = 1;
  if (failed) {
    unlink(temp);
    free(raw); free(stored); free(cli); free(canonical_output); free(temp);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_IO",
                 "cannot write output file");
    goto fail;
  }
  chmod(temp, 0755);
  if (rename(temp, canonical_output) != 0) {
    unlink(temp);
    free(raw); free(stored); free(cli); free(canonical_output); free(temp);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_IO",
                 "cannot publish output file");
    goto fail;
  }
  unsigned char *final = NULL;
  size_t final_size = 0;
  if (bundle_read_file(canonical_output, EBT_BUNDLE_MAX_RAW + 8u * 1024u * 1024u,
                       &final, &final_size) != 0) {
    free(raw); free(stored); free(cli); free(temp); free(canonical_output);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_IO",
                 "cannot hash output file");
    goto fail;
  }
  unsigned char final_sha[32];
  char final_hex[65];
  bundle_sha256(final, final_size, final_sha);
  bundle_sha_hex(final_sha, final_hex);
  char escaped_output[8192], escaped_name[256], escaped_version[128];
  bundle_json_escape(canonical_output, escaped_output, sizeof(escaped_output));
  bundle_json_escape(name, escaped_name, sizeof(escaped_name));
  bundle_json_escape(version, escaped_version, sizeof(escaped_version));
  char host_hex[65];
  bundle_sha_hex(host_sha, host_hex);
  char report[16384];
  snprintf(report, sizeof(report),
    "{\"schema\":1,\"status\":\"bundled\",\"format\":\"emoon-single-v1\","
    "\"output\":\"%s\",\"bytes\":%llu,\"sha256\":\"%s\",\"storedBytes\":%llu,"
    "\"rawBytes\":%llu,\"compression\":\"%s\",\"app\":{\"name\":\"%s\","
    "\"version\":\"%s\",\"files\":%u,\"bytes\":%llu},\"host\":{\"sha256\":\"%s\","
    "\"bytes\":%llu},\"compatible\":false,\"claim\":\"not-a-compatibility-result\"}",
    escaped_output, (unsigned long long)final_size, final_hex,
    (unsigned long long)stored_size, (unsigned long long)raw_size,
    compression ? "zlib" : "raw", escaped_name, escaped_version, app_files,
    (unsigned long long)app_bytes, host_hex, (unsigned long long)host_size);
  bundle_set_data(report_out, report_capacity, report);
  int32_t report_length = (int32_t)strlen(report);
  free(final);
  free(raw); free(stored); free(cli); free(temp); free(canonical_output);
  free(output); free(stage); free(host); free(name); free(version);
  free(output_copy_for_parent); free(canonical_stage); free(canonical_output_parent);
  return report_length;

fail:
  free(output); free(stage); free(host); free(name); free(version);
  free(output_copy_for_parent); free(canonical_stage); free(canonical_output_parent);
  return -1;
}

// ---- embedded reader ----

int32_t moonbit_ebt_bundle_embedded(void) {
  const char *active = getenv("EMOON_BUNDLE_ACTIVE");
  if (active != NULL && strcmp(active, "1") == 0) return 0;
  char self[EBT_BUNDLE_MAX_PATH];
  if (bundle_self_path(self, sizeof(self)) != 0) return 0;
  int fd = open(self, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return 0;
  struct stat info;
  int embedded = 0;
  if (fstat(fd, &info) == 0 && info.st_size >= EBT_BUNDLE_FOOTER) {
    unsigned char footer[EBT_BUNDLE_FOOTER];
    embedded = bundle_footer_read(fd, info.st_size, footer) == 0;
  }
  close(fd);
  return embedded;
}

static int bundle_extract_host(const BundlePayload *payload, const char *cache,
                               char **host_out) {
  char host_hex[65];
  unsigned char digest[32];
  bundle_sha256(payload->host, payload->host_size, digest);
  bundle_sha_hex(digest, host_hex);
  char *dir = bundle_join(cache, "electromoon");
  if (dir == NULL) return -1;
  char *hosts = bundle_join(dir, "hosts");
  char *hash_dir = hosts == NULL ? NULL : bundle_join(hosts, host_hex);
  if (hash_dir == NULL || bundle_ensure_dir(hash_dir, 0700) != 0) {
    free(dir); free(hosts); free(hash_dir); return -1;
  }
  char *path = bundle_join(hash_dir, "emoon-host");
  if (path == NULL) {
    free(dir); free(hosts); free(hash_dir); return -1;
  }
  unsigned char *existing = NULL;
  size_t existing_size = 0;
  int valid = bundle_read_file(path, EBT_BUNDLE_MAX_HOST, &existing, &existing_size) == 0;
  if (valid) {
    unsigned char check[32];
    bundle_sha256(existing, existing_size, check);
    valid = existing_size == payload->host_size && memcmp(check, digest, 32) == 0;
    free(existing);
  }
  if (!valid) {
    if (bundle_write_atomic(hash_dir, "emoon-host", payload->host,
                            payload->host_size, 0700) != 0) {
      free(dir); free(hosts); free(hash_dir); free(path); return -1;
    }
  }
  free(dir); free(hosts); free(hash_dir);
  *host_out = path;
  return 0;
}

static int bundle_extract_app(const BundlePayload *payload, const char *app_root,
                              uint32_t *app_files) {
  if (bundle_ensure_dir(app_root, 0700) != 0) return -1;
  size_t offset = 16;
  uint32_t count = bundle_get_u32(payload->files + 12);
  uint32_t extracted = 0;
  for (uint32_t i = 0; i < count; i++) {
    uint16_t path_length = bundle_get_u16(payload->files + offset);
    unsigned char kind = payload->files[offset + 2];
    uint64_t size = bundle_get_u64(payload->files + offset + 5);
    offset += 13;
    const unsigned char *path_bytes = payload->files + offset;
    offset += path_length;
    const unsigned char *data = payload->files + offset;
    offset += (size_t)size;
    if (kind != 0) continue;
    char *path = (char *)malloc((size_t)path_length + 1);
    if (path == NULL) return -1;
    memcpy(path, path_bytes, path_length);
    path[path_length] = 0;
    if (path[0] == '/' || strstr(path, "..") != NULL ||
        strncmp(path, ".appData", 8) == 0 || strncmp(path, ".userData", 9) == 0) {
      free(path);
      return -1;
    }
    char *full = bundle_join(app_root, path);
    if (full == NULL) { free(path); return -1; }
    free(path);
    char *parent = strdup(full);
    if (parent == NULL) { free(full); return -1; }
    char *slash = strrchr(parent, '/');
    if (slash == NULL || slash == parent) {
      free(parent); free(full); return -1;
    }
    *slash = 0;
    const char *base = slash + 1;
    if (bundle_ensure_dir(parent, 0700) != 0 ||
        bundle_write_atomic(parent, base, data, (size_t)size, 0600) != 0) {
      free(parent); free(full); return -1;
    }
    free(parent); free(full);
    extracted += 1;
  }
  *app_files = extracted;
  return 0;
}

int32_t moonbit_ebt_bundle_prepare(
    moonbit_bytes_t root_out, int32_t root_capacity,
    moonbit_bytes_t error_out, int32_t error_capacity) {
  char self[EBT_BUNDLE_MAX_PATH];
  if (bundle_self_path(self, sizeof(self)) != 0) {
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_SELF",
                 "cannot resolve the current executable");
    return 1;
  }
  unsigned char footer[EBT_BUNDLE_FOOTER];
  unsigned char *raw = NULL;
  size_t raw_size = 0;
  if (bundle_read_payload(self, &raw, &raw_size, footer) != 0) {
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_CORRUPT",
                 "bundle payload is missing or corrupt");
    return 1;
  }
  BundlePayload payload;
  if (bundle_payload_parse(raw, raw_size, &payload) != 0) {
    free(raw);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_CORRUPT",
                 "bundle payload headers are invalid");
    return 1;
  }
  char name[64] = {0};
  char version[32] = {0};
  memcpy(name, footer + 172, 63);
  memcpy(version, footer + 236, 31);
  char slug[80];
  if (bundle_slug(name, slug) != 0) {
    free(raw);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_APP",
                 "bundle app name is not safe");
    return 1;
  }
  char *data_home = bundle_xdg_base("XDG_DATA_HOME", ".local/share");
  char *cache_home = bundle_xdg_base("XDG_CACHE_HOME", ".cache");
  if (data_home == NULL || cache_home == NULL) {
    free(raw); free(data_home); free(cache_home);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_HOME",
                 "cannot resolve XDG data/cache directories");
    return 1;
  }
  char *apps = bundle_join(data_home, "electromoon/apps");
  char *app_home = apps == NULL ? NULL : bundle_join(apps, slug);
  if (app_home == NULL || bundle_ensure_dir(app_home, 0700) != 0) {
    free(raw); free(data_home); free(cache_home); free(apps); free(app_home);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_HOME",
                 "cannot create the app data directory");
    return 1;
  }
  char *lock_path = bundle_join(app_home, ".lock");
  int lock_fd = lock_path == NULL ? -1 : open(lock_path, O_CREAT | O_RDWR, 0600);
  if (lock_fd < 0 || flock(lock_fd, LOCK_EX) != 0) {
    if (lock_fd >= 0) close(lock_fd);
    free(lock_path); free(raw); free(data_home); free(cache_home); free(apps); free(app_home);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_LOCK",
                 "cannot lock the app data directory");
    return 1;
  }
  char *host_path = NULL;
  if (bundle_extract_host(&payload, cache_home, &host_path) != 0) {
    flock(lock_fd, LOCK_UN); close(lock_fd);
    free(lock_path); free(raw); free(data_home); free(cache_home); free(apps); free(app_home);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_HOST",
                 "cannot extract the native host");
    return 1;
  }
  char *app_root = bundle_join(app_home, "app");
  char *marker = bundle_join(app_home, "bundle.json");
  char payload_hex[65], host_hex[65];
  bundle_sha_hex(footer + 40, payload_hex);
  bundle_sha_hex(footer + 104, host_hex);
  char marker_text[512];
  snprintf(marker_text, sizeof(marker_text),
           "{\"schema\":1,\"payload\":\"%s\",\"host\":\"%s\",\"version\":\"%s\"}\n",
           payload_hex, host_hex, version);
  int marker_ok = 0;
  unsigned char *existing_marker = NULL;
  size_t marker_size = 0;
  if (marker != NULL && bundle_read_file(marker, sizeof(marker_text) + 1,
                                         &existing_marker, &marker_size) == 0) {
    marker_ok = marker_size == strlen(marker_text) &&
      memcmp(existing_marker, marker_text, marker_size) == 0;
    free(existing_marker);
  }
  struct stat app_info;
  if (!marker_ok || app_root == NULL || stat(app_root, &app_info) != 0 ||
      !S_ISDIR(app_info.st_mode)) {
    uint32_t app_files = 0;
    if (app_root == NULL || bundle_extract_app(&payload, app_root, &app_files) != 0) {
      flock(lock_fd, LOCK_UN); close(lock_fd);
      free(host_path); free(lock_path); free(raw); free(data_home); free(cache_home);
      free(apps); free(app_home); free(app_root); free(marker);
      bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_EXTRACT",
                   "cannot extract the app files");
      return 1;
    }
    if (bundle_write_atomic(app_home, "bundle.json",
                            (const unsigned char *)marker_text, strlen(marker_text),
                            0600) != 0) {
      flock(lock_fd, LOCK_UN); close(lock_fd);
      free(host_path); free(lock_path); free(raw); free(data_home); free(cache_home);
      free(apps); free(app_home); free(app_root); free(marker);
      bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_EXTRACT",
                   "cannot publish the extraction marker");
      return 1;
    }
  }
  if (setenv("EMOON_HOST", host_path, 1) != 0 ||
      setenv("EMOON_BUNDLE_ACTIVE", "1", 1) != 0) {
    flock(lock_fd, LOCK_UN); close(lock_fd);
    free(host_path); free(lock_path); free(raw); free(data_home); free(cache_home);
    free(apps); free(app_home); free(app_root); free(marker);
    bundle_error(error_out, error_capacity, "ELECTRON_MBT_BUNDLE_ENV",
                 "cannot configure the embedded host");
    return 1;
  }
  bundle_set_data(root_out, root_capacity, app_root);
  flock(lock_fd, LOCK_UN); close(lock_fd);
  free(host_path); free(lock_path); free(raw); free(data_home); free(cache_home);
  free(apps); free(app_home); free(app_root); free(marker);
  return 0;
}

int32_t moonbit_ebt_bundle_info(moonbit_bytes_t out, int32_t capacity) {
  char self[EBT_BUNDLE_MAX_PATH];
  if (bundle_self_path(self, sizeof(self)) != 0) {
    bundle_error(out, capacity, "ELECTRON_MBT_BUNDLE_SELF",
                 "cannot resolve the current executable");
    return -1;
  }
  int fd = open(self, O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    bundle_error(out, capacity, "ELECTRON_MBT_BUNDLE_SELF",
                 "cannot open the current executable");
    return -1;
  }
  struct stat info;
  unsigned char footer[EBT_BUNDLE_FOOTER];
  if (fstat(fd, &info) != 0 || bundle_footer_read(fd, info.st_size, footer) != 0) {
    close(fd);
    bundle_error(out, capacity, "ELECTRON_MBT_BUNDLE_INFO",
                 "the executable does not contain an emoon bundle");
    return -1;
  }
  close(fd);
  char payload_hex[65], host_hex[65];
  bundle_sha_hex(footer + 40, payload_hex);
  bundle_sha_hex(footer + 104, host_hex);
  char name[65] = {0}, version[33] = {0};
  memcpy(name, footer + 172, 64);
  memcpy(version, footer + 236, 32);
  char escaped_name[256], escaped_version[128];
  bundle_json_escape(name, escaped_name, sizeof(escaped_name));
  bundle_json_escape(version, escaped_version, sizeof(escaped_version));
  char report[4096];
  snprintf(report, sizeof(report),
    "{\"schema\":1,\"status\":\"bundle\",\"format\":\"emoon-single-v1\","
    "\"compression\":\"%s\",\"bytes\":%llu,\"storedBytes\":%llu,\"rawBytes\":%llu,"
    "\"payloadSHA256\":\"%s\",\"hostSHA256\":\"%s\",\"app\":{\"name\":\"%s\","
    "\"version\":\"%s\",\"files\":%u},\"compatible\":false,"
    "\"claim\":\"not-a-compatibility-result\"}",
    bundle_get_u32(footer + 12) ? "zlib" : "raw",
    (unsigned long long)info.st_size,
    (unsigned long long)bundle_get_u64(footer + 24),
    (unsigned long long)bundle_get_u64(footer + 32),
    payload_hex, host_hex, escaped_name, escaped_version,
    bundle_get_u32(footer + 168));
  bundle_set_data(out, capacity, report);
  return (int32_t)strlen(report);
}
