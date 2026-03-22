import { loadLegacyOpenMpt } from "./lib/legacy-openmpt";
import { BrowserPaneController } from "./features/browser-pane";
import { TrackBrowser, type BrowserSourceId } from "./features/browser";
import type { TrackerElements } from "./types/global";
import { readStorage, readStoredNumber, writeStorage } from "./utils/storage";
import { APP_CONSTANTS } from "./constants";
import { TrackerPlaybackController } from "./tracker";

export class nyantracker {
    private readonly root: HTMLElement;
    private readonly elements: TrackerElements;
    private readonly playbackController: TrackerPlaybackController;
    private readonly browserPane: BrowserPaneController;
    private readonly trackBrowser: TrackBrowser;
    private pendingSharedSong: string | null = null;
    private pendingSharedSongAutoplay = false;
    private browserQuerySyncTimeout: number | null = null;

    constructor(root: HTMLElement, elements: TrackerElements) {
        this.root = root;
        this.elements = elements;
        this.playbackController = new TrackerPlaybackController({
            elements,
            onStatusChange: (status) => this.updateStatus(status),
        });
        this.trackBrowser = new TrackBrowser(
            {
                searchInput: elements.searchInput,
                btnSongPrev: elements.btnSongPrev,
                btnPagePrev: elements.btnPagePrev,
                songPageInfo: elements.songPageInfo,
                btnPageNext: elements.btnPageNext,
                btnSongNext: elements.btnSongNext,
                songList: elements.songList,
                titleDisplay: elements.titleDisplay,
            },
            {
                renderLimit: 300,
                storageKeySearch: APP_CONSTANTS.storageKeySearch,
                onBeforeLoadModule: (entry) => {
                    this.pushBrowserQueryState(entry.path);
                    this.playbackController.prepareForIncomingLoad(entry.fileName, `${entry.artist} - ${entry.title}`);
                },
                onSearchChange: () => {
                    this.scheduleBrowserQueryStateSync();
                },
                onStatusChange: (status) => this.updateStatus(status),
                onLoadModule: async (_entry, buffer, fileName, autoplay) => {
                    await this.playbackController.loadArrayBuffer(buffer, fileName, autoplay);
                },
            },
        );
        this.browserPane = new BrowserPaneController(
            {
                root,
                songSelector: elements.songSelector,
                browserResizer: elements.browserResizer,
                btnToggleBrowser: elements.btnToggleBrowser,
            },
            {
                storageKeyWidth: APP_CONSTANTS.storageKeyBrowserWidth,
                storageKeyOpen: APP_CONSTANTS.storageKeyBrowserOpen,
                minWidth: APP_CONSTANTS.minBrowserWidth,
                minTrackerWidth: APP_CONSTANTS.minTrackerWidth,
                compactMediaQuery: "(width <= 960px)",
                onOpen: async () => {
                    await this.trackBrowser.initCatalog();
                },
                onLayoutChange: () => {
                    this.playbackController.handleLayoutChange();
                },
            },
        );
    }

    async init(): Promise<void> {
        this.restorePersistedState();
        this.bindEvents();
        this.updateSliderOutputs();

        try {
            const legacyModule = await loadLegacyOpenMpt();
            this.playbackController.setLegacyModule(legacyModule);
            this.elements.fileInput.disabled = false;
            this.browserPane.setEnabled(true);
            this.updateStatus("IDLE");
            if (this.browserPane.isOpen()) {
                void this.trackBrowser.initCatalog();
            }
            await this.tryLoadSharedSongFromQuery();
        } catch (error) {
            console.error("Failed to load legacy OpenMPT module:", error);
            this.updateStatus("INITIALIZATION FAILED");
        }
    }

