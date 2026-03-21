import { readStorage, readStoredNumber, writeStorage } from "../utils/storage";

export interface BrowserPaneElements {
    root: HTMLElement;
    songSelector: HTMLElement;
    browserResizer: HTMLElement;
    btnToggleBrowser: HTMLButtonElement;
}

export interface BrowserPaneOptions {
    storageKeyWidth: string;
    storageKeyOpen: string;
    minWidth: number;
    minTrackerWidth: number;
    compactMediaQuery: string;
    onOpen?: () => Promise<void> | void;
    onLayoutChange?: () => void;
}

export class BrowserPaneController {
    private readonly elements: BrowserPaneElements;
    private readonly options: BrowserPaneOptions;
    private preferredWidth: number | null = null;
    private open = true;

    constructor(elements: BrowserPaneElements, options: BrowserPaneOptions) {
        this.elements = elements;
        this.options = options;
    }

    restorePersistedState(): void {
        const savedWidth = readStoredNumber(this.options.storageKeyWidth);
        if (savedWidth !== null) {
            this.preferredWidth = savedWidth;
        }

        const savedOpen = readStorage(this.options.storageKeyOpen);
        if (savedOpen !== null) {
            this.open = savedOpen !== "false";
        }

        this.applyVisibility();
    }

    bindEvents(): void {
        this.elements.btnToggleBrowser.addEventListener("click", () => {
            void this.setOpen(!this.open);
        });
    }

    bindResizers(): void {
        this.elements.browserResizer.addEventListener("pointerdown", (event) => {
            if (this.isCompactLayout()) {
                return;
            }

            const startX = event.clientX;
            const startWidth = this.open ? this.elements.songSelector.getBoundingClientRect().width : 0;
            let nextWidth = startWidth;

            this.beginResizeGesture(
                this.elements.browserResizer,
                event.pointerId,
                (moveEvent) => {
                    nextWidth = Math.max(0, startWidth + (moveEvent.clientX - startX));
                    this.previewResize(nextWidth);
                },
                () => {
                    if (nextWidth < this.options.minWidth / 2) {
                        void this.setOpen(false);
                        return;
                    }

                    this.setWidth(nextWidth);
                    if (!this.open) {
                        void this.setOpen(true);
                    } else {
                        this.elements.root.classList.remove("browser-hidden");
                        this.options.onLayoutChange?.();
                    }
                },
            );
        });
    }

    applyResponsiveLayoutState(): void {
        if (this.isCompactLayout()) {
            if (this.open) {
                this.elements.songSelector.style.width = "";
            }
            return;
        }

        if (!this.open) {
            return;
        }

        const currentWidth = this.elements.songSelector.getBoundingClientRect().width;
        this.setWidth(this.preferredWidth ?? currentWidth, false);
    }

    isOpen(): boolean {
        return this.open;
    }

    setEnabled(enabled: boolean): void {
        this.elements.btnToggleBrowser.disabled = !enabled;
    }

    async setOpen(nextOpen: boolean): Promise<void> {
        if (this.open === nextOpen) {
            return;
        }

        this.open = nextOpen;
        writeStorage(this.options.storageKeyOpen, String(nextOpen));
        this.applyVisibility();

        if (nextOpen) {
            await this.options.onOpen?.();
        }
    }

    private applyVisibility(): void {
        this.elements.root.classList.toggle("browser-hidden", !this.open);
        this.elements.btnToggleBrowser.classList.toggle("is-active", this.open);
        this.elements.btnToggleBrowser.setAttribute("aria-pressed", String(this.open));
        this.elements.btnToggleBrowser.title = this.open ? "Hide song browser" : "Show song browser";
        this.applyResponsiveLayoutState();
        this.options.onLayoutChange?.();
    }

    private previewResize(width: number): void {
        if (width < this.options.minWidth / 2) {
            this.elements.root.classList.add("browser-hidden");
            this.options.onLayoutChange?.();
            return;
        }

        this.elements.root.classList.remove("browser-hidden");
        this.elements.songSelector.style.width = `${this.clampWidth(width)}px`;
        this.options.onLayoutChange?.();
    }

    private clampWidth(width: number): number {
        const rootWidth = this.elements.root.getBoundingClientRect().width;
        const maxWidth = Math.max(this.options.minWidth, rootWidth - this.options.minTrackerWidth);
        return Math.max(this.options.minWidth, Math.min(maxWidth, width));
    }

    private setWidth(width: number, persist = true): void {
        const clampedWidth = this.clampWidth(width);
        this.preferredWidth = clampedWidth;
        this.elements.songSelector.style.width = `${clampedWidth}px`;

        if (persist) {
            writeStorage(this.options.storageKeyWidth, String(Math.round(clampedWidth)));
        }
    }

    private isCompactLayout(): boolean {
        return window.matchMedia(this.options.compactMediaQuery).matches;
    }

    private beginResizeGesture(
        handle: HTMLElement,
        pointerId: number,
        onMove: (event: PointerEvent) => void,
        onEnd?: () => void,
    ): void {
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
            onEnd?.();
        };

        handle.addEventListener("pointermove", onPointerMove);
        handle.addEventListener("pointerup", onPointerUp);
        handle.addEventListener("pointercancel", onPointerUp);
    }
}
