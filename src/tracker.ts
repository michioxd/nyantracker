import type { ChiptuneMetadata, ChiptuneProgress } from "chiptune3";
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
import type { LegacyOpenMptModule } from "./lib/legacy-openmpt";
import type { TrackerElements } from "./types/global";
import { readStoredNumber, writeStorage } from "./utils/storage";
import { APP_CONSTANTS } from "./constants";
import { createTrackerCaches, createTrackerRuntimeState, type TrackerCaches, type TrackerRuntimeState } from "./state";

interface TrackerPlaybackControllerOptions {
    elements: TrackerElements;
    onStatusChange: (status: string) => void;
}

export class TrackerPlaybackController {
    private readonly maxChannels = 64;
    private readonly elements: TrackerElements;
    private readonly onStatusChange: (status: string) => void;
    private readonly oscilloscopeRenderer = new OscilloscopeRenderer();
    private oscilloscopeLineColor = "#4ade80";
    private oscilloscopeBackgroundColor = "#0c0c0c";
    private readonly patternView: PatternView;
    private readonly player: PlayerController;
    private readonly state: TrackerRuntimeState;
    private readonly caches: TrackerCaches;
    private patternResizeObserver: ResizeObserver | null = null;

    constructor(options: TrackerPlaybackControllerOptions) {
        this.elements = options.elements;
        this.onStatusChange = options.onStatusChange;
        this.patternView = new PatternView(
            this.elements.patternHeader,
            this.elements.patternBody,
            this.elements.oscView,
        );
        this.state = createTrackerRuntimeState();
        this.caches = createTrackerCaches(this.maxChannels);
        this.player = new PlayerController(
            {
                onReady: () => {
                    this.elements.fileInput.disabled = false;
                },
                onMetadata: (metadata) => this.handleMetadata(metadata),
                onProgress: (progress) => this.handleProgress(progress),
                onError: (message) => this.onStatusChange(message),
                onEnded: () => {
                    this.stopPlayback();
                    this.resetTrackerViewToStart();
                    this.onStatusChange("STOPPED");
                },
            },
            0,
        );
    }

    setLegacyModule(module: LegacyOpenMptModule): void {
        this.state.legacyModule = module;
    }

    ensurePlayer(): void {
        this.player.ensure();
    }

    setVolume(value: number): void {
        this.player.setVolume(value);
    }

    setPitch(value: number): void {
        this.player.setPitch(value);
    }

    setTempo(value: number): void {
        this.state.tempoFactor = Math.max(0.25, value);
        this.player.setTempo(value);
        this.state.lastFrameTime = performance.now();
    }

    setOscilloscopeTheme(lineColor: string, backgroundColor: string): void {
        this.oscilloscopeLineColor = lineColor;
        this.oscilloscopeBackgroundColor = backgroundColor;
        this.drawOscilloscopes();
    }

    togglePlayback(): boolean {
        const paused = this.player.togglePlayback();
        if (!paused) {
            this.state.lastFrameTime = performance.now();
        }
        return paused;
    }

    stopPlayback(): void {
        this.player.stop();
    }

    handleStopRequested(): void {
        this.player.stop();
        this.resetTrackerViewToStart();
        this.updateProgressUi(0, this.getPlaybackDuration());
    }

    getPlaybackDuration(): number {
        return this.state.durationSeconds || this.player.instance?.duration || 0;
    }

    restorePersistedState(): void {
        const savedOscHeight = readStoredNumber(APP_CONSTANTS.storageKeyOscHeight);
        if (savedOscHeight === null) {
            return;
        }

        if (savedOscHeight <= 0) {
            this.state.preferredOscHidden = true;
            this.state.preferredOscHeight = APP_CONSTANTS.minOscHeight;
        } else {
            this.state.preferredOscHidden = false;
            this.state.preferredOscHeight = savedOscHeight;
        }
    }

