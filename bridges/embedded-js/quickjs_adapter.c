#include "quickjs.h"
#include "moonbit.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

// A minimal, explicit-lifetime QuickJS adapter. C owns the engine/context/value
// handles; MoonBit owns the policy, request ledger and scheduling decisions.
// No JSValue is exposed to MoonBit and no engine callback is allowed to unwind
// through a MoonBit frame.

typedef struct {
  JSRuntime *rt;
  volatile int interrupted;
  int64_t memory_limit;
  int64_t deadline_ms;
} EmbEngine;

typedef struct {
  JSContext *ctx;
  EmbEngine *engine;
} EmbContext;

typedef struct {
  JSContext *ctx;
  JSValue value;
  int is_exception;
  int alive;
} EmbValue;

#define EMB_MAX_LIVE 4096
static EmbValue *emb_live[EMB_MAX_LIVE];
static int emb_live_count = 0;

// A small live-lease registry lets stale IDs fail closed without dereferencing
// freed memory. It is single-runner-thread state; the QuickJS API is not
// thread-safe and this adapter does not promise concurrent callers.
static int emb_register_value(EmbValue *value) {
  if (value == NULL || emb_live_count >= EMB_MAX_LIVE) return 0;
  emb_live[emb_live_count++] = value;
  return 1;
}

static int emb_value_live(EmbValue *value) {
  if (value == NULL) return 0;
  for (int i = 0; i < emb_live_count; i++) {
    if (emb_live[i] == value) return 1;
  }
  return 0;
}

static void emb_unregister_value(EmbValue *value) {
  for (int i = 0; i < emb_live_count; i++) {
    if (emb_live[i] == value) {
      emb_live[i] = emb_live[emb_live_count - 1];
      emb_live_count -= 1;
      return;
    }
  }
}

static int64_t emb_now_ms(void) {
  struct timespec ts;
  if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return 0;
  return (int64_t)ts.tv_sec * 1000 + (int64_t)(ts.tv_nsec / 1000000);
}

static char emb_last_rejection[1024];

static void emb_rejection_tracker(JSContext *ctx, JSValueConst promise,
                                  JSValueConst reason, JS_BOOL is_handled,
                                  void *opaque) {
  (void)promise; (void)opaque;
  if (is_handled) return;
  size_t length = 0;
  JSValue stack = JS_GetPropertyStr(ctx, reason, "stack");
  const char *text = NULL;
  if (!JS_IsUndefined(stack) && !JS_IsException(stack)) {
    text = JS_ToCStringLen(ctx, &length, stack);
  }
  if (text == NULL) text = JS_ToCStringLen(ctx, &length, reason);
  JS_FreeValue(ctx, stack);
  if (text == NULL) return;
  if (length >= sizeof(emb_last_rejection)) length = sizeof(emb_last_rejection) - 1;
  memcpy(emb_last_rejection, text, length);
  emb_last_rejection[length] = 0;
  JS_FreeCString(ctx, text);
}

MOONBIT_FFI_EXPORT
int32_t moonbit_emb_last_rejection(moonbit_bytes_t out, int32_t capacity) {
  if (out == NULL || capacity <= 0 || Moonbit_array_length(out) < capacity) return -1;
  size_t length = strlen(emb_last_rejection);
  if (length + 1 > (size_t)capacity) return -1;
  memcpy(out, emb_last_rejection, length);
  out[length] = 0;
  return (int32_t)length;
}

static int emb_interrupt_handler(JSRuntime *rt, void *opaque) {
  (void)rt;
  EmbEngine *engine = (EmbEngine *)opaque;
  if (engine == NULL) return 0;
  if (engine->interrupted) return 1;
  // A deadline is a bounded fallback for an unbounded script. It is checked
  // from the engine's own interrupt hook so no other thread calls QuickJS.
  return engine->deadline_ms > 0 && emb_now_ms() >= engine->deadline_ms;
}

static moonbit_bytes_t emb_bytes(const char *data, size_t len) {
  moonbit_bytes_t bytes = moonbit_make_bytes((int32_t)len, 0);
  if (len > 0 && data != NULL) {
    memcpy(bytes, data, len);
  }
  return bytes;
}

static moonbit_bytes_t emb_literal(const char *text) {
  return emb_bytes(text, strlen(text));
}