    private bindEvents(): void {
        this.elements.sourceSelect.addEventListener("change", () => {
            const source = this.getSelectedBrowserSource();
            writeStorage(APP_CONSTANTS.storageKeySource, source);
            this.pushBrowserQueryState("");
            void this.trackBrowser.setSource(source);
        });

        this.elements.fileInput.addEventListener("change", async (event) => {
            const target = event.currentTarget as HTMLInputElement;
            const file = target.files?.[0];
            if (!file) {
                return;
            }

            await this.handleUserFile(file);
        });

        this.trackBrowser.bindEvents();
        this.browserPane.bindEvents();

        this.elements.btnPlay.addEventListener("click", () => {
            const paused = this.playbackController.togglePlayback();
            this.updateStatus(paused ? "PAUSED" : "PLAYING");
        });

        this.elements.btnStop.addEventListener("click", () => {
            this.playbackController.handleStopRequested();
            this.updateStatus("STOPPED");
        });

        this.elements.btnPrevPat.addEventListener("click", () => this.playbackController.stepOrder(-1));
        this.elements.btnNextPat.addEventListener("click", () => this.playbackController.stepOrder(1));

        this.elements.btnShowTweaks.addEventListener("click", () => {
            const isHidden = this.elements.tweakBar.classList.toggle("tweak-bar--hidden");
            writeStorage(APP_CONSTANTS.storageKeyTweakbarHidden, String(isHidden));
        });

        this.elements.progressBar.addEventListener("pointerdown", (event) => {
            this.playbackController.handleProgressPointerDown(event);
        });

        this.elements.progressBar.addEventListener("pointermove", (event) => {
            this.playbackController.handleProgressPointerMove(event);
        });

        const stopSeeking = (event: PointerEvent) => {
            this.playbackController.finishSeeking(event);
        };

        this.elements.progressBar.addEventListener("pointerup", stopSeeking);
        this.elements.progressBar.addEventListener("pointercancel", stopSeeking);

        this.elements.volumeSlider.addEventListener("input", () => {
            const value = Number(this.elements.volumeSlider.value);
            this.playbackController.setVolume(value);
            this.elements.volumeOutput.value = `${Math.round(value * 100)}%`;
            writeStorage(APP_CONSTANTS.storageKeyVolume, String(value));
        });

        this.elements.pitchSlider.addEventListener("input", () => {
            const value = Number(this.elements.pitchSlider.value);
            this.playbackController.setPitch(value);
            this.elements.pitchOutput.value = `${value.toFixed(2)}x`;
        });

        this.elements.tempoSlider.addEventListener("input", () => {
            const value = Number(this.elements.tempoSlider.value);
            this.playbackController.setTempo(value);
            this.elements.tempoOutput.value = `${value.toFixed(2)}x`;
        });

        window.addEventListener("resize", () => {
            this.browserPane.applyResponsiveLayoutState();
            this.playbackController.handleLayoutChange();
        });

        ["dragenter", "dragover"].forEach((eventName) => {
            this.root.addEventListener(eventName, (event) => {
                event.preventDefault();
                this.elements.dropIndicator.classList.add("drop-indicator--active");
            });
        });

        ["dragleave", "drop"].forEach((eventName) => {
            this.root.addEventListener(eventName, (event) => {
                event.preventDefault();
                this.elements.dropIndicator.classList.remove("drop-indicator--active");
            });
        });

        this.root.addEventListener("drop", async (event) => {
            const file = event.dataTransfer?.files?.[0];
            if (!file) {
                return;
            }

            await this.handleUserFile(file);
        });

        this.playbackController.bindOscResizer();
        this.playbackController.bindPatternResizeObserver();
    }

    private async handleUserFile(file: File): Promise<void> {
        this.pendingSharedSongAutoplay = true;
        this.trackBrowser.setActiveSong(file.name);
        this.pushBrowserQueryState(file.name);
        await this.playbackController.loadFile(file);
    }

    private updateSliderOutputs(): void {
        this.elements.volumeOutput.value = `${Math.round(Number(this.elements.volumeSlider.value) * 100)}%`;
        this.elements.pitchOutput.value = `${Number(this.elements.pitchSlider.value).toFixed(2)}x`;
        this.elements.tempoOutput.value = `${Number(this.elements.tempoSlider.value).toFixed(2)}x`;
    }

