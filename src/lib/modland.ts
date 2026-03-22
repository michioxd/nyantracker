import { unzipSync } from "fflate";

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

export interface ModlandLoadedModule {
    buffer: ArrayBuffer;
    fileName: string;
}

export type ModlandFetchProgressCallback = (progressPercent: number) => void;

let catalogPromise: Promise<ModlandEntry[]> | null = null;

export function getPlayableExtensionList(): string[] {
    return [...PLAYABLE_EXTENSIONS];
}

export function isPlayableExtension(extension: string): boolean {
    return PLAYABLE_EXTENSIONS.has(extension.toLowerCase());
}

export async function fetchModlandCatalog(): Promise<ModlandEntry[]> {
    if (!catalogPromise) {
        catalogPromise = loadCatalog();
    }

    return catalogPromise;
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

export function filterModlandEntries(entries: ModlandEntry[], query: string): ModlandEntry[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return entries;
    }

    const terms = normalized.split(/\s+/).filter(Boolean);
    return entries.filter((entry) => {
        const haystack = `${entry.title} ${entry.artist} ${entry.tracker} ${entry.ext}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
    });
}

export async function fetchModlandModule(
    entry: ModlandEntry,
    onProgress?: ModlandFetchProgressCallback,
): Promise<ModlandLoadedModule> {
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

function extractModuleFromArchive(archiveBytes: Uint8Array, entry: ModlandEntry): ModlandLoadedModule {
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

async function readResponseWithProgress(
    response: Response,
    onProgress?: ModlandFetchProgressCallback,
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
    return `${MODLAND_MODULE_BASE_URL}/${encodeURI(path).replace(/#/g, "%23")}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
