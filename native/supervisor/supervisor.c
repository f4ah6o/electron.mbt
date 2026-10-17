#include "moonbit.h"
#include "quickjs.h"
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
static char *supervisor_app_title = NULL;
static char *supervisor_app_entry = NULL;
static JSRuntime *app_runtime = NULL;
static JSContext *app_context = NULL;
static void release_app(void);

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

int32_t moonbit_ebt_supervisor_timeout_ms(void) {
  const char *value = getenv("ELECTRON_MBT_SUPERVISOR_TIMEOUT_MS");
  if (value != NULL) {
    char *end = NULL;
    long parsed = strtol(value, &end, 10);
    if (end != value && *end == '\0' && parsed >= 100 && parsed <= 60000) return (int32_t)parsed;
  }
  return 15000;
}

int32_t moonbit_ebt_supervisor_finish(void) {
  release_app();
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
  release_app();
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
  free(supervisor_app_title);
  supervisor_app_title = NULL;
  free(supervisor_app_entry);
  supervisor_app_entry = NULL;
}

static char *read_text_file(const char *path, size_t maximum, size_t *length_out) {
  if (path == NULL || maximum == 0) return NULL;
  FILE *file = fopen(path, "rb");
  if (file == NULL) return NULL;
  if (fseek(file, 0, SEEK_END) != 0) { fclose(file); return NULL; }
  long size = ftell(file);
  if (size <= 0 || (size_t)size > maximum || fseek(file, 0, SEEK_SET) != 0) {
    fclose(file); return NULL;
  }
  char *text = (char *)malloc((size_t)size + 1);
  if (text == NULL) { fclose(file); return NULL; }
  if (fread(text, 1, (size_t)size, file) != (size_t)size) {
    free(text); fclose(file); return NULL;
  }
  text[size] = '\0';
  fclose(file);
  if (length_out != NULL) *length_out = (size_t)size;
  return text;
}

static char *join_root(const char *relative) {
  if (supervisor_root == NULL || relative == NULL) return NULL;
  size_t root_length = strlen(supervisor_root);
  size_t relative_length = strlen(relative);
  char *path = (char *)malloc(root_length + relative_length + 2);
  if (path == NULL) return NULL;
  memcpy(path, supervisor_root, root_length);
  path[root_length] = '/';
  memcpy(path + root_length + 1, relative, relative_length + 1);
  return path;
}

static int valid_entry(const char *entry) {
  size_t length = strlen(entry);
  if (length == 0 || length > 256 || entry[0] == '/' || strstr(entry, "..") != NULL) return 0;
  for (size_t i = 0; i < length; i++) if (entry[i] == '\\') return 0;
  return 1;
}

static void release_app(void) {
  if (app_context != NULL) { JS_FreeContext(app_context); app_context = NULL; }
  if (app_runtime != NULL) { JS_FreeRuntime(app_runtime); app_runtime = NULL; }
}