    private getBrowserQueryState(): { search: string; type: BrowserSourceId; playing: string } {
        const params = new URLSearchParams(window.location.search);
        return {
            search: params.get(APP_CONSTANTS.queryKeySearch)?.trim() ?? "",
            type: this.parseBrowserSource(params.get(APP_CONSTANTS.queryKeyType)),
            playing: params.get(APP_CONSTANTS.queryKeyPlaying)?.trim() ?? "",
        };
    }

    private pushBrowserQueryState(playingOverride?: string): void {
        this.clearScheduledBrowserQueryStateSync();

        const params = new URLSearchParams(window.location.search);
        const search = this.elements.searchInput.value.trim();
        const type = this.getSelectedBrowserSource();
        const activeEntry = this.trackBrowser.getActiveEntry();
        const playing = playingOverride ?? activeEntry?.path ?? "";

        if (search) {
            params.set(APP_CONSTANTS.queryKeySearch, search);
        } else {
            params.delete(APP_CONSTANTS.queryKeySearch);
        }

        params.set(APP_CONSTANTS.queryKeyType, type);

        if (playing) {
            params.set(APP_CONSTANTS.queryKeyPlaying, playing);
        } else {
            params.delete(APP_CONSTANTS.queryKeyPlaying);
        }

        const query = params.toString();
        const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
        window.history.replaceState(null, "", nextUrl);
    }

    private scheduleBrowserQueryStateSync(): void {
        this.clearScheduledBrowserQueryStateSync();
        this.browserQuerySyncTimeout = window.setTimeout(() => {
            this.browserQuerySyncTimeout = null;
            this.pushBrowserQueryState();
        }, APP_CONSTANTS.searchQuerySyncDelayMs);
    }

    private clearScheduledBrowserQueryStateSync(): void {
        if (this.browserQuerySyncTimeout === null) {
            return;
        }

        window.clearTimeout(this.browserQuerySyncTimeout);
        this.browserQuerySyncTimeout = null;
    }

    private async tryLoadSharedSongFromQuery(): Promise<void> {
        const sharedSong = this.pendingSharedSong;
        if (!sharedSong) {
            return;
        }

        this.pendingSharedSong = null;
        const loaded = await this.trackBrowser.loadSongByPath(sharedSong, this.pendingSharedSongAutoplay);
        if (!loaded) {
            this.pendingSharedSong = sharedSong;
        }
    }

    private getSelectedBrowserSource(): BrowserSourceId {
        return this.parseBrowserSource(this.elements.sourceSelect.value);
    }

    private parseBrowserSource(value: string | null): BrowserSourceId {
        return value === "keygen" ? "keygen" : "modland";
    }

    private updateStatus(status: string): void {
        this.elements.topStatus.textContent = status;
    }

    private restorePersistedState(): void {
        const queryState = this.getBrowserQueryState();
        const savedSource = this.parseBrowserSource(queryState.type || readStorage(APP_CONSTANTS.storageKeySource));
        this.elements.sourceSelect.value = savedSource;
        void this.trackBrowser.setSource(savedSource, false);

        const initialSearch = queryState.search || readStorage(APP_CONSTANTS.storageKeySearch) || "";
        if (initialSearch) {
            this.trackBrowser.setSearchQuery(initialSearch);
        }

        this.pendingSharedSong = queryState.playing || null;
        this.pendingSharedSongAutoplay = false;

        const savedVolume = readStoredNumber(APP_CONSTANTS.storageKeyVolume);
        if (savedVolume !== null) {
            const min = Number(this.elements.volumeSlider.min || 0);
            const max = Number(this.elements.volumeSlider.max || 1);
            const clampedVolume = Math.min(max, Math.max(min, savedVolume));
            this.elements.volumeSlider.value = String(clampedVolume);
        }

        const tweakBarHidden = readStorage(APP_CONSTANTS.storageKeyTweakbarHidden) === "true";
        this.elements.tweakBar.classList.toggle("tweak-bar--hidden", tweakBarHidden);

        this.browserPane.restorePersistedState();
        this.playbackController.restorePersistedState();
    }
}