MOONBIT_FFI_EXPORT
void *moonbit_emb_engine_create_with_limit(int64_t memory_limit) {
  EmbEngine *engine = (EmbEngine *)calloc(1, sizeof(EmbEngine));
  if (engine == NULL) return NULL;
  engine->rt = JS_NewRuntime();
  if (engine->rt == NULL) {
    free(engine);
    return NULL;
  }
  // These are the initial profile limits from 0008 §7.4, not measured claims.
  engine->memory_limit = memory_limit > 0 ? memory_limit : (int64_t)128 * 1024 * 1024;
  JS_SetMemoryLimit(engine->rt, (size_t)engine->memory_limit);
  JS_SetMaxStackSize(engine->rt, (size_t)1 * 1024 * 1024);
  JS_SetInterruptHandler(engine->rt, emb_interrupt_handler, engine);
  JS_SetHostPromiseRejectionTracker(engine->rt, emb_rejection_tracker, engine);
  emb_last_rejection[0] = 0;
  return engine;
}

MOONBIT_FFI_EXPORT
void *moonbit_emb_engine_create(void) {
  return moonbit_emb_engine_create_with_limit((int64_t)128 * 1024 * 1024);
}

MOONBIT_FFI_EXPORT
void moonbit_emb_collect(void *raw_engine) {
  EmbEngine *engine = (EmbEngine *)raw_engine;
  if (engine != NULL && engine->rt != NULL) JS_RunGC(engine->rt);
}

MOONBIT_FFI_EXPORT
int64_t moonbit_emb_memory_used(void *raw_engine) {
  EmbEngine *engine = (EmbEngine *)raw_engine;
  if (engine == NULL || engine->rt == NULL) return -1;
  JSMemoryUsage usage;
  memset(&usage, 0, sizeof(usage));
  JS_ComputeMemoryUsage(engine->rt, &usage);
  return (int64_t)usage.malloc_size;
}

MOONBIT_FFI_EXPORT
void moonbit_emb_engine_destroy(void *raw) {
  EmbEngine *engine = (EmbEngine *)raw;
  if (engine == NULL) return;
  if (engine->rt != NULL) JS_FreeRuntime(engine->rt);
  free(engine);
}

MOONBIT_FFI_EXPORT
void moonbit_emb_interrupt(void *raw) {
  EmbEngine *engine = (EmbEngine *)raw;
  if (engine != NULL) engine->interrupted = 1;
}

MOONBIT_FFI_EXPORT
void moonbit_emb_clear_interrupt(void *raw) {
  EmbEngine *engine = (EmbEngine *)raw;
  if (engine != NULL) engine->interrupted = 0;
}

MOONBIT_FFI_EXPORT
void moonbit_emb_set_deadline(void *raw, int64_t deadline_ms) {
  EmbEngine *engine = (EmbEngine *)raw;
  if (engine != NULL) engine->deadline_ms = deadline_ms;
}

// A synchronous host bridge is a leaf transport only. MoonBit decides which
// operations are admissible; the C callback performs one bounded frame
// exchange and never re-enters JavaScript.
typedef int32_t (*EmbHostRequestFn)(const char *operation, const char *payload,
                                    char *out, int32_t capacity);
static EmbHostRequestFn emb_host_request_fn = NULL;

MOONBIT_FFI_EXPORT
void moonbit_emb_register_host_request(void *fn) {
  emb_host_request_fn = (EmbHostRequestFn)fn;
}

static JSValue emb_js_host_request(JSContext *ctx, JSValueConst this_val,
                                   int argc, JSValueConst *argv) {
  (void)this_val;
  if (emb_host_request_fn == NULL || argc < 2) {
    return JS_ThrowTypeError(ctx, "host bridge unavailable");
  }
  const char *operation = JS_ToCString(ctx, argv[0]);
  if (operation == NULL) return JS_EXCEPTION;
  const char *payload = JS_ToCString(ctx, argv[1]);
  if (payload == NULL) {
    JS_FreeCString(ctx, operation);
    return JS_EXCEPTION;
  }
  char output[65536];
  int32_t length = emb_host_request_fn(operation, payload, output, (int32_t)sizeof(output));
  JS_FreeCString(ctx, operation);
  JS_FreeCString(ctx, payload);
  if (length < 0 || length >= (int32_t)sizeof(output)) {
    return JS_ThrowTypeError(ctx, "host request failed");
  }
  return JS_NewStringLen(ctx, output, (size_t)length);
}

