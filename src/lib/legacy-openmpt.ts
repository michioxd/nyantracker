import legacyOpenMptScriptUrl from "./wasm/libopenmpt.js?url";
import legacyOpenMptWasmUrl from "./wasm/libopenmpt.wasm?url";

export interface LegacyOpenMptModule {
    locateFile?: (path: string, prefix: string) => string;
    HEAPU8: Uint8Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
    _openmpt_module_create_from_memory2(
        filedata: number,
        filesize: number,
        logfunc: number,
        user: number,
        ctls: number,
        error: number,
        errorMessage: number,
        initialCtls: number,
        reserved: number,
    ): number;
    _openmpt_module_destroy(modulePtr: number): void;
    _openmpt_module_set_repeat_count(modulePtr: number, repeatCount: number): void;
    _openmpt_module_get_num_channels(modulePtr: number): number;
    _openmpt_module_get_current_pattern(modulePtr: number): number;
    _openmpt_module_get_current_row(modulePtr: number): number;
    _openmpt_module_get_current_order(modulePtr: number): number;
    _openmpt_module_get_position_seconds(modulePtr: number): number;
    _openmpt_module_get_pattern_num_rows(modulePtr: number, pattern: number): number;
    _openmpt_module_read_mono(modulePtr: number, sampleRate: number, count: number, bufferPtr: number): number;
    _openmpt_module_format_pattern_row_channel_command(
        modulePtr: number,
        pattern: number,
        row: number,
        channel: number,
        command: number,
    ): number;
    _openmpt_free_string(ptr: number): void;
    ccall(
        name: string,
        returnType: "number" | "string" | "boolean" | null,
        argTypes: string[],
        args: Array<number | string | boolean>,
    ): number;
}

interface LegacyOpenMptBootstrap {
    locateFile?: (path: string, prefix: string) => string;
    onRuntimeInitialized?: () => void;
    memory?: WebAssembly.Memory;
    instantiateWasm?: (
        imports: WebAssembly.Imports,
        receiveInstance: (instance: WebAssembly.Instance, module?: WebAssembly.Module) => unknown,
    ) => void;
}

declare global {
    interface Window {
        Module?: Partial<LegacyOpenMptModule> & LegacyOpenMptBootstrap;
        libopenmpt?: Partial<LegacyOpenMptModule> & LegacyOpenMptBootstrap;
    }
}

const SCRIPT_ID = "legacy-openmpt-script";

let legacyOpenMptPromise: Promise<LegacyOpenMptModule> | null = null;

function getLegacyOpenMptAssetUrl(path: string): string {
    if (path === "libopenmpt.js") {
        return legacyOpenMptScriptUrl;
    }

    if (path === "libopenmpt.wasm") {
        return legacyOpenMptWasmUrl;
    }

    return new URL(path, new URL(legacyOpenMptScriptUrl, window.location.href)).href;
}

function getLegacyMemory(value: Window["Module"]): WebAssembly.Memory | null {
    return value?.memory instanceof WebAssembly.Memory ? value.memory : null;
}

function findExportedMemory(exports: WebAssembly.Exports): WebAssembly.Memory | null {
    for (const value of Object.values(exports)) {
        if (value instanceof WebAssembly.Memory) {
            return value;
        }
    }

    return null;
}

function ensureHeapAccess(module: Partial<LegacyOpenMptModule> & LegacyOpenMptBootstrap): void {
    const descriptor = Object.getOwnPropertyDescriptor(module, "HEAPU8");
    if (descriptor?.get || module.HEAPU8) {
        return;
    }

    Object.defineProperty(module, "HEAPU8", {
        configurable: true,
        enumerable: true,
        get() {
            const memory = getLegacyMemory(module);

            if (!memory) {
                throw new Error("Legacy OpenMPT memory is not ready.");
            }

            return new Uint8Array(memory.buffer);
        },
    });
}

function hasLegacyModule(value: Window["Module"]): value is LegacyOpenMptModule {
    return Boolean(value?._openmpt_module_create_from_memory2 && getLegacyMemory(value));
}

