import { cssEscape } from "../utils/css-escape";
import { getBrowserSource, type BrowserSongEntry, type BrowserSourceId } from "../sources";
import { readStorage, writeStorage } from "../utils/storage";

export type { BrowserSongEntry, BrowserSourceId } from "../sources";

export interface TrackBrowserElements {
    searchInput: HTMLInputElement;
    btnSongPrev: HTMLButtonElement;
    btnPagePrev: HTMLButtonElement;
    songPageInfo: HTMLElement;
    btnPageNext: HTMLButtonElement;
    btnSongNext: HTMLButtonElement;
    songList: HTMLElement;
    titleDisplay: HTMLElement;
}

export interface TrackBrowserOptions {
    renderLimit: number;
    storageKeySearch: string;
    onBeforeLoadModule?: (entry: BrowserSongEntry) => void;
    onSearchChange?: (query: string) => void;
    onStatusChange: (status: string) => void;
    onLoadModule: (entry: BrowserSongEntry, buffer: ArrayBuffer, fileName: string, autoplay: boolean) => Promise<void>;
}

export class TrackBrowser {
    private readonly elements: TrackBrowserElements;
    private readonly options: TrackBrowserOptions;
    private filteredEntries: BrowserSongEntry[] = [];
    private sourceId: BrowserSourceId = "modland";
    private activePath = "";
    private selectedSongItem: HTMLElement | null = null;
    private page = 0;
    private loading = false;
    private loadingSongItem: HTMLElement | null = null;

    constructor(elements: TrackBrowserElements, options: TrackBrowserOptions) {
        this.elements = elements;
        this.options = options;
    }

    restorePersistedState(): void {
        const savedSearch = readStorage(this.options.storageKeySearch);
        if (savedSearch !== null) {
            this.elements.searchInput.value = savedSearch;
        }
    }

    setSearchQuery(query: string): void {
        this.elements.searchInput.value = query;
        writeStorage(this.options.storageKeySearch, query);
        this.applyFilter();
    }

    getActiveEntry(): BrowserSongEntry | null {
        if (!this.activePath) {
            return null;
        }

        return (
            this.getCurrentEntries().find(
                (entry) => entry.path === this.activePath || entry.fileName === this.activePath,
            ) ?? null
        );
    }

    async setSource(sourceId: BrowserSourceId, autoLoad = true): Promise<void> {
        this.sourceId = sourceId;
        this.page = 0;
        const source = this.getSource();

        if (source.hasLoadedEntries()) {
            this.applyFilter();
            return;
        }

        this.filteredEntries = [];
        this.selectedSongItem = null;
        this.elements.songList.replaceChildren();
        this.updatePagination(0, 0, autoLoad ? "Loading..." : "0/0");

        if (autoLoad) {
            await this.initCatalog();
        }
    }

    bindEvents(): void {
        this.elements.searchInput.addEventListener("input", () => {
            const query = this.elements.searchInput.value;
            writeStorage(this.options.storageKeySearch, query);
            this.options.onSearchChange?.(query);
            this.applyFilter();
        });

        this.elements.btnPagePrev.addEventListener("click", () => {
            if (this.page <= 0) {
                return;
            }

            this.page -= 1;
            this.renderSongList();
        });

        this.elements.btnPageNext.addEventListener("click", () => {
            const totalPages = this.getTotalPages();
            if (this.page >= totalPages - 1) {
                return;
            }

            this.page += 1;
            this.renderSongList();
        });

        this.elements.btnSongPrev.addEventListener("click", () => {
            void this.loadRelativeSong(-1);
        });

        this.elements.btnSongNext.addEventListener("click", () => {
            void this.loadRelativeSong(1);
        });
    }

    async initCatalog(): Promise<void> {
        const source = this.getSource();
        if (source.hasLoadedEntries()) {
            this.applyFilter();
            return;
        }

        this.updatePagination(0, 0, "Loading...");

        const sourceId = this.sourceId;
        try {
            await this.getSource(sourceId).getEntries();

            if (this.sourceId === sourceId) {
                this.applyFilter();
                this.options.onStatusChange("IDLE");
            }
        } catch (error) {
            console.error(`Failed to load ${sourceId} catalog:`, error);
            if (this.sourceId === sourceId) {
                this.updatePagination(0, 0, "Unavailable");
                this.options.onStatusChange(`${sourceId.toUpperCase()} CATALOG FAILED`);
            }
        }
    }

