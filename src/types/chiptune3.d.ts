declare module "chiptune3" {
    export interface ChiptuneConfig {
        repeatCount?: number;
        stereoSeparation?: number;
        interpolationFilter?: number;
        context?: AudioContext | false;
    }

    export interface ChiptuneOrder {
        name: string;
        pat: number;
    }

    export type ChiptunePatternChannel = [number, number, number, number, number, number];
    export type ChiptunePatternRow = ChiptunePatternChannel[];

    export interface ChiptunePattern {
        name: string;
        rows: ChiptunePatternRow[];
    }

    export interface ChiptuneSong {
        channels: string[];
        instruments: string[];
        samples: string[];
        orders: ChiptuneOrder[];
        numSubsongs: number;
        patterns: ChiptunePattern[];
    }

    export interface ChiptuneMetadata {
        dur: number;
        title?: string;
        type?: string;
        message?: string;
        tracker?: string;
        originaltype?: string;
        totalOrders: number;
        totalPatterns: number;
        songs: string[];
        song: ChiptuneSong;
        libopenmptVersion?: string;
        libopenmptBuild?: string;
        [key: string]: unknown;
    }

    export interface ChiptuneProgress {
        pos: number;
        order: number;
        pattern: number;
        row: number;
    }

    export interface ChiptuneFullAudioData {
        cmd: "fullAudioData";
        meta: ChiptuneMetadata;
        data: [number[], number[]];
    }

    export class ChiptuneJsPlayer {
        constructor(config?: ChiptuneConfig);

        context: AudioContext;
        destination: AudioNode | false;
        gain: GainNode;
        processNode?: AudioWorkletNode;
        meta?: ChiptuneMetadata;
        duration?: number;
        currentTime?: number;
        order?: number;
        pattern?: number;
        row?: number;

        onInitialized(handler: () => void): void;
        onEnded(handler: () => void): void;
        onError(handler: (error: { type: string }) => void): void;
        onMetadata(handler: (meta: ChiptuneMetadata) => void): void;
        onProgress(handler: (progress: ChiptuneProgress) => void): void;
        onFullAudioData(handler: (payload: ChiptuneFullAudioData) => void): void;

        load(url: string): void;
        play(buffer: ArrayBuffer): void;
        stop(): void;
        pause(): void;
        unpause(): void;
        togglePause(): void;
        setRepeatCount(value: number): void;
        setPitch(value: number): void;
        setTempo(value: number): void;
        setPos(value: number): void;
        setOrderRow(order: number, row: number): void;
        setVol(value: number): void;
        selectSubsong(value: number): void;
        seek(value: number): void;
        getCurrentTime(): number | undefined;
        decodeAll(buffer: ArrayBuffer): void;
    }
}