    bindOscResizer(): void {
        this.elements.oscResizer.addEventListener("pointerdown", (event) => {
            const startY = event.clientY;
            const startHeight = this.isOscHidden() ? 0 : this.elements.oscView.getBoundingClientRect().height;

            this.beginResizeGesture(this.elements.oscResizer, event.pointerId, (moveEvent) => {
                const proposedHeight = startHeight - (moveEvent.clientY - startY);
                this.applyOscHeight(proposedHeight);
            });
        });

        this.applyResponsiveLayoutState();
    }

    bindPatternResizeObserver(): void {
        this.patternResizeObserver?.disconnect();
        this.patternResizeObserver = new ResizeObserver(() => {
            this.schedulePatternLayoutSync();
        });
        this.patternResizeObserver.observe(this.elements.patternViewContainer);
    }

    handleLayoutChange(): void {
        this.applyResponsiveLayoutState();
        this.schedulePatternLayoutSync();
    }

    applyResponsiveLayoutState(): void {
        if (this.state.preferredOscHidden) {
            this.applyOscHiddenState(false);
            return;
        }

        const currentOscHeight = this.elements.oscView.getBoundingClientRect().height;
        this.applyOscHeight(this.state.preferredOscHeight ?? (currentOscHeight || APP_CONSTANTS.minOscHeight), false);
    }

    handleProgressPointerDown(event: PointerEvent): void {
        if (!this.state.durationSeconds) {
            return;
        }

        this.state.seeking = true;
        this.elements.progressBar.setPointerCapture(event.pointerId);
        this.seekFromClientX(event.clientX);
    }

    handleProgressPointerMove(event: PointerEvent): void {
        if (!this.state.seeking) {
            return;
        }

        this.seekFromClientX(event.clientX);
    }

    finishSeeking(event: PointerEvent): void {
        if (!this.state.seeking) {
            return;
        }

        this.state.seeking = false;
        if (this.elements.progressBar.hasPointerCapture(event.pointerId)) {
            this.elements.progressBar.releasePointerCapture(event.pointerId);
        }
    }

    async loadFile(file: File): Promise<void> {
        if (!this.state.legacyModule) {
            this.onStatusChange("LEGACY ENGINE NOT READY");
            return;
        }

        this.prepareForIncomingLoad(file.name, file.name);
        this.player.ensure();
        this.player.setVolume(Number(this.elements.volumeSlider.value));
        this.state.currentFileName = file.name;
        this.onStatusChange("PARSING MODULE...");

        const buffer = await file.arrayBuffer();
        this.rebuildLegacyModule(buffer);
        this.player.play(buffer);
        this.onStatusChange("PLAYING");
        this.state.lastFrameTime = performance.now();
        this.updateProgressUi(0, this.getPlaybackDuration());
        this.startUiLoopIfNeeded();
    }