    async loadSongByPath(pathOrFileName: string, autoplay = true): Promise<boolean> {
        const normalized = pathOrFileName.trim();
        if (!normalized) {
            return false;
        }

        await this.initCatalog();

        const entry =
            this.filteredEntries.find((candidate) => this.matchesEntry(candidate, normalized)) ??
            this.getCurrentEntries().find((candidate) => this.matchesEntry(candidate, normalized));
        if (!entry) {
            return false;
        }

        const filteredIndex = this.filteredEntries.findIndex((candidate) => candidate.path === entry.path);
        if (filteredIndex >= 0) {
            this.page = Math.floor(filteredIndex / this.options.renderLimit);
            this.renderSongList();
        }

        await this.loadEntry(entry, autoplay);
        return true;
    }

    setActiveSong(pathOrFileName: string): void {
        this.activePath = pathOrFileName;
        if (this.selectedSongItem) {
            this.selectedSongItem.classList.remove("active");
            this.selectedSongItem = null;
        }

        const next = this.elements.songList.querySelector<HTMLElement>(
            `.song-item[data-path="${cssEscape(pathOrFileName)}"]`,
        );
        if (next) {
            next.classList.add("active");
            this.selectedSongItem = next;
            this.scrollSelectedSongIntoView();
        }
    }

    private setLoadingState(loading: boolean): void {
        this.loading = loading;
        this.elements.songList.classList.toggle("disabled", loading);
        this.elements.songList.setAttribute("aria-busy", String(loading));
        this.elements.searchInput.disabled = loading;
        this.updatePagination(this.getVisibleCountForCurrentPage(), this.filteredEntries.length);
    }

    private updateLoadingProgress(progressPercent: number): void {
        if (!this.loadingSongItem) return;

        const roundedProgress = Math.max(0, Math.min(100, Math.round(progressPercent)));
        this.loadingSongItem.classList.add("fetching");
        this.loadingSongItem.style.setProperty("--fetching-progress", `${roundedProgress}%`);
        this.loadingSongItem.dataset.fetchingLabel = `${roundedProgress}%`;
        this.loadingSongItem.setAttribute("aria-label", `Fetching module ${roundedProgress}%`);
    }

    private clearLoadingProgress(): void {
        if (!this.loadingSongItem) return;

        this.loadingSongItem.classList.remove("fetching");
        this.loadingSongItem.style.removeProperty("--fetching-progress");
        delete this.loadingSongItem.dataset.fetchingLabel;
        this.loadingSongItem.removeAttribute("aria-label");
        this.loadingSongItem = null;
    }

    private getVisibleCountForCurrentPage(): number {
        if (this.filteredEntries.length <= 0) {
            return 0;
        }

        const pageStart = this.page * this.options.renderLimit;
        return this.filteredEntries.slice(pageStart, pageStart + this.options.renderLimit).length;
    }

    private applyFilter(): void {
        if (this.loading) {
            return;
        }

        this.filteredEntries = this.getSource().filterLoadedEntries(this.elements.searchInput.value);
        this.page = 0;
        this.renderSongList();
    }

    private renderSongList(): void {
        this.elements.songList.replaceChildren();
        this.selectedSongItem = null;

        const totalPages = this.getTotalPages();
        if (totalPages === 0) {
            this.page = 0;
        } else if (this.page > totalPages - 1) {
            this.page = totalPages - 1;
        }

        const pageStart = this.page * this.options.renderLimit;
        const entriesToRender = this.filteredEntries.slice(pageStart, pageStart + this.options.renderLimit);
        const fragment = document.createDocumentFragment();

        for (const entry of entriesToRender) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "song-item";
            item.dataset.path = entry.path;
            if (entry.path === this.activePath) {
                item.classList.add("active");
                this.selectedSongItem = item;
            }

            const title = document.createElement("span");
            title.className = "title";

            const titleText = document.createElement("span");
            titleText.className = "title-text";
            titleText.textContent = entry.title || entry.fileName;
            title.appendChild(titleText);

            const bottom = document.createElement("div");
            bottom.className = "bottom";

            const artist = document.createElement("span");
            artist.className = "artist";
            artist.textContent = entry.artist || "Unknown";

            const info = document.createElement("span");
            info.className = "info";
            info.textContent = `${entry.tracker} · ${entry.ext.toUpperCase()} · ${entry.sizeKb.toFixed(1)}KB`;

            bottom.append(artist, info);
            item.append(title, bottom);
            item.addEventListener("click", () => {
                void this.loadEntry(entry);
            });
            fragment.appendChild(item);
        }