MOONBIT_FFI_EXPORT
int32_t moonbit_emb_install_host_bridge(void *raw_context) {
  EmbContext *context = (EmbContext *)raw_context;
  if (context == NULL || context->ctx == NULL) return 0;
  JSValue global = JS_GetGlobalObject(context->ctx);
  JSValue function = JS_NewCFunction(context->ctx, emb_js_host_request,
                                     "__mbt_host_request", 2);
  if (JS_IsException(function)) {
    JS_FreeValue(context->ctx, function);
    JS_FreeValue(context->ctx, global);
    return 0;
  }
  JS_SetPropertyStr(context->ctx, global, "__mbt_host_request", function);
  JS_FreeValue(context->ctx, global);
  return 1;
}

MOONBIT_FFI_EXPORT
void moonbit_emb_clear_deadline(void *raw) {
  EmbEngine *engine = (EmbEngine *)raw;
  if (engine != NULL) engine->deadline_ms = 0;
}

MOONBIT_FFI_EXPORT
int64_t moonbit_emb_now_ms(void) {
  return emb_now_ms();
}

MOONBIT_FFI_EXPORT
void *moonbit_emb_context_create(void *raw_engine) {
  EmbEngine *engine = (EmbEngine *)raw_engine;
  if (engine == NULL || engine->rt == NULL) return NULL;
  EmbContext *context = (EmbContext *)calloc(1, sizeof(EmbContext));
  if (context == NULL) return NULL;
  context->ctx = JS_NewContext(engine->rt);
  if (context->ctx == NULL) {
    free(context);
    return NULL;
  }
  context->engine = engine;
  return context;
}

MOONBIT_FFI_EXPORT
void moonbit_emb_context_destroy(void *raw) {
  EmbContext *context = (EmbContext *)raw;
  if (context == NULL) return;
  if (context->ctx != NULL) JS_FreeContext(context->ctx);
  free(context);
}

// Evaluate global script text. A non-NULL lease always owns one JSValue,
// either the result or the pending exception. The caller must release it.
MOONBIT_FFI_EXPORT
void *moonbit_emb_eval(void *raw_context, moonbit_bytes_t source, moonbit_bytes_t filename) {
  EmbContext *context = (EmbContext *)raw_context;
  if (context == NULL || context->ctx == NULL || source == NULL) return NULL;
  const char *source_text = (const char *)source;
  int32_t source_len = Moonbit_array_length(source);
  if (source_len < 0) return NULL;
  const char *filename_text = filename == NULL ? "<eval>" : (const char *)filename;
  EmbValue *result = (EmbValue *)calloc(1, sizeof(EmbValue));
  if (result == NULL) return NULL;
  result->ctx = context->ctx;
  result->alive = 1;
  if (context->ctx == NULL) {
    result->is_exception = 1;
    result->value = JS_UNDEFINED;
  } else {
    JSValue value = JS_Eval(context->ctx, source_text, (size_t)source_len, filename_text, JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(value)) {
      result->is_exception = 1;
      result->value = JS_GetException(context->ctx);
    } else {
      result->value = value;
    }
  }
  if (!emb_register_value(result)) {
    if (result->ctx != NULL) JS_FreeValue(result->ctx, result->value);
    free(result);
    return NULL;
  }
  return result;
}

MOONBIT_FFI_EXPORT
int32_t moonbit_emb_value_kind(void *raw) {
  EmbValue *value = (EmbValue *)raw;
  if (value == NULL || !emb_value_live(value) || !value->alive) return -1;
  return value->is_exception ? 1 : 0;
}

