#include "moonbit.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <sys/utsname.h>
#include <time.h>
#include <unistd.h>

#define EBT_MAX_SOURCE (16 * 1024 * 1024)

static char *copy_bytes(moonbit_bytes_t bytes) {
  if (bytes == NULL) return NULL;
  int32_t length = Moonbit_array_length(bytes);
  if (length < 0) return NULL;
  char *copy = (char *)malloc((size_t)length + 1);
  if (copy == NULL) return NULL;
  if (length > 0) memcpy(copy, bytes, (size_t)length);
  copy[length] = 0;
  if (strlen(copy) != (size_t)length) {
    free(copy);
    return NULL;
  }
  return copy;
}

static int copy_out(const char *text, moonbit_bytes_t out, int32_t capacity) {
  if (text == NULL || out == NULL || capacity <= 0 ||
      Moonbit_array_length(out) < capacity) return -1;
  size_t length = strlen(text);
  if (length + 1 > (size_t)capacity) return -1;
  memcpy(out, text, length);
  out[length] = 0;
  return (int32_t)length;
}

// Read a regular file beneath a canonical root. Symlink and `..` escapes are
// rejected after realpath; the caller's manifest has already bounded the path.
static char *read_regular(const char *root, const char *relative, size_t *size_out) {
  if (root == NULL || relative == NULL || relative[0] == 0) return NULL;
  if (relative[0] == '/' || strstr(relative, "..") != NULL) return NULL;
  char *canonical_root = realpath(root, NULL);
  if (canonical_root == NULL) return NULL;
  struct stat root_stat;
  if (stat(canonical_root, &root_stat) != 0 || !S_ISDIR(root_stat.st_mode)) {
    free(canonical_root);
    return NULL;
  }
  size_t joined_length = strlen(canonical_root) + strlen(relative) + 2;
  char *joined = (char *)malloc(joined_length);
  if (joined == NULL) {
    free(canonical_root);
    return NULL;
  }
  snprintf(joined, joined_length, "%s/%s", canonical_root, relative);
  char *canonical_file = realpath(joined, NULL);
  free(joined);
  if (canonical_file == NULL) {
    free(canonical_root);
    return NULL;
  }
  size_t root_length = strlen(canonical_root);
  if (strncmp(canonical_file, canonical_root, root_length) != 0 ||
      canonical_file[root_length] != '/') {
    free(canonical_file);
    free(canonical_root);
    return NULL;
  }
  struct stat file_stat;
  if (stat(canonical_file, &file_stat) != 0 || !S_ISREG(file_stat.st_mode) ||
      file_stat.st_size <= 0 || file_stat.st_size > EBT_MAX_SOURCE) {
    free(canonical_file);
    free(canonical_root);
    return NULL;
  }
  int fd = open(canonical_file, O_RDONLY);
  free(canonical_file);
  free(canonical_root);
  if (fd < 0) return NULL;
  size_t size = (size_t)file_stat.st_size;
  char *buffer = (char *)malloc(size + 1);
  if (buffer == NULL) {
    close(fd);
    return NULL;
  }
  size_t offset = 0;
  while (offset < size) {
    ssize_t got = read(fd, buffer + offset, size - offset);
    if (got <= 0) break;
    offset += (size_t)got;
  }
  close(fd);
  if (offset != size) {
    free(buffer);
    return NULL;
  }
  buffer[size] = 0;
  *size_out = size;
  return buffer;
}

int32_t moonbit_ebt_nodeless_read_file(
    moonbit_bytes_t root_bytes,
    moonbit_bytes_t relative_bytes,
    moonbit_bytes_t out,
    int32_t capacity) {
  if (out == NULL || capacity <= 0 || Moonbit_array_length(out) < capacity) return -1;
  char *root = copy_bytes(root_bytes);
  char *relative = copy_bytes(relative_bytes);
  if (root == NULL || relative == NULL) {
    free(root); free(relative);
    return -1;
  }
  size_t size = 0;
  char *buffer = read_regular(root, relative, &size);
  free(root); free(relative);
  if (buffer == NULL) return -1;
  if (size + 1 > (size_t)capacity) {
    free(buffer);
    return -2;
  }
  memcpy(out, buffer, size);
  out[size] = 0;
  free(buffer);
  return (int32_t)size;
}

