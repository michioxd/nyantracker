import type KeygenMusicIndex from "../types/keygen";
import { isPlayableExtension } from "./modland";

const KEYGEN_INDEX_URL = "https://michioxd.ch/keygen-music/index.min.json";
const KEYGEN_MODULE_BASE_URL = "https://michioxd.ch/keygen-music";

export interface KeygenEntry {
    sizeBytes: number;
    sizeKb: number;
    path: string;
    url: string;
    tracker: string;
    artist: string;
    title: string;
    trackTitle: string;
    ext: string;
    playable: boolean;
    fileName: string;
}

export interface KeygenLoadedModule {
    buffer: ArrayBuffer;
    fileName: string;
}

export type KeygenFetchProgressCallback = (progressPercent: number) => void;

let catalogPromise: Promise<KeygenEntry[]> | null = null;

export async function fetchKeygenCatalog(): Promise<KeygenEntry[]> {
    if (!catalogPromise) {
        catalogPromise = loadCatalog();
    }

    return catalogPromise;
}

async function loadCatalog(): Promise<KeygenEntry[]> {
    const response = await fetch(KEYGEN_INDEX_URL);
    if (!response.ok) {
        throw new Error(`Failed to fetch Keygen catalog (${response.status})`);
    }

    const payload = (await response.json()) as KeygenMusicIndex[];
    if (!Array.isArray(payload)) {
        throw new Error("Keygen catalog payload is not an array");
    }

    const entries = payload.map((item) => parseEntry(item)).filter((entry): entry is KeygenEntry => entry !== null);
    entries.sort((left, right) => {
        const leftKey = `${left.artist}\u0000${left.title}\u0000${left.trackTitle}\u0000${left.tracker}`.toLowerCase();
        const rightKey =
            `${right.artist}\u0000${right.title}\u0000${right.trackTitle}\u0000${right.tracker}`.toLowerCase();
        return leftKey.localeCompare(rightKey);
    });
    return entries;
}

function parseEntry(item: KeygenMusicIndex): KeygenEntry | null {
    const path = item.path.trim();
    if (!path) {
        return null;
    }

    const ext = item.fileExtension.trim().toLowerCase();
    if (!isPlayableExtension(ext)) {
        return null;
    }

    const fileName = path.split("/").pop() ?? path;
    const sizeBytes = Number.isFinite(item.size) ? item.size : 0;

    return {
        sizeBytes,
        sizeKb: sizeBytes / 1024,
        path,
        url: buildModuleUrl(path),
        tracker: item.tracker?.trim() || "Unknown",
        artist: item.artist?.trim() || "Unknown",
        title: item.title?.trim() || fileName,
        trackTitle: item.trackTitle?.trim() || item.title?.trim() || fileName,
        ext,
        playable: true,
        fileName,
    };
}

export async function fetchKeygenModule(
    entry: KeygenEntry,
    onProgress?: KeygenFetchProgressCallback,
): Promise<KeygenLoadedModule> {
    const response = await fetch(buildModuleUrl(entry.path));
    if (!response.ok) {
        throw new Error(`Failed to fetch module (${response.status})`);
    }

    const buffer = await readResponseWithProgress(response, onProgress);
    return {
        buffer,
        fileName: entry.fileName,
    };
}

async function readResponseWithProgress(
    response: Response,
    onProgress?: KeygenFetchProgressCallback,
): Promise<ArrayBuffer> {
    const contentLengthHeader = response.headers.get("content-length");
    const totalBytes = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;
    const canTrackProgress = Number.isFinite(totalBytes) && totalBytes > 0;

    if (!response.body) {
        const buffer = await response.arrayBuffer();
        onProgress?.(100);
        return buffer;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    if (canTrackProgress) {
        onProgress?.(0);
    }

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        if (!value) {
            continue;
        }

        chunks.push(value);
        receivedBytes += value.byteLength;

        if (canTrackProgress) {
            onProgress?.((receivedBytes / totalBytes) * 100);
        }
    }

    const merged = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }

    onProgress?.(100);
    return merged.buffer;
}

function buildModuleUrl(path: string): string {
    return `${KEYGEN_MODULE_BASE_URL}/${encodeURI(path).replace(/#/g, "%23")}`;
}