// Return a bounded UTF-8 JSON/text representation. The lease's JSValue is not
// consumed; the caller releases it separately.
static moonbit_bytes_t emb_value_text_impl(void *raw, size_t max_bytes) {
  EmbValue *value = (EmbValue *)raw;
  if (value == NULL || !emb_value_live(value) || !value->alive) return emb_literal("released value handle");
  JSContext *ctx = value->ctx;
  if (ctx == NULL) return emb_literal("evaluation failed: no context");
  JSValue printable = JS_UNDEFINED;
  int owns_printable = 0;
  int owns_text = 0;
  const char *text = NULL;
  size_t length = 0;
  if (value->is_exception) {
    text = JS_ToCStringLen(ctx, &length, value->value);
    owns_text = text != NULL;
  } else {
    printable = JS_JSONStringify(ctx, value->value, JS_UNDEFINED, JS_UNDEFINED);
    if (JS_IsException(printable)) {
      JSValue exception = JS_GetException(ctx);
      JS_FreeValue(ctx, printable);
      text = JS_ToCStringLen(ctx, &length, exception);
      owns_text = text != NULL;
      JS_FreeValue(ctx, exception);
    } else if (JS_IsUndefined(printable)) {
      text = "undefined";
      length = 9;
    } else {
      owns_printable = 1;
      text = JS_ToCStringLen(ctx, &length, printable);
      owns_text = text != NULL;
    }
  }
  moonbit_bytes_t bytes;
  if (text == NULL) {
    bytes = emb_literal("unprintable value");
  } else {
    if (max_bytes > 0 && length > max_bytes) {
      bytes = emb_literal("ELECTRON_MBT_OUTPUT_LIMIT");
    } else {
      bytes = emb_bytes(text, length);
    }
    if (owns_text) JS_FreeCString(ctx, text);
  }
  if (owns_printable) JS_FreeValue(ctx, printable);
  return bytes;
}

MOONBIT_FFI_EXPORT
moonbit_bytes_t moonbit_emb_value_text(void *raw) {
  return emb_value_text_impl(raw, 1048576);
}

MOONBIT_FFI_EXPORT
moonbit_bytes_t moonbit_emb_value_text_limit(void *raw, int32_t max_bytes) {
  if (max_bytes < 0) return emb_literal("ELECTRON_MBT_OUTPUT_LIMIT");
  return emb_value_text_impl(raw, (size_t)max_bytes);
}

static void *emb_wrap_result(JSContext *ctx, JSValue value, int is_exception) {
  EmbValue *result = (EmbValue *)calloc(1, sizeof(EmbValue));
  if (result == NULL) {
    JS_FreeValue(ctx, value);
    return NULL;
  }
  result->ctx = ctx;
  result->value = value;
  result->is_exception = is_exception;
  result->alive = 1;
  if (!emb_register_value(result)) {
    JS_FreeValue(ctx, value);
    free(result);
    return NULL;
  }
  return result;
}

MOONBIT_FFI_EXPORT
void *moonbit_emb_get_global(void *raw_context, moonbit_bytes_t name) {
  EmbContext *context = (EmbContext *)raw_context;
  if (context == NULL || context->ctx == NULL || name == NULL) return NULL;
  int32_t name_length = Moonbit_array_length(name);
  if (name_length < 0 || name_length > 256) return NULL;
  char *copy = (char *)malloc((size_t)name_length + 1);
  if (copy == NULL) return NULL;
  memcpy(copy, name, (size_t)name_length);
  copy[name_length] = 0;
  if (strlen(copy) != (size_t)name_length) {
    free(copy);
    return NULL;
  }
  JSContext *ctx = context->ctx;
  JSValue global = JS_GetGlobalObject(ctx);
  JSValue value = JS_GetPropertyStr(ctx, global, copy);
  JS_FreeValue(ctx, global);
  free(copy);
  if (JS_IsException(value)) {
    JSValue exception = JS_GetException(ctx);
    JS_FreeValue(ctx, value);
    return emb_wrap_result(ctx, exception, 1);
  }
  return emb_wrap_result(ctx, value, 0);
}

MOONBIT_FFI_EXPORT
void *moonbit_emb_new_string(void *raw_context, moonbit_bytes_t bytes) {
  EmbContext *context = (EmbContext *)raw_context;
  if (context == NULL || context->ctx == NULL || bytes == NULL) return NULL;
  int32_t length = Moonbit_array_length(bytes);
  if (length < 0) return NULL;
  JSContext *ctx = context->ctx;
  JSValue value = JS_NewStringLen(ctx, (const char *)bytes, (size_t)length);
  if (JS_IsException(value)) {
    JSValue exception = JS_GetException(ctx);
    JS_FreeValue(ctx, value);
    return emb_wrap_result(ctx, exception, 1);
  }
  return emb_wrap_result(ctx, value, 0);
}

