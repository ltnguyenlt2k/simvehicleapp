// M20-T01 spike host: Wasmtime v48 C API — loads a guest (.wasm or precompiled .cwasm), provides sv.now_ms / sv.log
// and WASI, calls sv_init then sv_step N times; prints load / instantiate / step times in microseconds.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <wasi.h>
#include <wasm.h>
#include <wasmtime.h>

static double now_us(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec * 1e6 + t.tv_nsec / 1e3;
}

static void die(const char* what, wasmtime_error_t* err, wasm_trap_t* trap) {
    wasm_byte_vec_t msg = {0};
    if (err) wasmtime_error_message(err, &msg);
    else if (trap) wasm_trap_message(trap, &msg);
    fprintf(stderr, "%s: %.*s\n", what, (int)msg.size, msg.data);
    exit(1);
}

static wasm_trap_t* now_ms(void* env, wasmtime_caller_t* caller, const wasmtime_val_t* args, size_t nargs,
                           wasmtime_val_t* results, size_t nresults) {
    struct timespec t;
    clock_gettime(CLOCK_REALTIME, &t);
    results[0].kind = WASMTIME_I64;
    results[0].of.i64 = (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
    return NULL;
}

static wasm_trap_t* sv_log(void* env, wasmtime_caller_t* caller, const wasmtime_val_t* args, size_t nargs,
                           wasmtime_val_t* results, size_t nresults) {
    wasmtime_extern_t mem;
    if (!wasmtime_caller_export_get(caller, "memory", 6, &mem) || mem.kind != WASMTIME_EXTERN_MEMORY)
        return wasmtime_trap_new("no memory export", 16);
    wasmtime_context_t* cx = wasmtime_caller_context(caller);
    uint8_t* base = wasmtime_memory_data(cx, &mem.of.memory);
    size_t size = wasmtime_memory_data_size(cx, &mem.of.memory);
    uint32_t p = (uint32_t)args[0].of.i32, n = (uint32_t)args[1].of.i32;
    if ((uint64_t)p + n > size) return wasmtime_trap_new("log out of bounds", 17);
    if (getenv("SV_QUIET") == NULL) printf("guest: %.*s\n", (int)n, base + p);
    return NULL;
}

static uint8_t* read_file(const char* path, size_t* len) {
    FILE* f = fopen(path, "rb");
    if (!f) { perror(path); exit(1); }
    fseek(f, 0, SEEK_END);
    *len = (size_t)ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t* b = malloc(*len);
    if (fread(b, 1, *len, f) != *len) { perror(path); exit(1); }
    fclose(f);
    return b;
}

int main(int argc, char** argv) {
    if (argc < 2) { fprintf(stderr, "usage: host app.wasm|app.cwasm [steps] | host --precompile app.wasm app.cwasm\n"); return 2; }
    if (strcmp(argv[1], "--precompile") == 0 && argc == 4) {
        // Precompiled with the host's own engine configuration (the CLI's defaults may differ).
        size_t n;
        uint8_t* in = read_file(argv[2], &n);
        double c0 = now_us();
        wasm_engine_t* e = wasm_engine_new();
        wasmtime_module_t* m = NULL;
        wasmtime_error_t* er = wasmtime_module_new(e, in, n, &m);
        if (er) die("compile", er, NULL);
        wasm_byte_vec_t out;
        if ((er = wasmtime_module_serialize(m, &out))) die("serialize", er, NULL);
        FILE* f = fopen(argv[3], "wb");
        fwrite(out.data, 1, out.size, f);
        fclose(f);
        printf("PRECOMPILE %s -> %s bytes=%zu compile_us=%.0f\n", argv[2], argv[3], out.size, now_us() - c0);
        return 0;
    }
    int steps = argc > 2 ? atoi(argv[2]) : 20;
    size_t len;
    uint8_t* bytes = read_file(argv[1], &len);
    int precompiled = strstr(argv[1], ".cwasm") != NULL;

    double t0 = now_us();
    wasm_engine_t* engine = wasm_engine_new();
    wasmtime_module_t* module = NULL;
    wasmtime_error_t* err = precompiled ? wasmtime_module_deserialize(engine, bytes, len, &module)
                                        : wasmtime_module_new(engine, bytes, len, &module);
    if (err) die("load", err, NULL);
    double t1 = now_us();

    wasmtime_store_t* store = wasmtime_store_new(engine, NULL, NULL);
    wasmtime_context_t* cx = wasmtime_store_context(store);
    wasmtime_linker_t* linker = wasmtime_linker_new(engine);
    if ((err = wasmtime_linker_define_wasi(linker))) die("wasi", err, NULL);
    wasi_config_t* wasi = wasi_config_new();
    wasi_config_inherit_stdout(wasi);
    wasi_config_inherit_stderr(wasi);
    if ((err = wasmtime_context_set_wasi(cx, wasi))) die("wasi config", err, NULL);

    wasm_valtype_vec_t none, i64r, logp;
    wasm_valtype_vec_new_empty(&none);
    wasm_valtype_t* r1[1] = {wasm_valtype_new_i64()};
    wasm_valtype_vec_new(&i64r, 1, r1);
    wasm_functype_t* t_now = wasm_functype_new(&none, &i64r);
    wasm_valtype_t* l2[2] = {wasm_valtype_new_i32(), wasm_valtype_new_i32()};
    wasm_valtype_vec_new(&logp, 2, l2);
    wasm_valtype_vec_t none2;
    wasm_valtype_vec_new_empty(&none2);
    wasm_functype_t* t_log = wasm_functype_new(&logp, &none2);
    if ((err = wasmtime_linker_define_func(linker, "sv", 2, "now_ms", 6, t_now, now_ms, NULL, NULL))) die("define now_ms", err, NULL);
    if ((err = wasmtime_linker_define_func(linker, "sv", 2, "log", 3, t_log, sv_log, NULL, NULL))) die("define log", err, NULL);

    wasmtime_instance_t inst;
    wasm_trap_t* trap = NULL;
    if ((err = wasmtime_linker_instantiate(linker, cx, module, &inst, &trap)) || trap) die("instantiate", err, trap);
    // A reactor runs its constructors in _initialize.
    wasmtime_extern_t f;
    if (wasmtime_instance_export_get(cx, &inst, "_initialize", 11, &f)) {
        if ((err = wasmtime_func_call(cx, &f.of.func, NULL, 0, NULL, 0, &trap)) || trap) die("_initialize", err, trap);
    }
    double t2 = now_us();

    wasmtime_extern_t init, step;
    if (!wasmtime_instance_export_get(cx, &inst, "sv_init", 7, &init)) { fprintf(stderr, "no sv_init\n"); return 1; }
    if (!wasmtime_instance_export_get(cx, &inst, "sv_step", 7, &step)) { fprintf(stderr, "no sv_step\n"); return 1; }
    wasmtime_val_t res;
    if ((err = wasmtime_func_call(cx, &init.of.func, NULL, 0, &res, 1, &trap)) || trap) die("sv_init", err, trap);
    double t3 = now_us();
    for (int i = 0; i < steps; i++) {
        wasmtime_val_t arg = {.kind = WASMTIME_I64, .of.i64 = (int64_t)i * 100};
        if ((err = wasmtime_func_call(cx, &step.of.func, &arg, 1, &res, 1, &trap)) || trap) die("sv_step", err, trap);
    }
    double t4 = now_us();
    printf("RESULT file=%s bytes=%zu load_us=%.0f instantiate_us=%.0f init_us=%.0f steps=%d step_us_avg=%.2f last=%d\n",
           argv[1], len, t1 - t0, t2 - t1, t3 - t2, steps, (t4 - t3) / steps, res.of.i32);
    return 0;
}