    prepareForIncomingLoad(fileName: string, displayTitle: string): void {
        this.player.stop();

        if (this.state.legacyModule && this.state.uiModulePtr) {
            this.state.legacyModule._openmpt_module_destroy(this.state.uiModulePtr);
            this.state.uiModulePtr = 0;
        }

        this.state.currentFileName = fileName;
        this.state.durationSeconds = 0;
        this.state.totalOrders = 0;
        this.state.totalPatterns = 0;
        this.state.currentRow = -1;
        this.state.lastFrameTime = performance.now();
        this.state.lastSeekTime = 0;
        this.state.fractionalFrames = 0;
        this.caches.patternCache.clear();
        this.caches.patternPrefetchQueue.length = 0;
        this.caches.patternPrefetchInFlight.clear();
        this.state.patternPrefetchScheduled = false;
        this.state.requestedPatternIndex = -1;
        this.caches.orderStartSeconds.clear();
        this.caches.patternRowCounts.clear();
        this.caches.channelFreqs.fill(0);
        this.caches.channelInstruments.fill(0);
        this.oscilloscopeRenderer.reset(this.maxChannels);
        this.state.numChannels = 0;

        for (let channel = 0; channel < this.maxChannels; channel += 1) {
            this.caches.channelCanvases[channel] = null;
            this.caches.channelVuFills[channel] = null;
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

    async loadArrayBuffer(buffer: ArrayBuffer, fileName: string, autoplay = true): Promise<void> {
        if (!this.state.legacyModule) {
            this.onStatusChange("LEGACY ENGINE NOT READY");
            return;
        }

        this.player.ensure();
        this.player.setVolume(Number(this.elements.volumeSlider.value));
        this.state.currentFileName = fileName;
        this.onStatusChange("PARSING MODULE...");

        this.rebuildLegacyModule(buffer);
        if (autoplay) {
            this.player.play(buffer);
            this.onStatusChange("PLAYING");
        } else {
            this.player.load(buffer);
            this.onStatusChange("READY - PRESS PLAY");
        }
        this.state.lastFrameTime = performance.now();
        this.updateProgressUi(0, this.getPlaybackDuration());
        this.startUiLoopIfNeeded();
    }

    resetTrackerViewToStart(): void {
        this.state.currentRow = -1;
        this.caches.channelFreqs.fill(0);
        this.caches.channelInstruments.fill(0);

        if (this.state.legacyModule && this.state.uiModulePtr) {
            this.syncLegacyModuleToSeconds(0);

            if (!this.caches.patternCache.has(0)) {
                this.patternCachePattern(0);
            } else {
                this.patternView.renderPattern(0, this.caches.patternCache.get(0)!);
            }
        } else {
            this.patternView.resetPlaybackState();
        }

        this.oscilloscopeRenderer.reset(this.state.numChannels);
        this.drawOscilloscopes();
        this.elements.posDisplay.textContent = `Position: ${formatCounter(0, this.getTotalOrders())}`;
        this.elements.patDisplay.textContent = `Pattern: ${formatCounter(0, this.getTotalPatterns())}`;
        this.elements.rowDisplay.textContent = `Row: ${formatCounter(0, this.getCurrentPatternRowCount(0))}`;

        requestAnimationFrame(() => {
            this.state.currentRow = 0;
            this.patternView.highlightRow(0);
        });
    }

    stepOrder(direction: -1 | 1): void {
        if (!this.state.legacyModule || !this.state.uiModulePtr) {
            return;
        }

        const currentOrder = this.state.legacyModule._openmpt_module_get_current_order(this.state.uiModulePtr);
        const totalOrders = this.getTotalOrders();
        const targetOrder = Math.max(0, Math.min(totalOrders - 1, currentOrder + direction));

        const targetSeconds = this.syncLegacyModuleToSeconds(this.getOrderStartSeconds(targetOrder));
        this.player.seek(targetSeconds);

        const now = performance.now();
        this.state.lastFrameTime = now;
        this.state.lastSeekTime = now;

        this.updateProgressUi(targetSeconds, this.getPlaybackDuration());
    }

    private startUiLoopIfNeeded(): void {
        if (this.state.uiLoopStarted) {
            return;
        }

        this.state.uiLoopStarted = true;
        requestAnimationFrame(() => this.updateUiLoop());
    }

    private rebuildLegacyModule(buffer: ArrayBuffer): void {
        if (!this.state.legacyModule) {
            return;
        }

        if (this.state.uiModulePtr) {
            this.state.legacyModule._openmpt_module_destroy(this.state.uiModulePtr);
            this.state.uiModulePtr = 0;
        }

        const fileBytes = new Uint8Array(buffer);
        const filePtr = this.state.legacyModule._malloc(fileBytes.byteLength);
        this.state.legacyModule.HEAPU8.set(fileBytes, filePtr);
        this.state.uiModulePtr = this.state.legacyModule._openmpt_module_create_from_memory2(
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
        this.state.legacyModule._free(filePtr);

        this.state.numChannels = Math.min(
            this.maxChannels,
            this.state.legacyModule._openmpt_module_get_num_channels(this.state.uiModulePtr),
        );
        this.state.totalOrders = this.state.legacyModule.ccall(
            "openmpt_module_get_num_orders",
            "number",
            ["number"],
            [this.state.uiModulePtr],
        );
        this.state.totalPatterns = this.state.legacyModule.ccall(
            "openmpt_module_get_num_patterns",
            "number",
            ["number"],
            [this.state.uiModulePtr],
        );
        if (!this.state.dummyBufferPtr) {
            this.state.dummyBufferPtr = this.state.legacyModule._malloc(APP_CONSTANTS.readChunkSize * 4);
        }

        this.caches.patternCache.clear();
        this.caches.patternPrefetchQueue.length = 0;
        this.caches.patternPrefetchInFlight.clear();
        this.state.patternPrefetchScheduled = false;
        this.state.requestedPatternIndex = -1;
        this.caches.orderStartSeconds.clear();
        this.caches.patternRowCounts.clear();
        this.state.currentRow = -1;
        this.caches.channelFreqs.fill(0);
        this.caches.channelInstruments.fill(0);
        this.patternView.initializeChannels(this.state.numChannels);
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
        this.state.durationSeconds = metadata.dur;
        this.elements.titleDisplay.textContent =
            typeof metadata.title === "string" && metadata.title ? metadata.title : this.state.currentFileName;
        this.elements.progressTotal.textContent = formatDuration(metadata.dur);
    }

    private handleProgress(progress: ChiptuneProgress): void {
        if (this.state.seeking || performance.now() - this.state.lastSeekTime < 300) {
            return;
        }

        this.updateProgressUi(progress.pos, this.getPlaybackDuration());

        if (this.state.legacyModule && this.state.uiModulePtr) {
            const shadowPos = this.state.legacyModule._openmpt_module_get_position_seconds(this.state.uiModulePtr);
            if (Math.abs(shadowPos - progress.pos) > 0.05) {
                this.state.legacyModule.ccall(
                    "openmpt_module_set_position_seconds",
                    "number",
                    ["number", "number"],
                    [this.state.uiModulePtr, progress.pos],
                );
            }
        }

        this.enqueuePatternPrefetch(progress.pattern + 1);
        this.enqueuePatternPrefetch(progress.pattern + 2);
        this.schedulePatternPrefetch();
    }

    private updateUiLoop(): void {
        if (!this.state.legacyModule || !this.state.uiModulePtr) {
            requestAnimationFrame(() => this.updateUiLoop());
            return;
        }

        if (document.hidden) {
            this.state.lastFrameTime = performance.now();
            requestAnimationFrame(() => this.updateUiLoop());
            return;
        }

        if (!this.player.isPaused) {
            const now = performance.now();
            let deltaSeconds = Math.max(0, (now - this.state.lastFrameTime) / 1000);
            this.state.lastFrameTime = now;
            const tempoFactor = this.state.tempoFactor;

            if (deltaSeconds > 0.25) {
                const currentSec = this.state.legacyModule._openmpt_module_get_position_seconds(this.state.uiModulePtr);
                this.state.legacyModule.ccall(
                    "openmpt_module_set_position_seconds",
                    "number",
                    ["number", "number"],
                    [this.state.uiModulePtr, currentSec + deltaSeconds * tempoFactor],
                );
                deltaSeconds = 0;
                this.state.fractionalFrames = 0;
            }

            const totalFrames = deltaSeconds * APP_CONSTANTS.sampleRate * tempoFactor + this.state.fractionalFrames;
            const frames = Math.floor(totalFrames);
            this.state.fractionalFrames = totalFrames - frames;

            if (frames > 0) {
                let remainingFrames = frames;
                while (remainingFrames > 0) {
                    const chunk = Math.min(remainingFrames, APP_CONSTANTS.readChunkSize);
                    this.state.legacyModule._openmpt_module_read_mono(
                        this.state.uiModulePtr,
                        APP_CONSTANTS.sampleRate,
                        chunk,
                        this.state.dummyBufferPtr,
                    );
                    remainingFrames -= chunk;
                }
            }

            let patternIndex = -1;
            let row = -1;
            let pos = -1;
            let currentSeconds = -1;

            try {
                patternIndex = this.state.legacyModule._openmpt_module_get_current_pattern(this.state.uiModulePtr);
                row = this.state.legacyModule._openmpt_module_get_current_row(this.state.uiModulePtr);
                pos = this.state.legacyModule._openmpt_module_get_current_order(this.state.uiModulePtr);
                currentSeconds = this.state.legacyModule._openmpt_module_get_position_seconds(this.state.uiModulePtr);
            } catch {}

            if (!this.state.seeking && currentSeconds >= 0) {
                this.updateProgressUi(currentSeconds, this.getPlaybackDuration());
            }

            if (patternIndex >= 0 && patternIndex !== this.patternView.getCurrentPattern()) {
                this.renderPatternByIndex(patternIndex);
            }

            if (row >= 0 && row !== this.state.currentRow) {
                this.state.currentRow = row;
                this.elements.posDisplay.textContent = `Position: ${formatCounter(pos, this.getTotalOrders())}`;
                this.elements.patDisplay.textContent = `Pattern: ${formatCounter(patternIndex, this.getTotalPatterns())}`;
                this.elements.rowDisplay.textContent = `Row: ${formatCounter(row, this.getCurrentPatternRowCount(patternIndex))}`;

                this.patternView.highlightRow(row);
                this.hydrateChannelState(patternIndex, row);
            }

            this.drawOscilloscopes();
        } else {
            this.state.lastFrameTime = performance.now();
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

        this.state.requestedPatternIndex = patternIndex;

        if (this.caches.patternCache.has(patternIndex)) {
            this.patternView.renderPattern(patternIndex, this.caches.patternCache.get(patternIndex)!);
            return;
        }

        const rows = this.ensurePatternCached(patternIndex);
        if (rows.length === 0 || this.state.requestedPatternIndex !== patternIndex) {
            return;
        }

        this.patternView.renderPattern(patternIndex, rows);
    }

    private ensurePatternCached(patternIndex: number): PatternCell[][] {
        if (
            !this.state.legacyModule ||
            !this.state.uiModulePtr ||
            patternIndex < 0 ||
            patternIndex >= this.getTotalPatterns()
        ) {
            return [];
        }

        const cachedPattern = this.caches.patternCache.get(patternIndex);
        if (cachedPattern) {
            return cachedPattern;
        }

        const rows = this.buildPatternRows(patternIndex);
        this.caches.patternCache.set(patternIndex, rows);
        return rows;
    }

    private buildPatternRows(patternIndex: number): PatternCell[][] {
        if (!this.state.legacyModule || !this.state.uiModulePtr) {
            return [];
        }

        const totalRows = this.state.legacyModule._openmpt_module_get_pattern_num_rows(
            this.state.uiModulePtr,
            patternIndex,
        );
        this.caches.patternRowCounts.set(patternIndex, totalRows);

        const rows: PatternCell[][] = [];
        for (let row = 0; row < totalRows; row += 1) {
            const rowCells: PatternCell[] = [];
            for (let channel = 0; channel < this.state.numChannels; channel += 1) {
                rowCells.push(
                    readPatternCell(this.state.legacyModule, this.state.uiModulePtr, patternIndex, row, channel),
                );
            }
            rows.push(rowCells);
        }

        return rows;
    }

    private enqueuePatternPrefetch(patternIndex: number): void {
        if (!this.state.legacyModule || !this.state.uiModulePtr) {
            return;
        }

        if (
            patternIndex < 0 ||
            patternIndex >= this.getTotalPatterns() ||
            this.caches.patternCache.has(patternIndex) ||
            this.caches.patternPrefetchInFlight.has(patternIndex) ||
            this.caches.patternPrefetchQueue.includes(patternIndex)
        ) {
            return;
        }

        this.caches.patternPrefetchQueue.push(patternIndex);
    }

    private schedulePatternPrefetch(): void {
        if (this.state.patternPrefetchScheduled || this.caches.patternPrefetchQueue.length === 0) {
            return;
        }

        this.state.patternPrefetchScheduled = true;
        window.setTimeout(() => {
            void this.processPatternPrefetchQueue();
        }, 0);
    }

    private async processPatternPrefetchQueue(): Promise<void> {
        const nextPatternIndex = this.caches.patternPrefetchQueue.shift();
        if (nextPatternIndex === undefined) {
            this.state.patternPrefetchScheduled = false;
            return;
        }

        this.caches.patternPrefetchInFlight.add(nextPatternIndex);
        await new Promise<void>((resolve) => {
            window.setTimeout(() => {
                if (!this.caches.patternCache.has(nextPatternIndex)) {
                    const rows = this.buildPatternRows(nextPatternIndex);
                    if (rows.length > 0) {
                        this.caches.patternCache.set(nextPatternIndex, rows);
                    }
                }

                this.caches.patternPrefetchInFlight.delete(nextPatternIndex);
                resolve();
            }, 0);
        });

        this.state.patternPrefetchScheduled = false;
        if (this.caches.patternPrefetchQueue.length > 0) {
            this.schedulePatternPrefetch();
        }
    }

    private hydrateChannelState(patternIndex: number, rowIndex: number): void {
        const pattern = this.caches.patternCache.get(patternIndex);
        const row = pattern?.[rowIndex];
        if (!row) {
            return;
        }

        for (let channelIndex = 0; channelIndex < row.length; channelIndex += 1) {
            const cell = row[channelIndex];
            if (cell.note && cell.note !== "---" && cell.note !== "===" && cell.note !== "^^^") {
                this.caches.channelFreqs[channelIndex] = getNoteFrequency(cell.note);
                if (cell.inst !== "--") {
                    this.caches.channelInstruments[channelIndex] = this.parseInstrumentIndex(cell.inst);
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
        if (!this.state.legacyModule || !this.state.uiModulePtr || this.isOscHidden()) {
            return;
        }

        for (let channel = 0; channel < this.state.numChannels; channel += 1) {
            const canvas = this.caches.channelCanvases[channel];
            if (!canvas) {
                continue;
            }

            let vu = 0;
            try {
                vu = this.state.legacyModule.ccall(
                    "openmpt_module_get_current_channel_vu_mono",
                    "number",
                    ["number", "number"],
                    [this.state.uiModulePtr, channel],
                );
            } catch {
                vu = 0;
            }

            const vuFill = this.caches.channelVuFills[channel];
            if (vuFill) {
                const hiddenPercent = Math.max(0, Math.min(100, (1 - vu) * 100));
                vuFill.style.clipPath = `inset(0 ${hiddenPercent}% 0 0)`;
            }

            this.oscilloscopeRenderer.render(
                canvas,
                vu,
                this.caches.channelFreqs[channel],
                this.caches.channelInstruments[channel] || 0,
                channel,
                this.oscilloscopeLineColor,
                this.oscilloscopeBackgroundColor,
            );
        }
    }

    private seekFromClientX(clientX: number): void {
        if (!this.state.durationSeconds) {
            return;
        }

        const bounds = this.elements.progressBar.getBoundingClientRect();
        if (bounds.width <= 0) {
            return;
        }

        const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
        const seconds = ratio * this.state.durationSeconds;
        const targetSeconds = this.syncLegacyModuleToSeconds(seconds);
        this.player.seek(targetSeconds);

        const now = performance.now();
        this.state.lastFrameTime = now;
        this.state.lastSeekTime = now;

        this.updateProgressUi(targetSeconds, this.state.durationSeconds);
    }

    private syncLegacyModuleToSeconds(seconds: number): number {
        if (!this.state.legacyModule || !this.state.uiModulePtr) {
            return seconds;
        }

        const safeSeconds = Math.max(0, seconds);
        const targetOrder = this.getOrderForSeconds(safeSeconds);

        this.state.legacyModule.ccall(
            "openmpt_module_set_position_order_row",
            "number",
            ["number", "number", "number"],
            [this.state.uiModulePtr, targetOrder, 0],
        );
        this.state.legacyModule.ccall(
            "openmpt_module_set_position_seconds",
            "number",
            ["number", "number"],
            [this.state.uiModulePtr, safeSeconds],
        );

        this.state.currentRow = -1;
        return this.state.legacyModule._openmpt_module_get_position_seconds(this.state.uiModulePtr);
    }

    private getOrderForSeconds(seconds: number): number {
        const totalOrders = this.getTotalOrders();
        if (totalOrders <= 0) {
            return 0;
        }

        this.ensureOrderStartSeconds();

        let targetOrder = 0;
        for (let orderIndex = 0; orderIndex < totalOrders; orderIndex += 1) {
            const orderSeconds = this.caches.orderStartSeconds.get(orderIndex) ?? 0;
            if (orderSeconds > seconds) {
                break;
            }
            targetOrder = orderIndex;
        }

        return targetOrder;
    }

    private getOrderStartSeconds(orderIndex: number): number {
        this.ensureOrderStartSeconds();
        return this.caches.orderStartSeconds.get(orderIndex) ?? 0;
    }

    private ensureOrderStartSeconds(): void {
        if (!this.state.legacyModule || !this.state.uiModulePtr) {
            return;
        }

        const totalOrders = this.getTotalOrders();
        if (totalOrders <= 0 || this.caches.orderStartSeconds.size === totalOrders) {
            return;
        }

        const currentSeconds = this.state.legacyModule._openmpt_module_get_position_seconds(this.state.uiModulePtr);
        this.caches.orderStartSeconds.clear();

        for (let orderIndex = 0; orderIndex < totalOrders; orderIndex += 1) {
            this.state.legacyModule.ccall(
                "openmpt_module_set_position_order_row",
                "number",
                ["number", "number", "number"],
                [this.state.uiModulePtr, orderIndex, 0],
            );
            this.caches.orderStartSeconds.set(
                orderIndex,
                this.state.legacyModule._openmpt_module_get_position_seconds(this.state.uiModulePtr),
            );
        }

        this.state.legacyModule.ccall(
            "openmpt_module_set_position_seconds",
            "number",
            ["number", "number"],
            [this.state.uiModulePtr, currentSeconds],
        );
    }

    private updateProgressUi(currentSeconds: number, totalSeconds: number): void {
        const safeCurrent = Math.max(0, currentSeconds);
        const safeTotal = Math.max(0, totalSeconds);
        const ratio = safeTotal > 0 ? Math.max(0, Math.min(1, safeCurrent / safeTotal)) : 0;
        const percent = ratio * 100;
        const currentLabel = formatDuration(safeCurrent);
        const totalLabel = safeTotal > 0 ? formatDuration(safeTotal) : "--:--";

        if (currentLabel !== this.state.lastProgressCurrentLabel) {
            this.elements.progressCurrent.textContent = currentLabel;
            this.state.lastProgressCurrentLabel = currentLabel;
        }
        if (totalLabel !== this.state.lastProgressTotalLabel) {
            this.elements.progressTotal.textContent = totalLabel;
            this.state.lastProgressTotalLabel = totalLabel;
        }
        if (percent !== this.state.lastProgressPercent) {
            this.elements.progressFill.style.width = `${percent}%`;
            this.elements.progressHandler.style.left = `${percent}%`;
            this.state.lastProgressPercent = percent;
        }
    }

    private getTotalOrders(): number {
        if (this.state.totalOrders > 0) {
            return this.state.totalOrders;
        }
        if (!this.state.legacyModule || !this.state.uiModulePtr) {
            return 0;
        }
        this.state.totalOrders = this.state.legacyModule.ccall(
            "openmpt_module_get_num_orders",
            "number",
            ["number"],
            [this.state.uiModulePtr],
        );
        return this.state.totalOrders;
    }

    private getTotalPatterns(): number {
        if (this.state.totalPatterns > 0) {
            return this.state.totalPatterns;
        }
        if (!this.state.legacyModule || !this.state.uiModulePtr) {
            return 0;
        }
        this.state.totalPatterns = this.state.legacyModule.ccall(
            "openmpt_module_get_num_patterns",
            "number",
            ["number"],
            [this.state.uiModulePtr],
        );
        return this.state.totalPatterns;
    }

    private getCurrentPatternRowCount(patternIndex: number): number {
        if (patternIndex < 0) {
            return 0;
        }
        const cachedCount = this.caches.patternRowCounts.get(patternIndex);
        if (cachedCount !== undefined) {
            return cachedCount;
        }
        if (!this.state.legacyModule || !this.state.uiModulePtr) {
            return 0;
        }
        const rowCount = this.state.legacyModule._openmpt_module_get_pattern_num_rows(
            this.state.uiModulePtr,
            patternIndex,
        );
        this.caches.patternRowCounts.set(patternIndex, rowCount);
        return rowCount;
    }

    private cacheChannelElements(): void {
        for (let channel = 0; channel < this.maxChannels; channel += 1) {
            this.caches.channelCanvases[channel] =
                channel < this.state.numChannels
                    ? (document.getElementById(`canvas-${channel}`) as HTMLCanvasElement | null)
                    : null;
            this.caches.channelVuFills[channel] =
                channel < this.state.numChannels ? document.getElementById(`vu-fill-${channel}`) : null;
        }
    }

    private schedulePatternLayoutSync(): void {
        if (this.state.patternLayoutSyncScheduled) {
            return;
        }

        this.state.patternLayoutSyncScheduled = true;
        requestAnimationFrame(() => {
            this.state.patternLayoutSyncScheduled = false;
            this.patternView.updatePadding();
            if (this.state.currentRow >= 0) {
                this.patternView.highlightRow(this.state.currentRow);
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

    private getMaxOscHeight(): number {
        const containerHeight = this.elements.mainContainer.getBoundingClientRect().height;
        const statusHeight = this.elements.topStatus.parentElement?.getBoundingClientRect().height ?? 0;
        const resizerHeight = this.elements.oscResizer.getBoundingClientRect().height;
        return Math.max(
            APP_CONSTANTS.minOscHeight,
            containerHeight - statusHeight - resizerHeight - APP_CONSTANTS.patternMinHeight,
        );
    }

    private applyOscHeight(height: number, persist = true): void {
        if (height < APP_CONSTANTS.oscHideThreshold) {
            this.applyOscHiddenState(persist);
            return;
        }

        const clampedHeight = Math.max(APP_CONSTANTS.minOscHeight, Math.min(this.getMaxOscHeight(), height));
        this.state.preferredOscHidden = false;
        this.state.preferredOscHeight = clampedHeight;
        this.elements.oscView.classList.remove("osc-view--hidden");
        this.elements.oscView.style.height = `${clampedHeight}px`;
        if (persist) {
            writeStorage(APP_CONSTANTS.storageKeyOscHeight, String(Math.round(clampedHeight)));
        }
    }

    private applyOscHiddenState(persist = true): void {
        this.state.preferredOscHidden = true;
        this.elements.oscView.classList.add("osc-view--hidden");
        this.elements.oscView.style.height = "0px";

        if (persist) {
            writeStorage(APP_CONSTANTS.storageKeyOscHeight, "0");
        }
    }

    private isOscHidden(): boolean {
        return this.elements.oscView.classList.contains("osc-view--hidden");
    }
}
