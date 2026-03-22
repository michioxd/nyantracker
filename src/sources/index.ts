import { type BrowserSource, type BrowserSourceId } from "./base";
import { keygenSource } from "./keygen";
import { modlandSource } from "./modland";

const browserSources: Record<BrowserSourceId, BrowserSource<unknown>> = {
    modland: modlandSource,
    keygen: keygenSource,
};

const browserSourceList = [modlandSource, keygenSource] as const;

export function getBrowserSource(sourceId: BrowserSourceId): BrowserSource<unknown> {
    return browserSources[sourceId];
}

export function getBrowserSources(): readonly BrowserSource<unknown>[] {
    return browserSourceList;
}

export { browserSources };
export type { BrowserFetchProgressCallback, BrowserLoadedModule, BrowserSongEntry, BrowserSourceId } from "./base";