int32_t moonbit_ebt_supervisor_app_main(void) {
  if (supervisor_root == NULL) return -1;
  release_app();
  char entry[257];
  snprintf(entry, sizeof(entry), "main.js");
  char *package_path = join_root("package.json");
  size_t package_length = 0;
  char *package_json = package_path == NULL ? NULL : read_text_file(package_path, 65536, &package_length);
  free(package_path);
  JSRuntime *runtime = JS_NewRuntime();
  if (runtime == NULL) { free(package_json); return -1; }
  JS_SetMemoryLimit(runtime, 32 * 1024 * 1024);
  JSContext *context = JS_NewContext(runtime);
  if (context == NULL) { free(package_json); JS_FreeRuntime(runtime); return -1; }
  if (package_json != NULL) {
    JSValue metadata = JS_ParseJSON(context, package_json, package_length, "package.json");
    if (!JS_IsException(metadata)) {
      JSValue main_value = JS_GetPropertyStr(context, metadata, "main");
      const char *main_text = JS_ToCString(context, main_value);
      if (main_text != NULL && valid_entry(main_text)) snprintf(entry, sizeof(entry), "%s", main_text);
      if (main_text != NULL) JS_FreeCString(context, main_text);
      JS_FreeValue(context, main_value);
    }
    JS_FreeValue(context, metadata);
  }
  free(package_json);
  if (!valid_entry(entry)) { JS_FreeContext(context); JS_FreeRuntime(runtime); return -1; }
  const char *fixture_files[] = {
    "src/main.js", "src/lib/index.js", "src/lib/greet.js", "src/lib/data.json",
    "node_modules/fixture-pkg/package.json", "node_modules/fixture-pkg/cjs.js",
    "node_modules/fixture-pkg/index.js",
  };
  JSValue sources = JS_NewObject(context);
  for (size_t i = 0; i < sizeof(fixture_files) / sizeof(fixture_files[0]); i++) {
    char *path = join_root(fixture_files[i]);
    size_t length = 0;
    char *text = path == NULL ? NULL : read_text_file(path, 65536, &length);
    free(path);
    if (text == NULL) { JS_FreeValue(context, sources); JS_FreeContext(context); JS_FreeRuntime(runtime); return -1; }
    JSValue source_value = JS_NewStringLen(context, text, length);
    free(text);
    if (JS_IsException(source_value)) { JS_FreeValue(context, sources); JS_FreeContext(context); JS_FreeRuntime(runtime); return -1; }
    JS_SetPropertyStr(context, sources, fixture_files[i], source_value);
  }
  char *entry_path = join_root(entry);
  size_t entry_length = 0;
  char *entry_source = entry_path == NULL ? NULL : read_text_file(entry_path, 65536, &entry_length);
  free(entry_path);
  if (entry_source == NULL) { JS_FreeValue(context, sources); JS_FreeContext(context); JS_FreeRuntime(runtime); return -1; }
  JS_SetPropertyStr(context, sources, entry, JS_NewStringLen(context, entry_source, entry_length));
  free(entry_source);
  const char *loader =
    "(function(){"
    "const electron={app:{name:'native-fixture',isPackaged:false}};"
    "const sources=globalThis.__nativeSources;"
    "const cache=Object.create(null);"
    "function normalize(from,spec){"
    "if(typeof spec!=='string'||!spec.startsWith('.')||spec.includes(String.fromCharCode(92)))throw new Error('bad require');"
    "const base=from.includes('/')?from.slice(0,from.lastIndexOf('/')):'';"
    "const parts=(base+'/'+spec).split('/');const out=[];"
    "for(const part of parts){if(!part||part==='.')continue;"
    "if(part==='..'){if(!out.length)throw new Error('require escape');out.pop();}else out.push(part);}"
    "return out.join('/');}"
    "function packageSpec(spec){"
    "if(spec.startsWith('@')){const parts=spec.split('/');if(parts.length<2)throw new Error('bad package');"
    "return {name:parts[0]+'/'+parts[1],subpath:parts.length===2?'.':'./'+parts.slice(2).join('/')};}"
    "const parts=spec.split('/');return {name:parts[0],subpath:parts.length===1?'.':'./'+parts.slice(1).join('/')};}"
    "function resolveBare(from,spec){"
    "const info=packageSpec(spec);"
    "let current=from.includes('/')?from.slice(0,from.lastIndexOf('/')):'';"
    "while(true){const pkgDir=(current?current+'/':'')+'node_modules/'+info.name;"
    "const metaId=pkgDir+'/package.json';"
    "if(sources[metaId]!==undefined){const meta=JSON.parse(sources[metaId]);let target=null;"
    "const exp=meta.exports;"
    "if(info.subpath==='.'&&typeof exp==='string')target=exp;"
    "else if(info.subpath==='.'&&exp&&typeof exp==='object'){"
    "const key=exp['.']!==undefined?exp['.']:exp;"
    "if(typeof key==='string')target=key;"
    "else if(key&&typeof key==='object')target=key.require!==undefined?key.require:(key.default!==undefined?key.default:null);}"
    "if(info.subpath==='.')target=target!==null?target:(meta.main!==undefined?meta.main:'index.js');"
    "if(target===null||!target.startsWith('./'))throw new Error('bad package target');"
    "return normalize(metaId,target);}"
    "if(!current)break;const cut=current.lastIndexOf('/');current=cut>=0?current.slice(0,cut):'';}"
    "throw new Error('package not found: '+spec);}"
    "function tryId(id){if(sources[id]!==undefined)return id;"
    "for(const ext of ['.js','.cjs','.json'])if(sources[id+ext]!==undefined)return id+ext;"
    "for(const index of ['/index.js','/index.cjs','/index.json'])if(sources[id+index]!==undefined)return id+index;"
    "return null;}"
    "function load(id,parent){if(id==='electron')return electron;"
    "let target;"
    "if((parent||'')===''&&sources[id]!==undefined)target=id;"
    "else if(id.startsWith('.'))target=normalize(parent||'',id);"
    "else target=resolveBare(parent||'',id);"
    "const resolved=tryId(target);"
    "if(resolved===null)throw new Error('module not found: '+id);"
    "if(cache[resolved])return cache[resolved].exports;"
    "const module={exports:{}};cache[resolved]=module;"
    "if(resolved.endsWith('.json')){module.exports=JSON.parse(sources[resolved]);return module.exports;}"
    "const fn=new Function('require','module','exports',sources[resolved]);"
    "fn(spec=>load(spec,resolved),module,module.exports);"
    "return module.exports;}"
    "globalThis.__nativeEntry=globalThis.__nativeMainId;"
    "const main=load(globalThis.__nativeMainId,'');"
    "if(!main||main.title!=='native-app-window')throw new Error('bad main exports');"
    "})();";
  JSValue global = JS_GetGlobalObject(context);
  JS_SetPropertyStr(context, global, "__nativeSources", sources);
  JS_SetPropertyStr(context, global, "__nativeMainId", JS_NewString(context, entry));
  JSValue value = JS_Eval(context, loader, strlen(loader), "native-app/loader.js", JS_EVAL_TYPE_GLOBAL);
  int32_t ok = 0;
  if (!JS_IsException(value)) {
    JSValue nativeMain = JS_GetPropertyStr(context, global, "__nativeMain");
    JSValue nativeTitle = JS_GetPropertyStr(context, global, "__nativeTitle");
    const char *main_text = JS_ToCString(context, nativeMain);
    const char *title_text = JS_ToCString(context, nativeTitle);
    if (main_text != NULL && title_text != NULL &&
        strcmp(main_text, "native-fixture") == 0 &&
        strcmp(title_text, "native-app-window") == 0) {
      free(supervisor_app_title);
      supervisor_app_title = strdup(title_text);
      free(supervisor_app_entry);
      supervisor_app_entry = strdup(entry);
      ok = 42;
    }
    if (main_text != NULL) JS_FreeCString(context, main_text);
    if (title_text != NULL) JS_FreeCString(context, title_text);
    JS_FreeValue(context, nativeTitle);
    JS_FreeValue(context, nativeMain);
  }
  JS_FreeValue(context, value);
  JS_FreeValue(context, global);
  if (ok == 42) {
    app_context = context;
    app_runtime = runtime;
  } else {
    JS_FreeContext(context);
    JS_FreeRuntime(runtime);
  }
  return ok;
}

