import { cssEscape } from "../utils/css-escape";
import { fetchModlandCatalog, fetchModlandModule, filterModlandEntries, type ModlandEntry } from "../lib/modland";
import { readStorage, writeStorage } from "../utils/storage";

export interface ModlandBrowserElements {
    searchInput: HTMLInputElement;
    btnSongPrev: HTMLButtonElement;
    songPageInfo: HTMLElement;
    btnSongNext: HTMLButtonElement;
    songList: HTMLElement;
    titleDisplay: HTMLElement;
}

export interface ModlandBrowserOptions {
    renderLimit: number;
    storageKeySearch: string;
    onBeforeLoadModule?: (entry: ModlandEntry) => void;
    onStatusChange: (status: string) => void;
    onLoadModule: (entry: ModlandEntry, buffer: ArrayBuffer, fileName: string) => Promise<void>;
}

export class ModlandBrowser {
    private readonly elements: ModlandBrowserElements;
    private readonly options: ModlandBrowserOptions;
    private entries: ModlandEntry[] = [];
    private filteredEntries: ModlandEntry[] = [];
    private activePath = "";
    private selectedSongItem: HTMLElement | null = null;
    private page = 0;
    private catalogLoaded = false;
    private catalogPromise: Promise<void> | null = null;
    private loading = false;
    private loadingSongItem: HTMLElement | null = null;

    constructor(elements: ModlandBrowserElements, options: ModlandBrowserOptions) {
        this.elements = elements;
        this.options = options;
    }

    restorePersistedState(): void {
        const savedSearch = readStorage(this.options.storageKeySearch);
        if (savedSearch !== null) {
            this.elements.searchInput.value = savedSearch;
        }
    }

    bindEvents(): void {
        this.elements.searchInput.addEventListener("input", () => {
            writeStorage(this.options.storageKeySearch, this.elements.searchInput.value);
            this.applyFilter();
        });

        this.elements.btnSongPrev.addEventListener("click", () => {
            if (this.page <= 0) {
                return;
            }

            this.page -= 1;
            this.renderSongList();
        });

        this.elements.btnSongNext.addEventListener("click", () => {
            const totalPages = this.getTotalPages();
            if (this.page >= totalPages - 1) {
                return;
            }

            this.page += 1;
            this.renderSongList();
        });
    }

    async initCatalog(): Promise<void> {
        if (this.catalogLoaded) {
            return;
        }

        if (this.catalogPromise) {
            return this.catalogPromise;
        }

        this.updatePagination(0, 0, "Loading...");

        this.catalogPromise = (async () => {
            try {
                this.entries = await fetchModlandCatalog();
                this.catalogLoaded = true;
                this.applyFilter();
                this.options.onStatusChange("IDLE");
            } catch (error) {
                console.error("Failed to load Modland catalog:", error);
                this.updatePagination(0, 0, "Unavailable");
                this.options.onStatusChange("MODLAND CATALOG FAILED");
            } finally {
                this.catalogPromise = null;
            }
        })();

        return this.catalogPromise;
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

        this.filteredEntries = filterModlandEntries(this.entries, this.elements.searchInput.value);
        this.page = 0;
        this.renderSongList();
    }

    private renderSongList(): void {
        this.elements.songList.replaceChildren();

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
            titleText.textContent = entry.title || entry.archiveEntryName;
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
            empty.textContent = this.entries.length === 0 ? "No songs loaded yet." : "No matching playable songs.";
            fragment.appendChild(empty);
            this.selectedSongItem = null;
        }

        this.elements.songList.appendChild(fragment);
        this.updatePagination(entriesToRender.length, this.filteredEntries.length);
    }

    private async loadEntry(entry: ModlandEntry): Promise<void> {
        if (this.loading) {
            return;
        }

        this.options.onBeforeLoadModule?.(entry);
        this.setActiveSong(entry.path);
        this.elements.titleDisplay.textContent = `${entry.artist} - ${entry.title}`;
        this.options.onStatusChange("FETCHING MODULE... 0%");
        this.loadingSongItem = this.selectedSongItem;
        this.setLoadingState(true);
        this.updateLoadingProgress(0);

        try {
            const module = await fetchModlandModule(entry, (progressPercent) => {
                this.updateLoadingProgress(progressPercent);
                this.options.onStatusChange(`FETCHING MODULE... ${Math.round(progressPercent)}%`);
            });
            await this.options.onLoadModule(entry, module.buffer, module.fileName);
        } catch (error) {
            console.error("Failed to load Modland module:", error);
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
        this.elements.btnSongPrev.disabled = this.loading || !hasEntries || this.page <= 0;
        this.elements.btnSongNext.disabled = this.loading || !hasEntries || this.page >= totalPages - 1;
    }

    private getTotalPages(totalCount = this.filteredEntries.length): number {
        if (totalCount <= 0) {
            return 0;
        }

        return Math.ceil(totalCount / this.options.renderLimit);
    }
}
