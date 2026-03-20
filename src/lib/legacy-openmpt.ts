import legacyOpenMptMemoryUrl from "./chiptune2/libopenmpt.js.mem?url";
import legacyOpenMptScriptUrl from "./chiptune2/libopenmpt.js?url";

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
}

declare global {
    interface Window {
        Module?: Partial<LegacyOpenMptModule> & LegacyOpenMptBootstrap;
    }
}

const SCRIPT_ID = "legacy-openmpt-script";

let legacyOpenMptPromise: Promise<LegacyOpenMptModule> | null = null;

function getLegacyOpenMptAssetUrl(path: string): string {
    if (path === "libopenmpt.js") {
        return legacyOpenMptScriptUrl;
    }

    if (path === "libopenmpt.js.mem") {
        return legacyOpenMptMemoryUrl;
    }

    return new URL(path, new URL(legacyOpenMptScriptUrl, window.location.href)).href;
}

function hasLegacyModule(value: Window["Module"]): value is LegacyOpenMptModule {
    return Boolean(value?._openmpt_module_create_from_memory2 && value?.ccall && value?.HEAPU8);
}

function ensureBootstrapConfig(): void {
    window.Module = {
        ...(window.Module ?? {}),
        locateFile(path: string, _prefix: string) {
            return getLegacyOpenMptAssetUrl(path);
        },
    };
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
        if (hasLegacyModule(window.Module)) {
            return window.Module;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 50));
    }

    throw new Error("Timed out while waiting for the legacy OpenMPT engine.");
}

export function loadLegacyOpenMpt(): Promise<LegacyOpenMptModule> {
    if (!legacyOpenMptPromise) {
        legacyOpenMptPromise = (async () => {
            ensureBootstrapConfig();
            await injectScript();
            return waitForLegacyModule();
        })();
    }

    return legacyOpenMptPromise;
}