int32_t moonbit_ebt_supervisor_app_dispatch(
    moonbit_bytes_t operation_bytes,
    moonbit_bytes_t payload_bytes,
    moonbit_bytes_t out,
    int32_t capacity) {
  if (app_context == NULL || app_runtime == NULL || out == NULL || capacity <= 0 ||
      Moonbit_array_length(out) < capacity) return -1;
  char *operation = copy_bytes(operation_bytes);
  char *payload = copy_bytes(payload_bytes);
  if (operation == NULL || payload == NULL) {
    free(operation); free(payload);
    return -1;
  }
  JSValue global = JS_GetGlobalObject(app_context);
  JSValue invoke = JS_GetPropertyStr(app_context, global, "__nativeInvoke");
  if (!JS_IsFunction(app_context, invoke)) {
    JS_FreeValue(app_context, invoke);
    JS_FreeValue(app_context, global);
    free(operation); free(payload);
    return -2;
  }
  JSValue args[2] = {
    JS_NewString(app_context, operation),
    JS_NewString(app_context, payload),
  };
  JSValue result = JS_Call(app_context, invoke, global, 2, args);
  JS_FreeValue(app_context, args[0]);
  JS_FreeValue(app_context, args[1]);
  JS_FreeValue(app_context, invoke);
  JS_FreeValue(app_context, global);
  free(operation); free(payload);
  if (JS_IsException(result)) {
    JS_FreeValue(app_context, result);
    const char *error = "{\"ok\":false,\"code\":\"ELECTRON_MBT_MAIN_ERROR\"}";
    size_t length = strlen(error);
    if (length + 1 > (size_t)capacity) return -3;
    memcpy(out, error, length + 1);
    return (int32_t)length;
  }
  const char *text = JS_ToCString(app_context, result);
  JS_FreeValue(app_context, result);
  if (text == NULL) return -3;
  size_t length = strlen(text);
  if (length + 1 > (size_t)capacity) {
    JS_FreeCString(app_context, text);
    return -3;
  }
  memcpy(out, text, length + 1);
  JS_FreeCString(app_context, text);
  return (int32_t)length;
}

void moonbit_ebt_supervisor_app_release(void) {
  release_app();
}

int32_t moonbit_ebt_supervisor_app_entry(moonbit_bytes_t buffer, int32_t capacity) {
  if (buffer == NULL || capacity <= 0 || supervisor_app_entry == NULL ||
      Moonbit_array_length(buffer) < capacity) return -1;
  size_t length = strlen(supervisor_app_entry);
  if (length + 1 > (size_t)capacity) return -1;
  memcpy(buffer, supervisor_app_entry, length);
  buffer[length] = 0;
  return (int32_t)length;
}

int32_t moonbit_ebt_supervisor_app_title(moonbit_bytes_t buffer, int32_t capacity) {
  if (buffer == NULL || capacity <= 0 || supervisor_app_title == NULL ||
      Moonbit_array_length(buffer) < capacity) return -1;
  size_t length = strlen(supervisor_app_title);
  if (length + 1 > (size_t)capacity) return -1;
  memcpy(buffer, supervisor_app_title, length);
  buffer[length] = 0;
  return (int32_t)length;
}

void moonbit_ebt_supervisor_sleep_ms(int32_t milliseconds) {
  if (milliseconds > 0 && milliseconds <= 5000) usleep((useconds_t)milliseconds * 1000);
}

void moonbit_ebt_supervisor_exit(int32_t code) {
  release_app();
  fflush(NULL);
  _exit((int)code);
}
