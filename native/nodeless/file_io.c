#include "moonbit.h"

#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
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
