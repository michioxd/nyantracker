import type { LegacyOpenMptModule } from "../lib/legacy-openmpt";

export interface PatternCell {
    note: string;
    inst: string;
    eff: string;
}

const NOTE_NAMES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];

export function formatDuration(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        return "--:--";
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function formatCounter(value: number, total: number): string {
    const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;
    const safeTotal = Number.isFinite(total) && total >= 0 ? total : 0;
    return `${safeValue.toString().padStart(2, "0")}/${safeTotal.toString().padStart(2, "0")}`;
}

export function getNoteFrequency(note: string): number {
    if (!note || note === "---" || note === "^^^" || note === "===") {
        return 0;
    }

    const tone = note.slice(0, 2);
    const octave = Number.parseInt(note.slice(2), 10);
    const noteIndex = NOTE_NAMES.indexOf(tone);
    if (noteIndex === -1 || Number.isNaN(octave)) {
        return 0;
    }

    return 440 * Math.pow(2, (noteIndex - 9 + (octave - 4) * 12) / 12);
}

function ptrToString(module: LegacyOpenMptModule, ptr: number): string {
    if (!ptr) {
        return "";
    }

    let result = "";
    let index = 0;
    while (module.HEAPU8[ptr + index] !== 0 && index < 20) {
        result += String.fromCharCode(module.HEAPU8[ptr + index]);
        index += 1;
    }
    return result.trim();
}

function freeCString(module: LegacyOpenMptModule, ptr: number): void {
    if (ptr) {
        module._openmpt_free_string(ptr);
    }
}

export function readPatternCell(
    module: LegacyOpenMptModule,
    modulePtr: number,
    pattern: number,
    row: number,
    channel: number,
): PatternCell {
    const notePtr = module._openmpt_module_format_pattern_row_channel_command(modulePtr, pattern, row, channel, 0);
    const instPtr = module._openmpt_module_format_pattern_row_channel_command(modulePtr, pattern, row, channel, 1);
    const volPtr = module._openmpt_module_format_pattern_row_channel_command(modulePtr, pattern, row, channel, 2);
    const effectTypePtr = module._openmpt_module_format_pattern_row_channel_command(
        modulePtr,
        pattern,
        row,
        channel,
        3,
    );
    const effectParamPtr = module._openmpt_module_format_pattern_row_channel_command(
        modulePtr,
        pattern,
        row,
        channel,
        4,
    );

    const note = ptrToString(module, notePtr) || "---";
    const inst = ptrToString(module, instPtr) || "--";
    const volume = ptrToString(module, volPtr);
    const effectType = ptrToString(module, effectTypePtr);
    const effectParam = ptrToString(module, effectParamPtr);

    freeCString(module, notePtr);
    freeCString(module, instPtr);
    freeCString(module, volPtr);
    freeCString(module, effectTypePtr);
    freeCString(module, effectParamPtr);

    const effect = effectType || effectParam ? `${effectType || "-"}${effectParam || "00"}` : volume || "...";

    return {
        note: note.padEnd(3, "-").slice(0, 3),
        inst: inst.padStart(2, "0").replace("00", "--"),
        eff: effect.padEnd(3, ".").slice(0, 3),
    };
}
