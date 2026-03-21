import type { ChiptuneMetadata, ChiptuneProgress } from "chiptune3";
import { loadLegacyOpenMpt, type LegacyOpenMptModule } from "./lib/legacy-openmpt";
import {
    formatCounter,
    formatDuration,
    getNoteFrequency,
    readPatternCell,
    type PatternCell,
} from "./components/formatters";
import { OscilloscopeRenderer } from "./components/oscilloscope";
import { PatternView } from "./components/pattern-view";
import { PlayerController } from "./components/player-controller";
import { BrowserPaneController } from "./features/browser-pane";
import { ModlandBrowser } from "./features/modland-browser";
import { readStorage, readStoredNumber, writeStorage } from "./utils/storage";

interface TrackerElements {
    songSelector: HTMLElement;
    browserResizer: HTMLElement;
    btnToggleBrowser: HTMLButtonElement;
    searchInput: HTMLInputElement;
    btnSongPrev: HTMLButtonElement;
    songPageInfo: HTMLElement;
    btnSongNext: HTMLButtonElement;
    songList: HTMLElement;
    fileInput: HTMLInputElement;
    fileLabel: HTMLLabelElement;
    btnPrevPat: HTMLButtonElement;
    btnPlay: HTMLButtonElement;
    btnNextPat: HTMLButtonElement;
    btnStop: HTMLButtonElement;
    btnShowTweaks: HTMLButtonElement;
    tweakBar: HTMLElement;
    progressCurrent: HTMLElement;
    progressTotal: HTMLElement;
    progressBar: HTMLElement;
    progressHandler: HTMLElement;
    progressFill: HTMLElement;
    posDisplay: HTMLElement;
    patDisplay: HTMLElement;
    rowDisplay: HTMLElement;
    topStatus: HTMLElement;
    titleDisplay: HTMLElement;
    volumeSlider: HTMLInputElement;
    volumeOutput: HTMLOutputElement;
    pitchSlider: HTMLInputElement;
    pitchOutput: HTMLOutputElement;
    tempoSlider: HTMLInputElement;
    tempoOutput: HTMLOutputElement;
    mainContainer: HTMLElement;
    patternViewContainer: HTMLElement;
    patternHeader: HTMLElement;
    patternBody: HTMLElement;
    oscResizer: HTMLElement;
    oscView: HTMLElement;
    dropZone: HTMLElement;
    dropIndicator: HTMLElement;
}

export class nyantracker {
    private static readonly SAMPLE_RATE = 48000;
    private static readonly READ_CHUNK_SIZE = 4096;
    private static readonly STORAGE_KEY_TWEAKBAR_HIDDEN = "nyantracker:tweakbar-hidden";
    private static readonly STORAGE_KEY_VOLUME = "nyantracker:volume";
    private static readonly STORAGE_KEY_SEARCH = "nyantracker:modland-search";
    private static readonly STORAGE_KEY_BROWSER_WIDTH = "nyantracker:browser-width";
    private static readonly STORAGE_KEY_BROWSER_OPEN = "nyantracker:browser-open";
    private static readonly STORAGE_KEY_OSC_HEIGHT = "nyantracker:osc-height";
    private static readonly MIN_BROWSER_WIDTH = 280;
    private static readonly MIN_TRACKER_WIDTH = 520;
    private static readonly MIN_OSC_HEIGHT = 200;
    private static readonly PATTERN_MIN_HEIGHT = 120;
    private static readonly OSC_HIDE_THRESHOLD = nyantracker.MIN_OSC_HEIGHT / 2;
    private fractionalFrames = 0;
    private readonly root: HTMLElement;
    private readonly elements: TrackerElements;
    private legacyModule: LegacyOpenMptModule | null = null;
    private uiModulePtr = 0;
    private dummyBufferPtr = 0;
    private readonly maxChannels = 64;
    private numChannels = 0;
    private currentRow = -1;
    private lastFrameTime = 0;
    private uiLoopStarted = false;
    private currentFileName = "--";
    private durationSeconds = 0;
    private seeking = false;
    private lastSeekTime = 0;
    private totalOrders = 0;
    private totalPatterns = 0;
    private lastProgressPercent = -1;
    private lastProgressCurrentLabel = "";
    private lastProgressTotalLabel = "";
    private patternCache = new Map<number, PatternCell[][]>();
    private readonly patternPrefetchQueue: number[] = [];
    private readonly patternPrefetchInFlight = new Set<number>();
    private readonly orderStartSeconds = new Map<number, number>();
    private readonly patternRowCounts = new Map<number, number>();
    private readonly channelFreqs = new Float32Array(this.maxChannels);
    private readonly channelInstruments = new Uint8Array(this.maxChannels);
    private readonly channelCanvases = new Array<HTMLCanvasElement | null>(this.maxChannels).fill(null);
    private readonly channelVuFills = new Array<HTMLElement | null>(this.maxChannels).fill(null);
    private readonly oscilloscopeRenderer = new OscilloscopeRenderer();
    private readonly patternView: PatternView;
    private readonly player: PlayerController;
    private readonly browserPane: BrowserPaneController;
    private readonly modlandBrowser: ModlandBrowser;
    private requestedPatternIndex = -1;
    private patternPrefetchScheduled = false;
    private patternResizeObserver: ResizeObserver | null = null;
    private patternLayoutSyncScheduled = false;
    private preferredOscHeight: number | null = null;
    private preferredOscHidden = false;

