import { ChiptuneJsPlayer, type ChiptuneMetadata, type ChiptuneProgress } from "chiptune3";

export interface PlayerControllerEvents {
    onReady: () => void;
    onMetadata: (metadata: ChiptuneMetadata) => void;
    onProgress: (progress: ChiptuneProgress) => void;
    onError: (message: string) => void;
    onEnded: () => void;
}

export class PlayerController {
    private readonly repeatCount: number = -1;
    private player: ChiptuneJsPlayer | null = null;
    private initialized = false;
    private pendingBuffer: ArrayBuffer | null = null;
    private paused = true;
    private manuallyPaused = false;
    private stopped = true;
    private readonly events: PlayerControllerEvents;

    constructor(events: PlayerControllerEvents, repeatCount: number = -1) {
        this.events = events;
        this.repeatCount = repeatCount;
    }

    get isInitialized(): boolean {
        return this.initialized;
    }

    get isPaused(): boolean {
        return this.paused;
    }

    get instance(): ChiptuneJsPlayer | null {
        return this.player;
    }

    ensure(): ChiptuneJsPlayer {
        if (this.player) {
            return this.player;
        }

        const player = new ChiptuneJsPlayer({ repeatCount: this.repeatCount });
        player.onInitialized(() => {
            this.initialized = true;
            this.resumeContext();
            this.events.onReady();
            if (this.pendingBuffer) {
                const buffered = this.pendingBuffer;
                this.pendingBuffer = null;
                this.play(buffered);
            }
        });
        player.onMetadata((metadata) => this.events.onMetadata(metadata));
        player.onProgress((progress) => {
            if (this.stopped) {
                return;
            }
            if (!this.manuallyPaused) {
                this.paused = false;
            }
            this.stopped = false;
            this.events.onProgress(progress);
        });
        player.onEnded(() => {
            if (this.stopped) {
                this.paused = true;
                return;
            }
            this.manuallyPaused = false;
            if (this.repeatCount !== 0) {
                this.paused = false;
                return;
            }

            this.paused = true;
            this.stopped = true;
            this.events.onEnded();
        });
        player.onError((error) => {
            this.manuallyPaused = false;
            this.paused = true;
            this.stopped = true;
            this.events.onError(`AUDIO ENGINE FAILED (${error.type})`);
        });

        this.player = player;
        return player;
    }

    queue(buffer: ArrayBuffer): void {
        this.pendingBuffer = buffer;
    }

    play(buffer: ArrayBuffer): void {
        const player = this.ensure();
        if (!this.initialized) {
            this.pendingBuffer = buffer;
            return;
        }

        this.resumeContext();
        player.stop();
        player.play(buffer.slice(0));
        this.pendingBuffer = buffer;
        this.manuallyPaused = false;
        this.paused = false;
        this.stopped = false;
        document.body.classList.add("playing");
    }

    stop(): void {
        this.stopped = true;
        this.paused = true;
        this.player?.stop();
        this.manuallyPaused = false;
        document.body.classList.remove("playing");
    }

    togglePlayback(): boolean {
        const player = this.player;
        if (!player) {
            return this.paused;
        }

        this.resumeContext();
        if (this.paused) {
            if (this.stopped && this.pendingBuffer) {
                this.play(this.pendingBuffer);
                return this.paused;
            }
            player.unpause();
            this.manuallyPaused = false;
            this.paused = false;
            this.stopped = false;
            document.body.classList.add("playing");
        } else {
            player.pause();
            this.manuallyPaused = true;
            this.paused = true;
            document.body.classList.remove("playing");
        }
        return this.paused;
    }

    seek(seconds: number): void {
        this.player?.seek(seconds);
    }

    setVolume(value: number): void {
        this.player?.setVol(value);
    }

    setPitch(value: number): void {
        this.player?.setPitch(value);
    }

    setTempo(value: number): void {
        this.player?.setTempo(value);
    }

    private resumeContext(): void {
        const context = this.player?.context;
        if (context?.state === "suspended") {
            void context.resume();
        }
    }
}
