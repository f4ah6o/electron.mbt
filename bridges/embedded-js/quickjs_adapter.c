#include "quickjs.h"
#include "moonbit.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

// A minimal, explicit-lifetime QuickJS adapter. C owns the engine/context/value
// handles; MoonBit owns the policy, request ledger and scheduling decisions.
// No JSValue is exposed to MoonBit and no engine callback is allowed to unwind
// through a MoonBit frame.

typedef struct {
  JSRuntime *rt;
  volatile int interrupted;
  int64_t memory_limit;
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

static int emb_interrupt_handler(JSRuntime *rt, void *opaque) {
  (void)rt;
  EmbEngine *engine = (EmbEngine *)opaque;
  return engine != NULL && engine->interrupted;
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
MOONBIT_FFI_EXPORT
moonbit_bytes_t moonbit_emb_value_text(void *raw) {
  EmbValue *value = (EmbValue *)raw;
  if (value == NULL || !emb_value_live(value) || !value->alive) return emb_literal("released value handle");
  JSContext *ctx = value->ctx;
  if (ctx == NULL) return emb_literal("evaluation failed: no context");
  JSValue printable = JS_UNDEFINED;
  int owns_printable = 0;
  const char *text = NULL;
  size_t length = 0;
  if (value->is_exception) {
    text = JS_ToCStringLen(ctx, &length, value->value);
  } else {
    printable = JS_JSONStringify(ctx, value->value, JS_UNDEFINED, JS_UNDEFINED);
    if (JS_IsException(printable)) {
      JSValue exception = JS_GetException(ctx);
      JS_FreeValue(ctx, printable);
      text = JS_ToCStringLen(ctx, &length, exception);
      JS_FreeValue(ctx, exception);
    } else if (JS_IsUndefined(printable)) {
      text = "undefined";
      length = 9;
    } else {
      owns_printable = 1;
      text = JS_ToCStringLen(ctx, &length, printable);
    }
  }
  moonbit_bytes_t bytes;
  if (text == NULL) {
    bytes = emb_literal("unprintable value");
  } else {
    bytes = emb_bytes(text, length);
    JS_FreeCString(ctx, text);
  }
  if (owns_printable) JS_FreeValue(ctx, printable);
  return bytes;
}

MOONBIT_FFI_EXPORT
void *moonbit_emb_call(void *raw) {
  EmbValue *value = (EmbValue *)raw;
  if (value == NULL || !emb_value_live(value) || !value->alive || value->is_exception) return NULL;
  EmbValue *result = (EmbValue *)calloc(1, sizeof(EmbValue));
  if (result == NULL) return NULL;
  result->ctx = value->ctx;
  result->alive = 1;
  JSValue call_result = JS_Call(value->ctx, value->value, JS_UNDEFINED, 0, NULL);
  if (JS_IsException(call_result)) {
    result->is_exception = 1;
    result->value = JS_GetException(value->ctx);
  } else {
    result->value = call_result;
  }
  if (!emb_register_value(result)) {
    JS_FreeValue(result->ctx, result->value);
    free(result);
    return NULL;
  }
  return result;
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