function attachCcallPolyfill(module: Partial<LegacyOpenMptModule> & LegacyOpenMptBootstrap): void {
    if (module.ccall) {
        return;
    }

    module.ccall = (
        name: string,
        _returnType: "number" | "string" | "boolean" | null,
        _argTypes: string[],
        args: Array<number | string | boolean>,
    ): number => {
        const exportName = `_${name}` as keyof LegacyOpenMptModule;
        const exportedFunction = module[exportName];

        if (typeof exportedFunction !== "function") {
            throw new Error(`Missing OpenMPT export: ${name}`);
        }

        return (exportedFunction as (...callArgs: Array<number | string | boolean>) => number)(...args);
    };
}

async function instantiateLegacyOpenMptWasm(
    bootstrap: Partial<LegacyOpenMptModule> & LegacyOpenMptBootstrap,
    imports: WebAssembly.Imports,
    receiveInstance: (instance: WebAssembly.Instance, module?: WebAssembly.Module) => unknown,
): Promise<void> {
    const response = await fetch(legacyOpenMptWasmUrl, { credentials: "same-origin" });

    let result: WebAssembly.WebAssemblyInstantiatedSource;
    if (typeof WebAssembly.instantiateStreaming === "function") {
        try {
            result = await WebAssembly.instantiateStreaming(response.clone(), imports);
        } catch {
            result = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
        }
    } else {
        result = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
    }

    const exports = result.instance.exports as WebAssembly.Exports;
    const memory = findExportedMemory(exports);
    if (memory) {
        bootstrap.memory = memory;
        ensureHeapAccess(bootstrap);
    }

    receiveInstance(result.instance, result.module);
}

function getBootstrapTarget(): Partial<LegacyOpenMptModule> & LegacyOpenMptBootstrap {
    return window.libopenmpt ?? window.Module ?? {};
}

function ensureBootstrapConfig(onRuntimeInitialized: () => void): void {
    const previousOnRuntimeInitialized = getBootstrapTarget().onRuntimeInitialized;
    const bootstrap = {
        ...getBootstrapTarget(),
        locateFile(path: string, _prefix: string) {
            return getLegacyOpenMptAssetUrl(path);
        },
        instantiateWasm(
            imports: WebAssembly.Imports,
            receiveInstance: (instance: WebAssembly.Instance, module?: WebAssembly.Module) => unknown,
        ) {
            void instantiateLegacyOpenMptWasm(bootstrap, imports, receiveInstance);
        },
        onRuntimeInitialized() {
            ensureHeapAccess(bootstrap);
            attachCcallPolyfill(bootstrap);
            previousOnRuntimeInitialized?.();
            onRuntimeInitialized();
        },
    };

    ensureHeapAccess(bootstrap);
    window.libopenmpt = bootstrap;
    window.Module = bootstrap;
}

function injectScript(): Promise<void> {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
        return existing.dataset.loaded === "true"
            ? Promise.resolve()
            : new Promise((resolve, reject) => {
                  existing.addEventListener("load", () => resolve(), { once: true });
                  existing.addEventListener("error", () => reject(new Error("Failed to load legacy OpenMPT script.")), {
                      once: true,
                  });
              });
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.id = SCRIPT_ID;
        script.src = legacyOpenMptScriptUrl;
        script.async = true;
        script.addEventListener(
            "load",
            () => {
                script.dataset.loaded = "true";
                resolve();
            },
            { once: true },
        );
        script.addEventListener("error", () => reject(new Error("Failed to load legacy OpenMPT script.")), {
            once: true,
        });
        document.head.appendChild(script);
    });
}

async function waitForLegacyModule(timeoutMs = 15000): Promise<LegacyOpenMptModule> {
    const startedAt = performance.now();

    while (performance.now() - startedAt < timeoutMs) {
        const moduleCandidate = window.Module ?? window.libopenmpt;
        if (hasLegacyModule(moduleCandidate)) {
            ensureHeapAccess(moduleCandidate);
            attachCcallPolyfill(moduleCandidate);
            return moduleCandidate;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 50));
    }

    throw new Error("Timed out while waiting for the legacy OpenMPT engine.");
}

export function loadLegacyOpenMpt(): Promise<LegacyOpenMptModule> {
    if (!legacyOpenMptPromise) {
        legacyOpenMptPromise = (async () => {
            const runtimeReady = new Promise<void>((resolve) => {
                ensureBootstrapConfig(resolve);
            });
            await injectScript();
            await runtimeReady;
            return waitForLegacyModule();
        })();
    }

    return legacyOpenMptPromise;
}
