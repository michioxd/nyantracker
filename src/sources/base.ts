export type BrowserSourceId = "modland" | "keygen";

export interface BrowserSongEntry<TRawEntry = unknown> {
    source: BrowserSourceId;
    path: string;
    fileName: string;
    tracker: string;
    artist: string;
    title: string;
    ext: string;
    sizeKb: number;
    rawEntry: TRawEntry;
}

export interface BrowserLoadedModule {
    buffer: ArrayBuffer;
    fileName: string;
}

export type BrowserFetchProgressCallback = (progressPercent: number) => void;

export abstract class BrowserSource<TRawEntry> {
    abstract readonly sourceId: BrowserSourceId;
    abstract readonly sourceName: string;

    private entries: BrowserSongEntry<TRawEntry>[] = [];
    private catalogPromise: Promise<BrowserSongEntry<TRawEntry>[]> | null = null;
    private loaded = false;

    hasLoadedEntries(): boolean {
        return this.loaded;
    }

    getLoadedEntries(): BrowserSongEntry<TRawEntry>[] {
        return this.entries;
    }

    async getEntries(): Promise<BrowserSongEntry<TRawEntry>[]> {
        if (this.loaded) {
            return this.entries;
        }

        if (!this.catalogPromise) {
            this.catalogPromise = this.loadEntries()
                .then((entries) => {
                    this.entries = entries;
                    this.loaded = true;
                    return entries;
                })
                .finally(() => {
                    this.catalogPromise = null;
                });
        }

        return this.catalogPromise;
    }

    filterLoadedEntries(query: string): BrowserSongEntry<TRawEntry>[] {
        return this.filterEntries(this.entries, query);
    }

    abstract filterEntries(entries: BrowserSongEntry<TRawEntry>[], query: string): BrowserSongEntry<TRawEntry>[];

    abstract fetchModule(
        entry: BrowserSongEntry<TRawEntry>,
        onProgress?: BrowserFetchProgressCallback,
    ): Promise<BrowserLoadedModule>;

    protected abstract loadEntries(): Promise<BrowserSongEntry<TRawEntry>[]>;
}

export function getSearchTerms(query: string): string[] {
    return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export async function readResponseWithProgress(
    response: Response,
    onProgress?: BrowserFetchProgressCallback,
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