// ---- SHA-256 (portable, no external dependency) ----
static const uint32_t sha256_k[64] = {
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

static uint32_t rotr32(uint32_t value, uint32_t count) {
  return (value >> count) | (value << (32 - count));
}

static void sha256_block(uint32_t state[8], const unsigned char block[64]) {
  uint32_t w[64];
  for (int i = 0; i < 16; i++) {
    w[i] = ((uint32_t)block[i * 4] << 24) |
           ((uint32_t)block[i * 4 + 1] << 16) |
           ((uint32_t)block[i * 4 + 2] << 8) |
           (uint32_t)block[i * 4 + 3];
  }
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = state[0], b = state[1], c = state[2], d = state[3];
  uint32_t e = state[4], f = state[5], g = state[6], h = state[7];
  for (int i = 0; i < 64; i++) {
    uint32_t s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
    uint32_t ch = (e & f) ^ ((~e) & g);
    uint32_t temp1 = h + s1 + ch + sha256_k[i] + w[i];
    uint32_t s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
    uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    uint32_t temp2 = s0 + maj;
    h = g; g = f; f = e; e = d + temp1;
    d = c; c = b; b = a; a = temp1 + temp2;
  }
  state[0] += a; state[1] += b; state[2] += c; state[3] += d;
  state[4] += e; state[5] += f; state[6] += g; state[7] += h;
}

static void sha256_bytes(const unsigned char *data, size_t length, unsigned char out[32]) {
  uint32_t state[8] = {
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  };
  size_t offset = 0;
  while (offset + 64 <= length) {
    sha256_block(state, data + offset);
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
  for (size_t i = 0; i < total; i += 64) sha256_block(state, tail + i);
  for (int i = 0; i < 8; i++) {
    out[i * 4] = (unsigned char)(state[i] >> 24);
    out[i * 4 + 1] = (unsigned char)(state[i] >> 16);
    out[i * 4 + 2] = (unsigned char)(state[i] >> 8);
    out[i * 4 + 3] = (unsigned char)state[i];
  }
}

int32_t moonbit_ebt_nodeless_sha256(
    moonbit_bytes_t root_bytes,
    moonbit_bytes_t relative_bytes,
    moonbit_bytes_t out) {
  if (out == NULL || Moonbit_array_length(out) < 32) return -1;
  char *root = copy_bytes(root_bytes);
  char *relative = copy_bytes(relative_bytes);
  if (root == NULL || relative == NULL) {
    free(root); free(relative);
    return -1;
  }
  size_t size = 0;
  char *buffer = read_regular(root, relative, &size);
  free(root); free(relative);
  if (buffer == NULL) return -1;
  unsigned char digest[32];
  sha256_bytes((const unsigned char *)buffer, size, digest);
  free(buffer);
  memcpy(out, digest, 32);
  return 32;
}

int64_t moonbit_ebt_nodeless_monotonic_ms(void) {
  struct timespec ts;
  if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return 0;
  return (int64_t)ts.tv_sec * 1000 + (int64_t)(ts.tv_nsec / 1000000);
}

int32_t moonbit_ebt_nodeless_realpath(
    moonbit_bytes_t path_bytes,
    moonbit_bytes_t out,
    int32_t capacity) {
  char *path = copy_bytes(path_bytes);
  if (path == NULL) return -1;
  char *resolved = realpath(path, NULL);
  free(path);
  if (resolved == NULL) return -1;
  int32_t result = copy_out(resolved, out, capacity);
  free(resolved);
  return result;
}

int32_t moonbit_ebt_nodeless_platform(moonbit_bytes_t out, int32_t capacity) {
  struct utsname info;
  if (uname(&info) != 0) return -1;
  const char *value = info.sysname;
  if (strcmp(info.sysname, "Darwin") == 0) value = "darwin";
  else if (strcmp(info.sysname, "Linux") == 0) value = "linux";
  return copy_out(value, out, capacity);
}

int32_t moonbit_ebt_nodeless_arch(moonbit_bytes_t out, int32_t capacity) {
  struct utsname info;
  if (uname(&info) != 0) return -1;
  const char *value = info.machine;
  if (strcmp(info.machine, "aarch64") == 0 || strcmp(info.machine, "arm64") == 0) {
    value = "arm64";
  } else if (strcmp(info.machine, "x86_64") == 0) {
    value = "x64";
  }
  return copy_out(value, out, capacity);
}

int32_t moonbit_ebt_nodeless_env(
    moonbit_bytes_t name_bytes,
    moonbit_bytes_t out,
    int32_t capacity) {
  char *name = copy_bytes(name_bytes);
  if (name == NULL) return -1;
  const char *value = getenv(name);
  free(name);
  if (value == NULL) return -1;
  return copy_out(value, out, capacity);
}

void moonbit_ebt_nodeless_exit(int32_t code) {
  exit((int)code);
}

// ---- bounded CLI migration filesystem ----
//
// The developer CLI works on a disposable `.emoon/app` stage under the app
// root. Every entry point takes a canonical app root and an app-relative path;
// absolute paths, `..`, symlink escapes and non-regular resources are rejected.
// These helpers are not a general filesystem API and do not claim an atomic
// snapshot against an adversarial filesystem.

static char *emoon_canonical_root(const char *root) {
  if (root == NULL) return NULL;
  char *canonical = realpath(root, NULL);
  if (canonical == NULL) return NULL;
  struct stat info;
  if (stat(canonical, &info) != 0 || !S_ISDIR(info.st_mode)) {
    free(canonical);
    return NULL;
  }
  return canonical;
}

static int emoon_valid_relative(const char *relative) {
  if (relative == NULL || relative[0] == 0 || relative[0] == '/') return 0;
  if (strstr(relative, "..") != NULL) return 0;
  return 1;
}

static char *emoon_join(const char *root, const char *relative) {
  size_t length = strlen(root) + strlen(relative) + 2;
  char *joined = (char *)malloc(length);
  if (joined == NULL) return NULL;
  snprintf(joined, length, "%s/%s", root, relative);
  return joined;
}

static int emoon_inside_root(const char *root, const char *path) {
  size_t length = strlen(root);
  if (strncmp(path, root, length) != 0) return 0;
  return path[length] == '/' || path[length] == 0;
}

// Canonicalize an existing regular file and reject symlink escapes.
static char *emoon_existing_file(const char *canonical_root, const char *relative) {
  if (!emoon_valid_relative(relative)) return NULL;
  char *joined = emoon_join(canonical_root, relative);
  if (joined == NULL) return NULL;
  struct stat link_info;
  if (lstat(joined, &link_info) != 0 || S_ISLNK(link_info.st_mode)) {
    free(joined);
    return NULL;
  }
  char *resolved = realpath(joined, NULL);
  free(joined);
  if (resolved == NULL || !emoon_inside_root(canonical_root, resolved)) {
    free(resolved);
    return NULL;
  }
  struct stat info;
  if (stat(resolved, &info) != 0 || !S_ISREG(info.st_mode)) {
    free(resolved);
    return NULL;
  }
  return resolved;
}

// Resolve the parent directory of a destination and return the final base name.
// The parent must exist, be a directory and stay inside the root. The final
// component may not exist yet; existing symlink components are checked by
// realpath above the final base.
static char *emoon_destination_parent(
    const char *canonical_root,
    const char *relative,
    char **base_out) {
  if (!emoon_valid_relative(relative) || base_out == NULL) return NULL;
  char *copy = strdup(relative);
  if (copy == NULL) return NULL;
  char *slash = strrchr(copy, '/');
  const char *parent_relative = ".";
  char *base = copy;
  if (slash != NULL) {
    *slash = 0;
    parent_relative = copy;
    base = slash + 1;
  }
  if (base[0] == 0 || strcmp(base, ".") == 0 || strcmp(base, "..") == 0) {
    free(copy);
    return NULL;
  }
  char *joined = emoon_join(canonical_root, parent_relative);
  if (joined == NULL) {
    free(copy);
    return NULL;
  }
  char *parent = realpath(joined, NULL);
  free(joined);
  if (parent == NULL || !emoon_inside_root(canonical_root, parent)) {
    free(parent);
    free(copy);
    return NULL;
  }
  struct stat info;
  if (stat(parent, &info) != 0 || !S_ISDIR(info.st_mode)) {
    free(parent);
    free(copy);
    return NULL;
  }
  *base_out = strdup(base);
  free(copy);
  if (*base_out == NULL) {
    free(parent);
    return NULL;
  }
  return parent;
}

static int emoon_write_all(int fd, const char *data, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t written = write(fd, data + offset, length - offset);
    if (written < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    if (written == 0) return -1;
    offset += (size_t)written;
  }
  return 0;
}

int32_t moonbit_emoon_fs_kind(moonbit_bytes_t root_bytes,
                              moonbit_bytes_t relative_bytes) {
  char *root = copy_bytes(root_bytes);
  char *relative = copy_bytes(relative_bytes);
  if (root == NULL || relative == NULL) {
    free(root);
    free(relative);
    return -1;
  }
  char *canonical_root = emoon_canonical_root(root);
  free(root);
  if (canonical_root == NULL) {
    free(relative);
    return -1;
  }
  if (relative[0] == 0) {
    free(relative);
    free(canonical_root);
    return 2;
  }
  if (!emoon_valid_relative(relative)) {
    free(relative);
    free(canonical_root);
    return -2;
  }
  char *joined = emoon_join(canonical_root, relative);
  free(relative);
  if (joined == NULL) {
    free(canonical_root);
    return -1;
  }
  int32_t result = -1;
  struct stat link_info;
  if (lstat(joined, &link_info) != 0) {
    result = (errno == ENOENT || errno == ENOTDIR) ? 0 : -1;
  } else if (S_ISLNK(link_info.st_mode)) {
    result = 3;
  } else {
    char *resolved = realpath(joined, NULL);
    if (resolved == NULL) {
      result = -1;
    } else if (!emoon_inside_root(canonical_root, resolved)) {
      result = -2;
    } else if (S_ISREG(link_info.st_mode)) {
      result = 1;
    } else if (S_ISDIR(link_info.st_mode)) {
      result = 2;
    } else {
      result = 4;
    }
    free(resolved);
  }
  free(joined);
  free(canonical_root);
  return result;
}

int32_t moonbit_emoon_fs_size(moonbit_bytes_t root_bytes,
                              moonbit_bytes_t relative_bytes) {
  char *root = copy_bytes(root_bytes);
  char *relative = copy_bytes(relative_bytes);
  if (root == NULL || relative == NULL) {
    free(root);
    free(relative);
    return -1;
  }
  char *canonical_root = emoon_canonical_root(root);
  free(root);
  if (canonical_root == NULL) {
    free(relative);
    return -1;
  }
  char *resolved = emoon_existing_file(canonical_root, relative);
  free(relative);
  free(canonical_root);
  if (resolved == NULL) return -1;
  struct stat info;
  int32_t result = -1;
  if (stat(resolved, &info) == 0 && info.st_size >= 0 &&
      info.st_size <= INT32_MAX) {
    result = (int32_t)info.st_size;
  }
  free(resolved);
  return result;
}

static int32_t emoon_count_directory(const char *canonical_root,
                                     const char *relative) {
  char *resolved = NULL;
  if (relative[0] == 0) {
    resolved = strdup(canonical_root);
  } else {
    if (!emoon_valid_relative(relative)) return -2;
    char *joined = emoon_join(canonical_root, relative);
    if (joined == NULL) return -1;
    struct stat link_info;
    if (lstat(joined, &link_info) != 0 || S_ISLNK(link_info.st_mode)) {
      free(joined);
      return -1;
    }
    resolved = realpath(joined, NULL);
    free(joined);
    if (resolved == NULL || !emoon_inside_root(canonical_root, resolved)) {
      free(resolved);
      return -2;
    }
  }
  if (resolved == NULL) return -1;
  DIR *directory = opendir(resolved);
  free(resolved);
  if (directory == NULL) return -1;
  int32_t count = 0;
  struct dirent *entry;
  while ((entry = readdir(directory)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
      continue;
    }
    count++;
  }
  closedir(directory);
  return count;
}

int32_t moonbit_emoon_fs_dir_count(moonbit_bytes_t root_bytes,
                                   moonbit_bytes_t relative_bytes) {
  char *root = copy_bytes(root_bytes);
  char *relative = copy_bytes(relative_bytes);
  if (root == NULL || relative == NULL) {
    free(root);
    free(relative);
    return -1;
  }
  char *canonical_root = emoon_canonical_root(root);
  free(root);
  if (canonical_root == NULL) {
    free(relative);
    return -1;
  }
  int32_t result = emoon_count_directory(canonical_root, relative);
  free(relative);
  free(canonical_root);
  return result;
}

int32_t moonbit_emoon_fs_dir_name(moonbit_bytes_t root_bytes,
                                  moonbit_bytes_t relative_bytes,
                                  int32_t index,
                                  moonbit_bytes_t out,
                                  int32_t capacity) {
  if (out == NULL || capacity <= 1 || Moonbit_array_length(out) < capacity) {
    return -1;
  }
  char *root = copy_bytes(root_bytes);
  char *relative = copy_bytes(relative_bytes);
  if (root == NULL || relative == NULL) {
    free(root);
    free(relative);
    return -1;
  }
  char *canonical_root = emoon_canonical_root(root);
  free(root);
  if (canonical_root == NULL) {
    free(relative);
    return -1;
  }
  char *resolved = NULL;
  if (relative[0] == 0) {
    resolved = strdup(canonical_root);
  } else {
    if (!emoon_valid_relative(relative)) {
      free(relative);
      free(canonical_root);
      return -2;
    }
    char *joined = emoon_join(canonical_root, relative);
    if (joined == NULL) {
      free(relative);
      free(canonical_root);
      return -1;
    }
    struct stat link_info;
    if (lstat(joined, &link_info) != 0 || S_ISLNK(link_info.st_mode)) {
      free(joined);
      free(relative);
      free(canonical_root);
      return -1;
    }
    resolved = realpath(joined, NULL);
    free(joined);
    if (resolved == NULL || !emoon_inside_root(canonical_root, resolved)) {
      free(resolved);
      free(relative);
      free(canonical_root);
      return -2;
    }
  }
  free(relative);
  free(canonical_root);
  if (resolved == NULL) return -1;
  DIR *directory = opendir(resolved);
  free(resolved);
  if (directory == NULL) return -1;
  int32_t seen = 0;
  int32_t result = -1;
  struct dirent *entry;
  while ((entry = readdir(directory)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
      continue;
    }
    if (seen == index) {
      size_t length = strlen(entry->d_name);
      if (length + 1 > (size_t)capacity) {
        result = -6;
      } else {
        memcpy(out, entry->d_name, length);
        out[length] = 0;
        result = (int32_t)length;
      }
      break;
    }
    seen++;
  }
  closedir(directory);
  return result;
}

int32_t moonbit_emoon_fs_mkdir_p(moonbit_bytes_t root_bytes,
                                 moonbit_bytes_t relative_bytes) {
  char *root = copy_bytes(root_bytes);
  char *relative = copy_bytes(relative_bytes);
  if (root == NULL || relative == NULL) {
    free(root);
    free(relative);
    return -1;
  }
  char *canonical_root = emoon_canonical_root(root);
  free(root);
  if (canonical_root == NULL) {
    free(relative);
    return -1;
  }
  if (relative[0] == 0) {
    free(relative);
    free(canonical_root);
    return 0;
  }
  if (!emoon_valid_relative(relative)) {
    free(relative);
    free(canonical_root);
    return -2;
  }
  size_t capacity = strlen(canonical_root) + strlen(relative) + 2;
  char *current = (char *)malloc(capacity);
  if (current == NULL) {
    free(relative);
    free(canonical_root);
    return -1;
  }
  snprintf(current, capacity, "%s", canonical_root);
  free(canonical_root);
  char *cursor = relative;
  int32_t result = 0;
  while (*cursor != 0 && result == 0) {
    while (*cursor == '/') cursor++;
    if (*cursor == 0) break;
    char *end = strchr(cursor, '/');
    size_t part_length = end == NULL ? strlen(cursor) : (size_t)(end - cursor);
    if (part_length == 0 ||
        (part_length == 1 && cursor[0] == '.') ||
        (part_length == 2 && cursor[0] == '.' && cursor[1] == '.')) {
      result = -2;
      break;
    }
    size_t current_length = strlen(current);
    char *grown = (char *)realloc(current, current_length + part_length + 2);
    if (grown == NULL) {
      result = -1;
      break;
    }
    current = grown;
    current[current_length] = '/';
    memcpy(current + current_length + 1, cursor, part_length);
    current[current_length + part_length + 1] = 0;
    struct stat info;
    if (lstat(current, &info) == 0) {
      if (S_ISLNK(info.st_mode)) {
        result = -3;
      } else if (!S_ISDIR(info.st_mode)) {
        result = -5;
      }
    } else if (errno == ENOENT) {
      if (mkdir(current, 0777) != 0 && errno != EEXIST) result = -1;
    } else {
      result = -1;
    }
    cursor += part_length;
    if (*cursor == '/') cursor++;
  }
  free(current);
  free(relative);
  return result;
}

int32_t moonbit_emoon_fs_write_atomic(moonbit_bytes_t root_bytes,
                                      moonbit_bytes_t relative_bytes,
                                      moonbit_bytes_t data,
                                      int32_t length) {
  if (data == NULL || length < 0 || length > EBT_MAX_SOURCE ||
      Moonbit_array_length(data) < length) {
    return -6;
  }
  char *root = copy_bytes(root_bytes);
  char *relative = copy_bytes(relative_bytes);
  if (root == NULL || relative == NULL) {
    free(root);
    free(relative);
    return -1;
  }
  char *canonical_root = emoon_canonical_root(root);
  free(root);
  if (canonical_root == NULL) {
    free(relative);
    return -1;
  }
  char *base = NULL;
  char *parent = emoon_destination_parent(canonical_root, relative, &base);
  free(relative);
  free(canonical_root);
  if (parent == NULL) return -2;
  size_t target_length = strlen(parent) + strlen(base) + 2;
  char *target = (char *)malloc(target_length);
  size_t temporary_length = target_length + 64;
  char *temporary = (char *)malloc(temporary_length);
  int32_t result = 0;
  if (target == NULL || temporary == NULL) {
    result = -1;
  } else {
    snprintf(target, target_length, "%s/%s", parent, base);
    snprintf(temporary, temporary_length, "%s.%ld.tmp", target, (long)getpid());
    int fd = open(temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0666);
    if (fd < 0) {
      result = -1;
    } else {
      if (emoon_write_all(fd, (const char *)data, (size_t)length) != 0) {
        result = -1;
      }
      if (close(fd) != 0) result = -1;
      if (result == 0 && rename(temporary, target) != 0) result = -1;
      if (result != 0) unlink(temporary);
    }
  }
  free(temporary);
  free(target);
  free(parent);
  free(base);
  return result;
}

int32_t moonbit_emoon_fs_copy(moonbit_bytes_t root_bytes,
                              moonbit_bytes_t source_bytes,
                              moonbit_bytes_t destination_bytes) {
  char *root = copy_bytes(root_bytes);
  char *source_relative = copy_bytes(source_bytes);
  char *destination_relative = copy_bytes(destination_bytes);
  if (root == NULL || source_relative == NULL || destination_relative == NULL) {
    free(root);
    free(source_relative);
    free(destination_relative);
    return -1;
  }
  char *canonical_root = emoon_canonical_root(root);
  free(root);
  if (canonical_root == NULL) {
    free(source_relative);
    free(destination_relative);
    return -1;
  }
  char *source = emoon_existing_file(canonical_root, source_relative);
  free(source_relative);
  if (source == NULL) {
    free(destination_relative);
    free(canonical_root);
    return -5;
  }
  struct stat source_info;
  if (stat(source, &source_info) != 0 || source_info.st_size <= 0 ||
      source_info.st_size > EBT_MAX_SOURCE) {
    free(source);
    free(destination_relative);
    free(canonical_root);
    return -6;
  }
  char *base = NULL;
  char *parent = emoon_destination_parent(canonical_root, destination_relative, &base);
  free(destination_relative);
  free(canonical_root);
  if (parent == NULL) {
    free(source);
    return -2;
  }
  size_t target_length = strlen(parent) + strlen(base) + 2;
  size_t temporary_length = target_length + 64;
  char *target = (char *)malloc(target_length);
  char *temporary = (char *)malloc(temporary_length);
  int32_t result = 0;
  if (target == NULL || temporary == NULL) {
    result = -1;
  } else {
    snprintf(target, target_length, "%s/%s", parent, base);
    snprintf(temporary, temporary_length, "%s.%ld.tmp", target, (long)getpid());
    int input = open(source, O_RDONLY | O_NOFOLLOW);
    if (input < 0) {
      result = -1;
    } else {
      mode_t mode = source_info.st_mode & 0777;
      int output = open(temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,
                        mode);
      if (output < 0) {
        result = -1;
        close(input);
      } else {
        char buffer[65536];
        for (;;) {
          ssize_t got = read(input, buffer, sizeof(buffer));
          if (got < 0) {
            if (errno == EINTR) continue;
            result = -1;
            break;
          }
          if (got == 0) break;
          if (emoon_write_all(output, buffer, (size_t)got) != 0) {
            result = -1;
            break;
          }
        }
        if (fchmod(output, mode) != 0) result = -1;
        if (close(output) != 0) result = -1;
        close(input);
        if (result == 0 && rename(temporary, target) != 0) result = -1;
        if (result != 0) unlink(temporary);
      }
    }
  }
  free(temporary);
  free(target);
  free(parent);
  free(base);
  free(source);
  return result;
}

static int emoon_remove_recursive(const char *path) {
  struct stat info;
  if (lstat(path, &info) != 0) {
    return errno == ENOENT ? 0 : -1;
  }
  if (!S_ISDIR(info.st_mode)) {
    return unlink(path) == 0 ? 0 : -1;
  }
  DIR *directory = opendir(path);
  if (directory == NULL) return -1;
  int result = 0;
  struct dirent *entry;
  while ((entry = readdir(directory)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
      continue;
    }
    size_t length = strlen(path) + strlen(entry->d_name) + 2;
    char *child = (char *)malloc(length);
    if (child == NULL) {
      result = -1;
      break;
    }
    snprintf(child, length, "%s/%s", path, entry->d_name);
    result = emoon_remove_recursive(child);
    free(child);
    if (result != 0) break;
  }
  closedir(directory);
  if (result != 0) return result;
  return rmdir(path) == 0 ? 0 : -1;
}

int32_t moonbit_emoon_fs_remove_tree(moonbit_bytes_t root_bytes,
                                     moonbit_bytes_t relative_bytes) {
  char *root = copy_bytes(root_bytes);
  char *relative = copy_bytes(relative_bytes);
  if (root == NULL || relative == NULL) {
    free(root);
    free(relative);
    return -1;
  }
  char *canonical_root = emoon_canonical_root(root);
  free(root);
  if (canonical_root == NULL) {
    free(relative);
    return -1;
  }
  if (relative[0] == 0 || strcmp(relative, ".") == 0) {
    free(relative);
    free(canonical_root);
    return -2;
  }
  char *base = NULL;
  char *parent = emoon_destination_parent(canonical_root, relative, &base);
  free(relative);
  free(canonical_root);
  if (parent == NULL) return -2;
  size_t target_length = strlen(parent) + strlen(base) + 2;
  char *target = (char *)malloc(target_length);
  int32_t result = 0;
  if (target == NULL) {
    result = -1;
  } else {
    snprintf(target, target_length, "%s/%s", parent, base);
    struct stat info;
    if (lstat(target, &info) != 0) {
      result = errno == ENOENT ? 0 : -1;
    } else if (S_ISLNK(info.st_mode)) {
      result = -3;
    } else if (!S_ISDIR(info.st_mode)) {
      result = -5;
    } else {
      result = emoon_remove_recursive(target);
    }
  }
  free(target);
  free(parent);
  free(base);
  return result;
}


// Run the app's own `npm run build` from a developer command. This is not part
// of the runtime: `emoon dev --build` is an explicit opt-in for source trees.
// The child gets stdin from /dev/null, stdout redirected to stderr so the CLI's
// JSON stdout stays parseable, a 20-minute alarm, and the app root as cwd.
int32_t moonbit_emoon_run_build(moonbit_bytes_t root_bytes) {
  char *root = copy_bytes(root_bytes);
  if (root == NULL) return -1;
  pid_t pid = fork();
  if (pid < 0) {
    free(root);
    return -1;
  }
  if (pid == 0) {
    if (chdir(root) != 0) _exit(127);
    int input = open("/dev/null", O_RDONLY);
    if (input >= 0) {
      if (dup2(input, STDIN_FILENO) < 0) _exit(127);
      if (input > STDIN_FILENO) close(input);
    }
    if (dup2(STDERR_FILENO, STDOUT_FILENO) < 0) _exit(127);
    alarm(1200);
    execlp("npm", "npm", "run", "build", (char *)NULL);
    _exit(127);
  }
  free(root);
  int status = 0;
  pid_t waited = -1;
  do {
    waited = waitpid(pid, &status, 0);
  } while (waited < 0 && errno == EINTR);
  if (waited < 0) return -1;
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  return -1;
}