MOONBIT_FFI_EXPORT
int32_t moonbit_emb_context_live(void *raw_context) {
  EmbContext *context = (EmbContext *)raw_context;
  if (context == NULL || context->ctx == NULL) return -1;
  int32_t count = 0;
  for (int i = 0; i < emb_live_count; i++) {
    if (emb_live[i]->ctx == context->ctx) count += 1;
  }
  return count;
}

static void *emb_call_args(void *raw, int argc, void *raw0, void *raw1) {
  EmbValue *fn = (EmbValue *)raw;
  if (fn == NULL || !emb_value_live(fn) || !fn->alive || fn->is_exception) return NULL;
  if (argc < 0 || argc > 2) return NULL;
  EmbValue *raw_args[2] = { (EmbValue *)raw0, (EmbValue *)raw1 };
  JSValue args[2];
  for (int i = 0; i < argc; i++) {
    EmbValue *arg = raw_args[i];
    if (arg == NULL || !emb_value_live(arg) || !arg->alive || arg->ctx != fn->ctx) return NULL;
    args[i] = arg->value;
  }
  JSContext *ctx = fn->ctx;
  JSValue value = JS_Call(ctx, fn->value, JS_UNDEFINED, argc, argc == 0 ? NULL : args);
  if (JS_IsException(value)) {
    JSValue exception = JS_GetException(ctx);
    JS_FreeValue(ctx, value);
    return emb_wrap_result(ctx, exception, 1);
  }
  return emb_wrap_result(ctx, value, 0);
}

MOONBIT_FFI_EXPORT
void *moonbit_emb_call1(void *fn, void *arg0) {
  return emb_call_args(fn, 1, arg0, NULL);
}

MOONBIT_FFI_EXPORT
void *moonbit_emb_call2(void *fn, void *arg0, void *arg1) {
  return emb_call_args(fn, 2, arg0, arg1);
}

MOONBIT_FFI_EXPORT
void *moonbit_emb_call(void *raw) {
  return emb_call_args(raw, 0, NULL, NULL);
}

MOONBIT_FFI_EXPORT
void *moonbit_emb_value_dup(void *raw) {
  EmbValue *value = (EmbValue *)raw;
  if (value == NULL || !emb_value_live(value) || !value->alive) return NULL;
  EmbValue *copy = (EmbValue *)calloc(1, sizeof(EmbValue));
  if (copy == NULL) return NULL;
  copy->ctx = value->ctx;
  copy->is_exception = value->is_exception;
  copy->alive = 1;
  copy->value = JS_DupValue(value->ctx, value->value);
  if (!emb_register_value(copy)) {
    JS_FreeValue(copy->ctx, copy->value);
    free(copy);
    return NULL;
  }
  return copy;
}

MOONBIT_FFI_EXPORT
void moonbit_emb_value_release(void *raw) {
  EmbValue *value = (EmbValue *)raw;
  if (value == NULL || !emb_value_live(value)) return;
  emb_unregister_value(value);
  if (value->alive) {
    if (value->ctx != NULL) JS_FreeValue(value->ctx, value->value);
    value->alive = 0;
  }
  free(value);
}

MOONBIT_FFI_EXPORT
int32_t moonbit_emb_execute_one_job(void *raw_engine) {
  EmbEngine *engine = (EmbEngine *)raw_engine;
  if (engine == NULL || engine->rt == NULL) return -1;
  if (!JS_IsJobPending(engine->rt)) return 0;
  JSContext *ctx = NULL;
  int result = JS_ExecutePendingJob(engine->rt, &ctx);
  if (result < 0) {
    if (ctx != NULL) {
      JSValue exception = JS_GetException(ctx);
      JS_FreeValue(ctx, exception);
    }
    return -1;
  }
  return 1;
}

// Diagnostic only; it does not transfer ownership of any JSValue.
MOONBIT_FFI_EXPORT
int32_t moonbit_emb_job_pending(void *raw_engine) {
  EmbEngine *engine = (EmbEngine *)raw_engine;
  if (engine == NULL || engine->rt == NULL) return -1;
  return JS_IsJobPending(engine->rt) ? 1 : 0;
}