        if (entriesToRender.length === 0) {
            const empty = document.createElement("div");
            empty.className = "song-list-empty";
            empty.textContent =
                this.getCurrentEntries().length === 0 ? "No songs loaded yet." : "No matching playable songs.";
            fragment.appendChild(empty);
            this.selectedSongItem = null;
        }

        this.elements.songList.appendChild(fragment);
        this.updatePagination(entriesToRender.length, this.filteredEntries.length);
    }

    private async loadEntry(entry: BrowserSongEntry, autoplay = true): Promise<void> {
        if (this.loading) {
            return;
        }

        this.setActiveSong(entry.path);
        this.options.onBeforeLoadModule?.(entry);
        this.elements.titleDisplay.textContent = `${entry.artist} - ${entry.title}`;
        this.options.onStatusChange("FETCHING MODULE... 0%");
        this.loadingSongItem = this.selectedSongItem;
        this.setLoadingState(true);
        this.updateLoadingProgress(0);

        try {
            const module = await this.fetchModule(entry, (progressPercent) => {
                this.updateLoadingProgress(progressPercent);
                this.options.onStatusChange(`FETCHING MODULE... ${Math.round(progressPercent)}%`);
            });
            await this.options.onLoadModule(entry, module.buffer, module.fileName, autoplay);
        } catch (error) {
            console.error(`Failed to load ${entry.source} module:`, error);
            this.options.onStatusChange("MODULE LOAD FAILED");
        } finally {
            this.clearLoadingProgress();
            this.setLoadingState(false);
        }
    }

    private updatePagination(visibleCount: number, totalCount: number, label?: string): void {
        if (label) {
            this.elements.songPageInfo.textContent = label;
        } else if (totalCount <= 0 || visibleCount <= 0) {
            this.elements.songPageInfo.textContent = `0/${totalCount}`;
        } else {
            const start = this.page * this.options.renderLimit + 1;
            const end = start + visibleCount - 1;
            this.elements.songPageInfo.textContent = `${start}-${end}/${totalCount}`;
        }

        const totalPages = Math.max(1, this.getTotalPages(totalCount));
        const hasEntries = totalCount > 0;
        const activeEntryIndex = this.getActiveFilteredEntryIndex();
        this.elements.btnPagePrev.disabled = this.loading || !hasEntries || this.page <= 0;
        this.elements.btnPageNext.disabled = this.loading || !hasEntries || this.page >= totalPages - 1;
        this.elements.btnSongPrev.disabled = this.loading || activeEntryIndex <= 0;
        this.elements.btnSongNext.disabled = this.loading || activeEntryIndex < 0 || activeEntryIndex >= totalCount - 1;
    }

    private getTotalPages(totalCount = this.filteredEntries.length): number {
        if (totalCount <= 0) {
            return 0;
        }

        return Math.ceil(totalCount / this.options.renderLimit);
    }

    private getActiveFilteredEntryIndex(): number {
        if (!this.activePath) {
            return -1;
        }

        return this.filteredEntries.findIndex((entry) => this.matchesEntry(entry, this.activePath));
    }

    private scrollSelectedSongIntoView(): void {
        this.selectedSongItem?.scrollIntoView({
            block: "nearest",
            inline: "nearest",
        });
    }

    private async loadRelativeSong(offset: -1 | 1): Promise<void> {
        if (this.loading) {
            return;
        }

        const currentIndex = this.getActiveFilteredEntryIndex();
        if (currentIndex < 0) {
            return;
        }

        const nextIndex = currentIndex + offset;
        if (nextIndex < 0 || nextIndex >= this.filteredEntries.length) {
            return;
        }

        const nextEntry = this.filteredEntries[nextIndex];
        this.page = Math.floor(nextIndex / this.options.renderLimit);
        this.renderSongList();
        await this.loadEntry(nextEntry);
    }

    private matchesEntry(entry: BrowserSongEntry, pathOrFileName: string): boolean {
        return entry.path === pathOrFileName || entry.fileName === pathOrFileName;
    }

    private getCurrentEntries(): BrowserSongEntry[] {
        return this.getSource().getLoadedEntries();
    }

    private async fetchModule(
        entry: BrowserSongEntry,
        onProgress: (progressPercent: number) => void,
    ): Promise<{ buffer: ArrayBuffer; fileName: string }> {
        return this.getSource(entry.source).fetchModule(entry, onProgress);
    }

    private getSource(sourceId = this.sourceId) {
        return getBrowserSource(sourceId);
    }
}
