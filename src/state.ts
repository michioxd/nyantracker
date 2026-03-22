import type { LegacyOpenMptModule } from "./lib/legacy-openmpt";
import type { PatternCell } from "./components/formatters";

export interface TrackerRuntimeState {
    legacyModule: LegacyOpenMptModule | null;
    uiModulePtr: number;
    dummyBufferPtr: number;
    numChannels: number;
    currentRow: number;
    lastFrameTime: number;
    uiLoopStarted: boolean;
    currentFileName: string;
    durationSeconds: number;
    seeking: boolean;
    lastSeekTime: number;
    totalOrders: number;
    totalPatterns: number;
    lastProgressPercent: number;
    lastProgressCurrentLabel: string;
    lastProgressTotalLabel: string;
    requestedPatternIndex: number;
    patternPrefetchScheduled: boolean;
    patternLayoutSyncScheduled: boolean;
    preferredOscHeight: number | null;
    preferredOscHidden: boolean;
    pendingSharedSong: string | null;
    pendingSharedSongAutoplay: boolean;
    browserQuerySyncTimeout: number | null;
    fractionalFrames: number;
}

export function createTrackerRuntimeState(): TrackerRuntimeState {
    return {
        legacyModule: null,
        uiModulePtr: 0,
        dummyBufferPtr: 0,
        numChannels: 0,
        currentRow: -1,
        lastFrameTime: 0,
        uiLoopStarted: false,
        currentFileName: "--",
        durationSeconds: 0,
        seeking: false,
        lastSeekTime: 0,
        totalOrders: 0,
        totalPatterns: 0,
        lastProgressPercent: -1,
        lastProgressCurrentLabel: "",
        lastProgressTotalLabel: "",
        requestedPatternIndex: -1,
        patternPrefetchScheduled: false,
        patternLayoutSyncScheduled: false,
        preferredOscHeight: null,
        preferredOscHidden: false,
        pendingSharedSong: null,
        pendingSharedSongAutoplay: false,
        browserQuerySyncTimeout: null,
        fractionalFrames: 0,
    };
}

export interface TrackerCaches {
    patternCache: Map<number, PatternCell[][]>;
    patternPrefetchQueue: number[];
    patternPrefetchInFlight: Set<number>;
    orderStartSeconds: Map<number, number>;
    patternRowCounts: Map<number, number>;
    channelFreqs: Float32Array;
    channelInstruments: Uint8Array;
    channelCanvases: Array<HTMLCanvasElement | null>;
    channelVuFills: Array<HTMLElement | null>;
}

export function createTrackerCaches(maxChannels: number): TrackerCaches {
    return {
        patternCache: new Map<number, PatternCell[][]>(),
        patternPrefetchQueue: [],
        patternPrefetchInFlight: new Set<number>(),
        orderStartSeconds: new Map<number, number>(),
        patternRowCounts: new Map<number, number>(),
        channelFreqs: new Float32Array(maxChannels),
        channelInstruments: new Uint8Array(maxChannels),
        channelCanvases: new Array<HTMLCanvasElement | null>(maxChannels).fill(null),
        channelVuFills: new Array<HTMLElement | null>(maxChannels).fill(null),
    };
}