    constructor(root: HTMLElement, elements: TrackerElements) {
        this.root = root;
        this.elements = elements;
        this.patternView = new PatternView(elements.patternHeader, elements.patternBody, elements.oscView);
        this.modlandBrowser = new ModlandBrowser(
            {
                searchInput: elements.searchInput,
                btnSongPrev: elements.btnSongPrev,
                songPageInfo: elements.songPageInfo,
                btnSongNext: elements.btnSongNext,
                songList: elements.songList,
                titleDisplay: elements.titleDisplay,
            },
            {
                renderLimit: 300,
                storageKeySearch: nyantracker.STORAGE_KEY_SEARCH,
                onBeforeLoadModule: (entry) => {
                    this.prepareForIncomingLoad(entry.archiveEntryName, `${entry.artist} - ${entry.title}`);
                },
                onStatusChange: (status) => this.updateStatus(status),
                onLoadModule: async (_entry, buffer, fileName) => {
                    await this.loadArrayBuffer(buffer, fileName);
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
                storageKeyWidth: nyantracker.STORAGE_KEY_BROWSER_WIDTH,
                storageKeyOpen: nyantracker.STORAGE_KEY_BROWSER_OPEN,
                minWidth: nyantracker.MIN_BROWSER_WIDTH,
                minTrackerWidth: nyantracker.MIN_TRACKER_WIDTH,
                compactMediaQuery: "(width <= 960px)",
                onOpen: async () => {
                    await this.modlandBrowser.initCatalog();
                },
                onLayoutChange: () => {
                    this.schedulePatternLayoutSync();
                },
            },
        );
        this.player = new PlayerController(
            {
                onReady: () => {
                    this.elements.fileInput.disabled = false;
                },
                onMetadata: (metadata) => this.handleMetadata(metadata),
                onProgress: (progress) => this.handleProgress(progress),
                onError: (message) => this.updateStatus(message),
                onEnded: () => {
                    this.player.stop();
                    this.resetTrackerViewToStart();
                    this.updateStatus("STOPPED");
                },
            },
            0,
        );
    }

    async init(): Promise<void> {
        this.restorePersistedState();
        this.modlandBrowser.restorePersistedState();
        this.bindEvents();
        this.updateSliderOutputs();

        try {
            this.legacyModule = await loadLegacyOpenMpt();
            this.elements.fileInput.disabled = false;
            this.browserPane.setEnabled(true);
            this.updateStatus("IDLE");
            if (this.browserPane.isOpen()) {
                void this.modlandBrowser.initCatalog();
            }
        } catch (e) {
            console.error("Failed to load legacy OpenMPT module:", e);
            this.updateStatus("INITIALIZATION FAILED");
        }
    }

    private bindEvents(): void {
        this.elements.fileInput.addEventListener("change", async (event) => {
            const target = event.currentTarget as HTMLInputElement;
            const file = target.files?.[0];
            if (!file) {
                return;
            }
            await this.loadFile(file);
        });
        this.modlandBrowser.bindEvents();

        this.browserPane.bindEvents();

        this.elements.btnPlay.addEventListener("click", () => {
            const paused = this.player.togglePlayback();
            if (!paused) {
                this.lastFrameTime = performance.now();
            }
            this.updateStatus(paused ? "PAUSED" : "PLAYING");
        });

        this.elements.btnStop.addEventListener("click", () => {
            this.player.stop();
            this.resetTrackerViewToStart();
            this.updateProgressUi(0, this.durationSeconds || this.player.instance?.duration || 0);
            this.updateStatus("STOPPED");
        });

        this.elements.btnPrevPat.addEventListener("click", () => this.stepOrder(-1));
        this.elements.btnNextPat.addEventListener("click", () => this.stepOrder(1));

        this.elements.btnShowTweaks.addEventListener("click", () => {
            const isHidden = this.elements.tweakBar.classList.toggle("tweak-bar--hidden");
            writeStorage(nyantracker.STORAGE_KEY_TWEAKBAR_HIDDEN, String(isHidden));
        });

        this.elements.progressBar.addEventListener("pointerdown", (event) => {
            if (!this.durationSeconds) {
                return;
            }

            this.seeking = true;
            this.elements.progressBar.setPointerCapture(event.pointerId);
            this.seekFromClientX(event.clientX);
        });

        this.elements.progressBar.addEventListener("pointermove", (event) => {
            if (!this.seeking) {
                return;
            }

            this.seekFromClientX(event.clientX);
        });

        const stopSeeking = (event: PointerEvent) => {
            if (!this.seeking) {
                return;
            }

            this.seeking = false;
            if (this.elements.progressBar.hasPointerCapture(event.pointerId)) {
                this.elements.progressBar.releasePointerCapture(event.pointerId);
            }
        };

        this.elements.progressBar.addEventListener("pointerup", stopSeeking);
        this.elements.progressBar.addEventListener("pointercancel", stopSeeking);

        this.elements.volumeSlider.addEventListener("input", () => {
            const value = Number(this.elements.volumeSlider.value);
            this.player.setVolume(value);
            this.elements.volumeOutput.value = `${Math.round(value * 100)}%`;
            writeStorage(nyantracker.STORAGE_KEY_VOLUME, String(value));
        });

        this.elements.pitchSlider.addEventListener("input", () => {
            const value = Number(this.elements.pitchSlider.value);
            this.player.setPitch(value);
            this.elements.pitchOutput.value = `${value.toFixed(2)}x`;
        });

        this.elements.tempoSlider.addEventListener("input", () => {
            const value = Number(this.elements.tempoSlider.value);
            this.player.setTempo(value);
            this.elements.tempoOutput.value = `${value.toFixed(2)}x`;
        });

        window.addEventListener("resize", () => {
            this.applyResponsiveLayoutState();
            this.schedulePatternLayoutSync();
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
            await this.loadFile(file);
        });

        this.bindResizers();
        this.bindPatternResizeObserver();
    }

    private updateSliderOutputs(): void {
        this.elements.volumeOutput.value = `${Math.round(Number(this.elements.volumeSlider.value) * 100)}%`;
        this.elements.pitchOutput.value = `${Number(this.elements.pitchSlider.value).toFixed(2)}x`;
        this.elements.tempoOutput.value = `${Number(this.elements.tempoSlider.value).toFixed(2)}x`;
    }

    private bindResizers(): void {
        this.browserPane.bindResizers();

        this.elements.oscResizer.addEventListener("pointerdown", (event) => {
            if (this.isCompactLayout()) {
                return;
            }

            const startY = event.clientY;
            const startHeight = this.isOscHidden() ? 0 : this.elements.oscView.getBoundingClientRect().height;

            this.beginResizeGesture(this.elements.oscResizer, event.pointerId, (moveEvent) => {
                const proposedHeight = startHeight - (moveEvent.clientY - startY);
                this.applyOscHeight(proposedHeight);
            });
        });

        this.applyResponsiveLayoutState();
    }

    private bindPatternResizeObserver(): void {
        this.patternResizeObserver?.disconnect();
        this.patternResizeObserver = new ResizeObserver(() => {
            this.schedulePatternLayoutSync();
        });
        this.patternResizeObserver.observe(this.elements.patternViewContainer);
    }

    private schedulePatternLayoutSync(): void {
        if (this.patternLayoutSyncScheduled) {
            return;
        }

        this.patternLayoutSyncScheduled = true;
        requestAnimationFrame(() => {
            this.patternLayoutSyncScheduled = false;
            this.patternView.updatePadding();
            if (this.currentRow >= 0) {
                this.patternView.highlightRow(this.currentRow);
            }
        });
    }

    private beginResizeGesture(handle: HTMLElement, pointerId: number, onMove: (event: PointerEvent) => void): void {
        handle.classList.add("is-resizing");
        handle.setPointerCapture(pointerId);

        const stop = () => {
            handle.classList.remove("is-resizing");
            if (handle.hasPointerCapture(pointerId)) {
                handle.releasePointerCapture(pointerId);
            }

            handle.removeEventListener("pointermove", onPointerMove);
            handle.removeEventListener("pointerup", onPointerUp);
            handle.removeEventListener("pointercancel", onPointerUp);
        };

        const onPointerMove = (event: PointerEvent) => {
            onMove(event);
        };

        const onPointerUp = () => {
            stop();
        };

        handle.addEventListener("pointermove", onPointerMove);
        handle.addEventListener("pointerup", onPointerUp);
        handle.addEventListener("pointercancel", onPointerUp);
    }

    private applyResponsiveLayoutState(): void {
        this.browserPane.applyResponsiveLayoutState();

        if (this.isCompactLayout()) {
            this.elements.oscView.classList.remove("osc-view--hidden");
            this.elements.oscView.style.height = "";
            return;
        }

        if (this.preferredOscHidden) {
            this.applyOscHiddenState(false);
            return;
        }

        const currentOscHeight = this.elements.oscView.getBoundingClientRect().height;
        this.applyOscHeight(this.preferredOscHeight ?? (currentOscHeight || nyantracker.MIN_OSC_HEIGHT), false);
    }

    private isCompactLayout(): boolean {
        return window.matchMedia("(width <= 960px)").matches;
    }

    private getMaxOscHeight(): number {
        const containerHeight = this.elements.mainContainer.getBoundingClientRect().height;
        const statusHeight = this.elements.topStatus.parentElement?.getBoundingClientRect().height ?? 0;
        const resizerHeight = this.elements.oscResizer.getBoundingClientRect().height;
        return Math.max(
            nyantracker.MIN_OSC_HEIGHT,
            containerHeight - statusHeight - resizerHeight - nyantracker.PATTERN_MIN_HEIGHT,
        );
    }

    private applyOscHeight(height: number, persist = true): void {
        if (height < nyantracker.OSC_HIDE_THRESHOLD) {
            this.applyOscHiddenState(persist);
            return;
        }

        const clampedHeight = Math.max(nyantracker.MIN_OSC_HEIGHT, Math.min(this.getMaxOscHeight(), height));
        this.preferredOscHidden = false;
        this.preferredOscHeight = clampedHeight;
        this.elements.oscView.classList.remove("osc-view--hidden");
        this.elements.oscView.style.height = `${clampedHeight}px`;
        if (persist) {
            writeStorage(nyantracker.STORAGE_KEY_OSC_HEIGHT, String(Math.round(clampedHeight)));
        }
    }

    private applyOscHiddenState(persist = true): void {
        this.preferredOscHidden = true;
        this.elements.oscView.classList.add("osc-view--hidden");
        this.elements.oscView.style.height = "0px";

        if (persist) {
            writeStorage(nyantracker.STORAGE_KEY_OSC_HEIGHT, "0");
        }
    }

    private isOscHidden(): boolean {
        return this.elements.oscView.classList.contains("osc-view--hidden");
    }

    private async loadFile(file: File): Promise<void> {
        if (!this.legacyModule) {
            this.updateStatus("LEGACY ENGINE NOT READY");
            return;
        }

        this.prepareForIncomingLoad(file.name, file.name);
        this.player.ensure();
        this.player.setVolume(Number(this.elements.volumeSlider.value));
        this.modlandBrowser.setActiveSong(file.name);
        this.currentFileName = file.name;
        this.updateStatus("PARSING MODULE...");

        const buffer = await file.arrayBuffer();
        this.rebuildLegacyModule(buffer);
        this.player.play(buffer);
        this.updateStatus("PLAYING");
        this.lastFrameTime = performance.now();
        this.updateProgressUi(0, this.durationSeconds || this.player.instance?.duration || 0);

        if (!this.uiLoopStarted) {
            this.uiLoopStarted = true;
            requestAnimationFrame(() => this.updateUiLoop());
        }
    }

    private rebuildLegacyModule(buffer: ArrayBuffer): void {
        if (!this.legacyModule) {
            return;
        }

        if (this.uiModulePtr) {
            this.legacyModule._openmpt_module_destroy(this.uiModulePtr);
            this.uiModulePtr = 0;
        }

        const fileBytes = new Uint8Array(buffer);
        const filePtr = this.legacyModule._malloc(fileBytes.byteLength);
        this.legacyModule.HEAPU8.set(fileBytes, filePtr);
        this.uiModulePtr = this.legacyModule._openmpt_module_create_from_memory2(
            filePtr,
            fileBytes.byteLength,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        );
        this.legacyModule._free(filePtr);

        this.numChannels = Math.min(
            this.maxChannels,
            this.legacyModule._openmpt_module_get_num_channels(this.uiModulePtr),
        );
        this.totalOrders = this.legacyModule.ccall(
            "openmpt_module_get_num_orders",
            "number",
            ["number"],
            [this.uiModulePtr],
        );
        this.totalPatterns = this.legacyModule.ccall(
            "openmpt_module_get_num_patterns",
            "number",
            ["number"],
            [this.uiModulePtr],
        );
        if (!this.dummyBufferPtr) {
            this.dummyBufferPtr = this.legacyModule._malloc(nyantracker.READ_CHUNK_SIZE * 4);
        }

        this.patternCache.clear();
        this.patternPrefetchQueue.length = 0;
        this.patternPrefetchInFlight.clear();
        this.patternPrefetchScheduled = false;
        this.requestedPatternIndex = -1;
        this.orderStartSeconds.clear();
        this.patternRowCounts.clear();
        this.currentRow = -1;
        this.channelFreqs.fill(0);
        this.channelInstruments.fill(0);
        this.patternView.initializeChannels(this.numChannels);
        this.cacheChannelElements();

        this.elements.btnPlay.disabled = false;
        this.elements.btnPrevPat.disabled = false;
        this.elements.btnNextPat.disabled = false;
        this.elements.btnStop.disabled = false;

        this.patternCachePattern(0);
        this.enqueuePatternPrefetch(1);
        this.schedulePatternPrefetch();
    }

    private handleMetadata(metadata: ChiptuneMetadata): void {
        this.durationSeconds = metadata.dur;
        this.elements.titleDisplay.textContent =
            typeof metadata.title === "string" && metadata.title ? metadata.title : this.currentFileName;
        this.elements.progressTotal.textContent = formatDuration(metadata.dur);
        // this.elements.libraryDisplay.textContent = metadata.libopenmptVersion
        //     ? `${metadata.libopenmptVersion} (${metadata.libopenmptBuild ?? "n/a"})`
        //     : "--";
    }

    private handleProgress(progress: ChiptuneProgress): void {
        if (this.seeking || performance.now() - this.lastSeekTime < 300) return;
        this.updateProgressUi(progress.pos, this.durationSeconds || this.player.instance?.duration || 0);

        if (this.legacyModule && this.uiModulePtr) {
            const shadowPos = this.legacyModule._openmpt_module_get_position_seconds(this.uiModulePtr);
            if (Math.abs(shadowPos - progress.pos) > 0.05) {
                this.legacyModule.ccall(
                    "openmpt_module_set_position_seconds",
                    "number",
                    ["number", "number"],
                    [this.uiModulePtr, progress.pos],
                );
            }
        }

        this.enqueuePatternPrefetch(progress.pattern + 1);
        this.enqueuePatternPrefetch(progress.pattern + 2);
        this.schedulePatternPrefetch();
    }

    private updateUiLoop(): void {
        if (!this.legacyModule || !this.uiModulePtr) {
            requestAnimationFrame(() => this.updateUiLoop());
            return;
        }

        if (document.hidden) {
            this.lastFrameTime = performance.now();
            requestAnimationFrame(() => this.updateUiLoop());
            return;
        }

        if (!this.player.isPaused) {
            const now = performance.now();
            let deltaSeconds = Math.max(0, (now - this.lastFrameTime) / 1000);
            this.lastFrameTime = now;

            if (deltaSeconds > 0.25) {
                const currentSec = this.legacyModule._openmpt_module_get_position_seconds(this.uiModulePtr);
                this.legacyModule.ccall(
                    "openmpt_module_set_position_seconds",
                    "number",
                    ["number", "number"],
                    [this.uiModulePtr, currentSec + deltaSeconds],
                );
                deltaSeconds = 0;
                this.fractionalFrames = 0;
            }

            const totalFrames = deltaSeconds * nyantracker.SAMPLE_RATE + this.fractionalFrames;
            const frames = Math.floor(totalFrames);
            this.fractionalFrames = totalFrames - frames;

            if (frames > 0) {
                let remainingFrames = frames;
                while (remainingFrames > 0) {
                    const chunk = Math.min(remainingFrames, nyantracker.READ_CHUNK_SIZE);
                    this.legacyModule._openmpt_module_read_mono(
                        this.uiModulePtr,
                        nyantracker.SAMPLE_RATE,
                        chunk,
                        this.dummyBufferPtr,
                    );
                    remainingFrames -= chunk;
                }
            }

            let pat = -1;
            let row = -1;
            let pos = -1;

            try {
                pat = this.legacyModule._openmpt_module_get_current_pattern(this.uiModulePtr);
                row = this.legacyModule._openmpt_module_get_current_row(this.uiModulePtr);
                pos = this.legacyModule._openmpt_module_get_current_order(this.uiModulePtr);
            } catch {}

            if (pat >= 0 && pat !== this.patternView.getCurrentPattern()) {
                this.renderPatternByIndex(pat);
            }

            if (row >= 0 && row !== this.currentRow) {
                this.currentRow = row;
                this.elements.posDisplay.textContent = `Position: ${formatCounter(pos, this.getTotalOrders())}`;
                this.elements.patDisplay.textContent = `Pattern: ${formatCounter(pat, this.getTotalPatterns())}`;
                this.elements.rowDisplay.textContent = `Row: ${formatCounter(row, this.getCurrentPatternRowCount(pat))}`;

                this.patternView.highlightRow(row);
                this.hydrateChannelState(pat, row);
            }

            this.drawOscilloscopes();
        } else {
            this.lastFrameTime = performance.now();
        }

        requestAnimationFrame(() => this.updateUiLoop());
    }

    private patternCachePattern(patternIndex: number): void {
        const rows = this.ensurePatternCached(patternIndex);
        if (rows.length === 0) {
            return;
        }

        this.patternView.renderPattern(patternIndex, rows);
    }

    private renderPatternByIndex(patternIndex: number): void {
        if (patternIndex < 0 || patternIndex >= this.getTotalPatterns()) {
            return;
        }

        this.requestedPatternIndex = patternIndex;

        if (this.patternCache.has(patternIndex)) {
            this.patternView.renderPattern(patternIndex, this.patternCache.get(patternIndex)!);
            return;
        }

        const rows = this.ensurePatternCached(patternIndex);
        if (rows.length === 0 || this.requestedPatternIndex !== patternIndex) {
            return;
        }

        this.patternView.renderPattern(patternIndex, rows);
    }

    private ensurePatternCached(patternIndex: number): PatternCell[][] {
        if (!this.legacyModule || !this.uiModulePtr || patternIndex < 0 || patternIndex >= this.getTotalPatterns()) {
            return [];
        }

        const cachedPattern = this.patternCache.get(patternIndex);
        if (cachedPattern) {
            return cachedPattern;
        }

        const rows = this.buildPatternRows(patternIndex);
        this.patternCache.set(patternIndex, rows);
        return rows;
    }

    private buildPatternRows(patternIndex: number): PatternCell[][] {
        if (!this.legacyModule || !this.uiModulePtr) {
            return [];
        }

        const totalRows = this.legacyModule._openmpt_module_get_pattern_num_rows(this.uiModulePtr, patternIndex);
        this.patternRowCounts.set(patternIndex, totalRows);

        const rows: PatternCell[][] = [];
        for (let row = 0; row < totalRows; row += 1) {
            const rowCells: PatternCell[] = [];
            for (let channel = 0; channel < this.numChannels; channel += 1) {
                rowCells.push(readPatternCell(this.legacyModule, this.uiModulePtr, patternIndex, row, channel));
            }
            rows.push(rowCells);
        }

        return rows;
    }

    private enqueuePatternPrefetch(patternIndex: number): void {
        if (!this.legacyModule || !this.uiModulePtr) {
            return;
        }

        if (
            patternIndex < 0 ||
            patternIndex >= this.getTotalPatterns() ||
            this.patternCache.has(patternIndex) ||
            this.patternPrefetchInFlight.has(patternIndex) ||
            this.patternPrefetchQueue.includes(patternIndex)
        ) {
            return;
        }

        this.patternPrefetchQueue.push(patternIndex);
    }

    private schedulePatternPrefetch(): void {
        if (this.patternPrefetchScheduled || this.patternPrefetchQueue.length === 0) {
            return;
        }

        this.patternPrefetchScheduled = true;
        window.setTimeout(() => {
            void this.processPatternPrefetchQueue();
        }, 0);
    }

    private async processPatternPrefetchQueue(): Promise<void> {
        const nextPatternIndex = this.patternPrefetchQueue.shift();
        if (nextPatternIndex === undefined) {
            this.patternPrefetchScheduled = false;
            return;
        }

        this.patternPrefetchInFlight.add(nextPatternIndex);
        await new Promise<void>((resolve) => {
            window.setTimeout(() => {
                if (!this.patternCache.has(nextPatternIndex)) {
                    const rows = this.buildPatternRows(nextPatternIndex);
                    if (rows.length > 0) {
                        this.patternCache.set(nextPatternIndex, rows);
                    }
                }

                this.patternPrefetchInFlight.delete(nextPatternIndex);
                resolve();
            }, 0);
        });

        this.patternPrefetchScheduled = false;
        if (this.patternPrefetchQueue.length > 0) {
            this.schedulePatternPrefetch();
        }
    }

    private hydrateChannelState(patternIndex: number, rowIndex: number): void {
        const pattern = this.patternCache.get(patternIndex);
        const row = pattern?.[rowIndex];
        if (!row) {
            return;
        }

        for (let channelIndex = 0; channelIndex < row.length; channelIndex += 1) {
            const cell = row[channelIndex];
            if (cell.note && cell.note !== "---" && cell.note !== "===" && cell.note !== "^^^") {
                this.channelFreqs[channelIndex] = getNoteFrequency(cell.note);
                if (cell.inst !== "--") {
                    this.channelInstruments[channelIndex] = this.parseInstrumentIndex(cell.inst);
                }
            }
        }
    }

    private parseInstrumentIndex(instrument: string): number {
        if (!instrument || instrument === "--") {
            return 0;
        }

        const radix = /[a-f]/i.test(instrument) ? 16 : 10;
        const parsed = Number.parseInt(instrument, radix);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    private drawOscilloscopes(): void {
        if (!this.legacyModule || !this.uiModulePtr) {
            return;
        }

        if (this.isOscHidden()) {
            return;
        }

        for (let channel = 0; channel < this.numChannels; channel += 1) {
            const canvas = this.channelCanvases[channel];
            if (!canvas) {
                continue;
            }

            let vu = 0;
            try {
                vu = this.legacyModule.ccall(
                    "openmpt_module_get_current_channel_vu_mono",
                    "number",
                    ["number", "number"],
                    [this.uiModulePtr, channel],
                );
            } catch {
                vu = 0;
            }

            const vuFill = this.channelVuFills[channel];
            if (vuFill) {
                const hiddenPercent = Math.max(0, Math.min(100, (1 - vu) * 100));
                vuFill.style.clipPath = `inset(0 ${hiddenPercent}% 0 0)`;
            }

            this.oscilloscopeRenderer.render(
                canvas,
                vu,
                this.channelFreqs[channel],
                this.channelInstruments[channel] || 0,
                channel,
            );
        }
    }

    private resetTrackerViewToStart(): void {
        this.currentRow = -1;
        this.channelFreqs.fill(0);
        this.channelInstruments.fill(0);

        if (this.legacyModule && this.uiModulePtr) {
            this.syncLegacyModuleToSeconds(0);

            if (!this.patternCache.has(0)) {
                this.patternCachePattern(0);
            } else {
                this.patternView.renderPattern(0, this.patternCache.get(0)!);
            }
        } else {
            this.patternView.resetPlaybackState();
        }

        this.oscilloscopeRenderer.reset(this.numChannels);
        this.drawOscilloscopes();
        this.elements.posDisplay.textContent = `Position: ${formatCounter(0, this.getTotalOrders())}`;
        this.elements.patDisplay.textContent = `Pattern: ${formatCounter(0, this.getTotalPatterns())}`;
        this.elements.rowDisplay.textContent = `Row: ${formatCounter(0, this.getCurrentPatternRowCount(0))}`;

        requestAnimationFrame(() => {
            this.currentRow = 0;
            this.patternView.highlightRow(0);
        });
    }

    private stepOrder(direction: -1 | 1): void {
        if (!this.legacyModule || !this.uiModulePtr) {
            return;
        }

        const currentOrder = this.legacyModule._openmpt_module_get_current_order(this.uiModulePtr);
        const totalOrders = this.getTotalOrders();
        const targetOrder = Math.max(0, Math.min(totalOrders - 1, currentOrder + direction));

        const targetSeconds = this.syncLegacyModuleToSeconds(this.getOrderStartSeconds(targetOrder));
        this.player.seek(targetSeconds);

        const now = performance.now();
        this.lastFrameTime = now;
        this.lastSeekTime = now;

        this.updateProgressUi(targetSeconds, this.durationSeconds || this.player.instance?.duration || 0);
    }

    private seekFromClientX(clientX: number): void {
        if (!this.durationSeconds) {
            return;
        }

        const bounds = this.elements.progressBar.getBoundingClientRect();
        if (bounds.width <= 0) {
            return;
        }

        const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
        const seconds = ratio * this.durationSeconds;
        const targetSeconds = this.syncLegacyModuleToSeconds(seconds);
        this.player.seek(targetSeconds);

        const now = performance.now();
        this.lastFrameTime = now;
        this.lastSeekTime = now;

        this.updateProgressUi(targetSeconds, this.durationSeconds);
    }

    private syncLegacyModuleToSeconds(seconds: number): number {
        if (!this.legacyModule || !this.uiModulePtr) {
            return seconds;
        }

        const safeSeconds = Math.max(0, seconds);
        const targetOrder = this.getOrderForSeconds(safeSeconds);

        this.legacyModule.ccall(
            "openmpt_module_set_position_order_row",
            "number",
            ["number", "number", "number"],
            [this.uiModulePtr, targetOrder, 0],
        );
        this.legacyModule.ccall(
            "openmpt_module_set_position_seconds",
            "number",
            ["number", "number"],
            [this.uiModulePtr, safeSeconds],
        );

        this.currentRow = -1;
        return this.legacyModule._openmpt_module_get_position_seconds(this.uiModulePtr);
    }

    private getOrderForSeconds(seconds: number): number {
        const totalOrders = this.getTotalOrders();
        if (totalOrders <= 0) {
            return 0;
        }

        this.ensureOrderStartSeconds();

        let targetOrder = 0;
        for (let orderIndex = 0; orderIndex < totalOrders; orderIndex += 1) {
            const orderSeconds = this.orderStartSeconds.get(orderIndex) ?? 0;
            if (orderSeconds > seconds) {
                break;
            }
            targetOrder = orderIndex;
        }

        return targetOrder;
    }

    private getOrderStartSeconds(orderIndex: number): number {
        this.ensureOrderStartSeconds();
        return this.orderStartSeconds.get(orderIndex) ?? 0;
    }

    private ensureOrderStartSeconds(): void {
        if (!this.legacyModule || !this.uiModulePtr) {
            return;
        }

        const totalOrders = this.getTotalOrders();
        if (totalOrders <= 0 || this.orderStartSeconds.size === totalOrders) {
            return;
        }

        const currentSeconds = this.legacyModule._openmpt_module_get_position_seconds(this.uiModulePtr);
        this.orderStartSeconds.clear();

        for (let orderIndex = 0; orderIndex < totalOrders; orderIndex += 1) {
            this.legacyModule.ccall(
                "openmpt_module_set_position_order_row",
                "number",
                ["number", "number", "number"],
                [this.uiModulePtr, orderIndex, 0],
            );
            this.orderStartSeconds.set(
                orderIndex,
                this.legacyModule._openmpt_module_get_position_seconds(this.uiModulePtr),
            );
        }

        this.legacyModule.ccall(
            "openmpt_module_set_position_seconds",
            "number",
            ["number", "number"],
            [this.uiModulePtr, currentSeconds],
        );
    }

    private updateProgressUi(currentSeconds: number, totalSeconds: number): void {
        const safeCurrent = Math.max(0, currentSeconds);
        const safeTotal = Math.max(0, totalSeconds);
        const ratio = safeTotal > 0 ? Math.max(0, Math.min(1, safeCurrent / safeTotal)) : 0;
        const percent = ratio * 100;
        const currentLabel = formatDuration(safeCurrent);
        const totalLabel = safeTotal > 0 ? formatDuration(safeTotal) : "--:--";

        if (currentLabel !== this.lastProgressCurrentLabel) {
            this.elements.progressCurrent.textContent = currentLabel;
            this.lastProgressCurrentLabel = currentLabel;
        }
        if (totalLabel !== this.lastProgressTotalLabel) {
            this.elements.progressTotal.textContent = totalLabel;
            this.lastProgressTotalLabel = totalLabel;
        }
        if (percent !== this.lastProgressPercent) {
            this.elements.progressFill.style.width = `${percent}%`;
            this.elements.progressHandler.style.left = `${percent}%`;
            this.lastProgressPercent = percent;
        }
    }

    private getTotalOrders(): number {
        if (this.totalOrders > 0) {
            return this.totalOrders;
        }
        if (!this.legacyModule || !this.uiModulePtr) {
            return 0;
        }
        this.totalOrders = this.legacyModule.ccall(
            "openmpt_module_get_num_orders",
            "number",
            ["number"],
            [this.uiModulePtr],
        );
        return this.totalOrders;
    }

    private getTotalPatterns(): number {
        if (this.totalPatterns > 0) {
            return this.totalPatterns;
        }
        if (!this.legacyModule || !this.uiModulePtr) {
            return 0;
        }
        this.totalPatterns = this.legacyModule.ccall(
            "openmpt_module_get_num_patterns",
            "number",
            ["number"],
            [this.uiModulePtr],
        );
        return this.totalPatterns;
    }

    private getCurrentPatternRowCount(patternIndex: number): number {
        if (patternIndex < 0) {
            return 0;
        }
        const cachedCount = this.patternRowCounts.get(patternIndex);
        if (cachedCount !== undefined) {
            return cachedCount;
        }
        if (!this.legacyModule || !this.uiModulePtr) {
            return 0;
        }
        const rowCount = this.legacyModule._openmpt_module_get_pattern_num_rows(this.uiModulePtr, patternIndex);
        this.patternRowCounts.set(patternIndex, rowCount);
        return rowCount;
    }

    private cacheChannelElements(): void {
        for (let channel = 0; channel < this.maxChannels; channel += 1) {
            this.channelCanvases[channel] =
                channel < this.numChannels
                    ? (document.getElementById(`canvas-${channel}`) as HTMLCanvasElement | null)
                    : null;
            this.channelVuFills[channel] =
                channel < this.numChannels ? document.getElementById(`vu-fill-${channel}`) : null;
        }
    }

    private updateStatus(status: string): void {
        this.elements.topStatus.textContent = status;
    }

    private prepareForIncomingLoad(fileName: string, displayTitle: string): void {
        this.player.stop();

        if (this.legacyModule && this.uiModulePtr) {
            this.legacyModule._openmpt_module_destroy(this.uiModulePtr);
            this.uiModulePtr = 0;
        }

        this.currentFileName = fileName;
        this.durationSeconds = 0;
        this.totalOrders = 0;
        this.totalPatterns = 0;
        this.currentRow = -1;
        this.lastFrameTime = performance.now();
        this.lastSeekTime = 0;
        this.fractionalFrames = 0;
        this.patternCache.clear();
        this.patternPrefetchQueue.length = 0;
        this.patternPrefetchInFlight.clear();
        this.patternPrefetchScheduled = false;
        this.requestedPatternIndex = -1;
        this.orderStartSeconds.clear();
        this.patternRowCounts.clear();
        this.channelFreqs.fill(0);
        this.channelInstruments.fill(0);
        this.oscilloscopeRenderer.reset(this.maxChannels);
        this.numChannels = 0;

        for (let channel = 0; channel < this.maxChannels; channel += 1) {
            this.channelCanvases[channel] = null;
            this.channelVuFills[channel] = null;
        }

        this.patternView.clear();
        this.elements.titleDisplay.textContent = displayTitle;
        this.elements.posDisplay.textContent = "Position: --/--";
        this.elements.patDisplay.textContent = "Pattern: --/--";
        this.elements.rowDisplay.textContent = "Row: --/--";
        this.elements.btnPlay.disabled = true;
        this.elements.btnPrevPat.disabled = true;
        this.elements.btnNextPat.disabled = true;
        this.elements.btnStop.disabled = true;
        this.updateProgressUi(0, 0);
    }

    private async loadArrayBuffer(buffer: ArrayBuffer, fileName: string): Promise<void> {
        if (!this.legacyModule) {
            this.updateStatus("LEGACY ENGINE NOT READY");
            return;
        }

        this.player.ensure();
        this.player.setVolume(Number(this.elements.volumeSlider.value));
        this.currentFileName = fileName;
        this.updateStatus("PARSING MODULE...");

        this.rebuildLegacyModule(buffer);
        this.player.play(buffer);
        this.updateStatus("PLAYING");
        this.lastFrameTime = performance.now();
        this.updateProgressUi(0, this.durationSeconds || this.player.instance?.duration || 0);

        if (!this.uiLoopStarted) {
            this.uiLoopStarted = true;
            requestAnimationFrame(() => this.updateUiLoop());
        }
    }

    private restorePersistedState(): void {
        const savedVolume = readStoredNumber(nyantracker.STORAGE_KEY_VOLUME);
        if (savedVolume !== null) {
            const min = Number(this.elements.volumeSlider.min || 0);
            const max = Number(this.elements.volumeSlider.max || 1);
            const clampedVolume = Math.min(max, Math.max(min, savedVolume));
            this.elements.volumeSlider.value = String(clampedVolume);
        }

        const tweakBarHidden = readStorage(nyantracker.STORAGE_KEY_TWEAKBAR_HIDDEN) === "true";
        this.elements.tweakBar.classList.toggle("tweak-bar--hidden", tweakBarHidden);

        this.browserPane.restorePersistedState();

        const savedOscHeight = readStoredNumber(nyantracker.STORAGE_KEY_OSC_HEIGHT);
        if (savedOscHeight !== null) {
            if (savedOscHeight <= 0) {
                this.preferredOscHidden = true;
                this.preferredOscHeight = nyantracker.MIN_OSC_HEIGHT;
            } else {
                this.preferredOscHidden = false;
                this.preferredOscHeight = savedOscHeight;
            }
        }
    }
}
