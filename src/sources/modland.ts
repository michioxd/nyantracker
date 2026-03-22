import { unzipSync } from "fflate";
import {
    BrowserSource,
    getSearchTerms,
    readResponseWithProgress,
    type BrowserFetchProgressCallback,
    type BrowserLoadedModule,
    type BrowserSongEntry,
} from "./base";

const PLAYABLE_EXTENSIONS = new Set(
    "mptm mod s3m xm it 669 amf ams c67 dbm digi dmf dsm dsym far ice j2b m15 mdl med mms mt2 mtm nst okt plm psm pt36 ptm sfx sfx2 st26 stk stm stx stp symmod ult wow gdm mo3 oxm umx xpk ppm mmcmp".split(
        " ",
    ),
);

const MODLAND_CATALOG_URL = "https://modland.com/allmods.zip";
const MODLAND_MODULE_BASE_URL = "https://modland.com/pub/modules";

export interface ModlandEntry {
    sizeBytes: number;
    sizeKb: number;
    path: string;
    url: string;
    tracker: string;
    artist: string;
    title: string;
    ext: string;
    playable: boolean;
    archive: boolean;
    archiveEntryName: string;
}

export function getPlayableExtensionList(): string[] {
    return [...PLAYABLE_EXTENSIONS];
}

export function isPlayableExtension(extension: string): boolean {
    return PLAYABLE_EXTENSIONS.has(extension.toLowerCase());
}

async function loadCatalog(): Promise<ModlandEntry[]> {
    const response = await fetch(MODLAND_CATALOG_URL);
    if (!response.ok) {
        throw new Error(`Failed to fetch Modland catalog (${response.status})`);
    }

    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const catalogFile = archive["allmods.txt"];
    if (!catalogFile) {
        throw new Error("Modland catalog archive does not contain allmods.txt");
    }

    const text = new TextDecoder().decode(catalogFile);
    const entries = parseModlandCatalog(text);
    entries.sort((left, right) => {
        const leftKey = `${left.tracker}\u0000${left.artist}\u0000${left.title}`.toLowerCase();
        const rightKey = `${right.tracker}\u0000${right.artist}\u0000${right.title}`.toLowerCase();
        return leftKey.localeCompare(rightKey);
    });
    return entries;
}

export function parseModlandCatalog(text: string): ModlandEntry[] {
    const rows = text.split(/\r?\n/);
    const entries: ModlandEntry[] = [];

    for (const row of rows) {
        if (!row) {
            continue;
        }

        const cols = row.split("\t");
        if (cols.length < 2) {
            continue;
        }

        const sizeBytes = Number(cols[0]);
        const path = cols[1].trim();
        if (!path) {
            continue;
        }

        const entry = parseEntry(path, sizeBytes);
        if (!entry.playable) {
            continue;
        }

        entries.push(entry);
    }

    return entries;
}

function parseEntry(path: string, sizeBytes: number): ModlandEntry {
    const lowerPath = path.toLowerCase();
    const archive = lowerPath.endsWith(".zip");
    const nameParts = path.split(".");
    const ext = archive ? (nameParts[nameParts.length - 2] ?? "") : (nameParts[nameParts.length - 1] ?? "");
    const normalizedExt = ext.toLowerCase();
    const parts = path.split("/");
    const tracker = parts[0] ?? "Unknown";
    const artist = parts.length === 5 ? (parts[2] ?? "Unknown") : (parts[1] ?? "Unknown");
    const fileName = parts[parts.length - 1] ?? path;
    const archiveEntryName = archive ? fileName.replace(/\.zip$/i, "") : fileName;
    const title = archiveEntryName.replace(new RegExp(`\\.${escapeRegExp(normalizedExt)}$`, "i"), "");

    return {
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
        sizeKb: Number.isFinite(sizeBytes) ? sizeBytes / 1024 : 0,
        path,
        url: buildModuleUrl(path),
        tracker,
        artist,
        title,
        ext: normalizedExt,
        playable: isPlayableExtension(normalizedExt),
        archive,
        archiveEntryName,
    };
}

function filterModlandEntries(
    entries: BrowserSongEntry<ModlandEntry>[],
    query: string,
): BrowserSongEntry<ModlandEntry>[] {
    const terms = getSearchTerms(query);
    if (terms.length === 0) {
        return entries;
    }

    return entries.filter((entry) => {
        const haystack = `${entry.title} ${entry.artist} ${entry.tracker} ${entry.ext}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
    });
}

async function fetchModlandModule(
    entry: ModlandEntry,
    onProgress?: BrowserFetchProgressCallback,
): Promise<BrowserLoadedModule> {
    const requestUrl = buildModuleUrl(entry.path);
    const response = await fetch(requestUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch module (${response.status})`);
    }

    const archiveBuffer = await readResponseWithProgress(response, onProgress);
    if (!entry.archive) {
        return {
            buffer: archiveBuffer,
            fileName: entry.archiveEntryName,
        };
    }

    return extractModuleFromArchive(new Uint8Array(archiveBuffer), entry);
}

function extractModuleFromArchive(archiveBytes: Uint8Array, entry: ModlandEntry): BrowserLoadedModule {
    const extracted = unzipSync(archiveBytes);
    const exactKey = Object.keys(extracted).find((key) =>
        key.toLowerCase().endsWith(entry.archiveEntryName.toLowerCase()),
    );
    const playableKey =
        exactKey ??
        Object.keys(extracted).find((key) => {
            const ext = key.split(".").pop();
            return typeof ext === "string" && isPlayableExtension(ext);
        });

    if (!playableKey) {
        throw new Error("No playable module found inside archive");
    }

    const fileBytes = extracted[playableKey];
    return {
        buffer: toArrayBuffer(fileBytes),
        fileName: playableKey.split("/").pop() ?? entry.archiveEntryName,
    };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}

function buildModuleUrl(path: string): string {
    return `${MODLAND_MODULE_BASE_URL}/${encodeURI(path).replace(/#/g, "%23")}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class ModlandSource extends BrowserSource<ModlandEntry> {
    readonly sourceId = "modland" as const;
    readonly sourceName = "modland.com";

    filterEntries(entries: BrowserSongEntry<ModlandEntry>[], query: string): BrowserSongEntry<ModlandEntry>[] {
        return filterModlandEntries(entries, query);
    }

    async fetchModule(
        entry: BrowserSongEntry<ModlandEntry>,
        onProgress?: BrowserFetchProgressCallback,
    ): Promise<BrowserLoadedModule> {
        return fetchModlandModule(entry.rawEntry, onProgress);
    }

    protected async loadEntries(): Promise<BrowserSongEntry<ModlandEntry>[]> {
        const entries = await loadCatalog();
        return entries.map((entry) => ({
            source: this.sourceId,
            path: entry.path,
            fileName: entry.archiveEntryName,
            tracker: entry.tracker,
            artist: entry.artist || "Unknown",
            title: entry.title || entry.archiveEntryName,
            ext: entry.ext,
            sizeKb: entry.sizeKb,
            rawEntry: entry,
        }));
    }
}

export const modlandSource = new ModlandSource();
