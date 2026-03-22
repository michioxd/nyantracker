import type KeygenMusicIndex from "../types/keygen";
import {
    BrowserSource,
    getSearchTerms,
    readResponseWithProgress,
    type BrowserFetchProgressCallback,
    type BrowserLoadedModule,
    type BrowserSongEntry,
} from "./base";
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

async function fetchKeygenModule(
    entry: KeygenEntry,
    onProgress?: BrowserFetchProgressCallback,
): Promise<BrowserLoadedModule> {
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

function buildModuleUrl(path: string): string {
    return `${KEYGEN_MODULE_BASE_URL}/${encodeURI(path).replace(/#/g, "%23")}`;
}

function filterKeygenEntries(entries: BrowserSongEntry<KeygenEntry>[], query: string): BrowserSongEntry<KeygenEntry>[] {
    const terms = getSearchTerms(query);
    if (terms.length === 0) {
        return entries;
    }

    return entries.filter((entry) => {
        const haystack =
            `${entry.title} ${entry.rawEntry.trackTitle} ${entry.artist} ${entry.tracker} ${entry.ext} ${entry.fileName}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
    });
}

export class KeygenSource extends BrowserSource<KeygenEntry> {
    readonly sourceId = "keygen" as const;
    readonly sourceName = "Keygen music";

    filterEntries(entries: BrowserSongEntry<KeygenEntry>[], query: string): BrowserSongEntry<KeygenEntry>[] {
        return filterKeygenEntries(entries, query);
    }

    async fetchModule(
        entry: BrowserSongEntry<KeygenEntry>,
        onProgress?: BrowserFetchProgressCallback,
    ): Promise<BrowserLoadedModule> {
        return fetchKeygenModule(entry.rawEntry, onProgress);
    }

    protected async loadEntries(): Promise<BrowserSongEntry<KeygenEntry>[]> {
        const entries = await loadCatalog();
        return entries.map((entry) => ({
            source: this.sourceId,
            path: entry.path,
            fileName: entry.fileName,
            tracker: entry.tracker,
            artist: entry.artist || "Unknown",
            title: entry.title || entry.fileName,
            ext: entry.ext,
            sizeKb: entry.sizeKb,
            rawEntry: entry,
        }));
    }
}

export const keygenSource = new KeygenSource();
