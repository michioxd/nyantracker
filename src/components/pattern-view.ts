import type { PatternCell } from "./formatters";

export class PatternView {
    private currentPattern = -1;
    private currentRow = -1;
    private pendingHighlightedRow = -1;
    private activeRowElement: HTMLElement | null = null;
    private readonly header: HTMLElement;
    private readonly body: HTMLElement;
    private readonly oscilloscopeContainer: HTMLElement;

    constructor(header: HTMLElement, body: HTMLElement, oscilloscopeContainer: HTMLElement) {
        this.header = header;
        this.body = body;
        this.oscilloscopeContainer = oscilloscopeContainer;
    }

    initializeChannels(channelCount: number): void {
        this.header.innerHTML = '<div class="row-number-header"></div>';
        this.oscilloscopeContainer.innerHTML = "";

        let rows = 1;
        if (channelCount > 32) rows = 8;
        else if (channelCount > 16) rows = 4;
        else if (channelCount > 8) rows = 3;
        else if (channelCount > 4) rows = 2;
        else rows = 1;

        const columns = Math.ceil(channelCount / rows);
        this.oscilloscopeContainer.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
        this.oscilloscopeContainer.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;

        for (let channel = 0; channel < channelCount; channel += 1) {
            const headerElement = document.createElement("div");
            headerElement.className = "channel-header";
            headerElement.innerHTML = `
        <div class="vu-bg">
          <div class="vu-gradient" id="vu-fill-${channel}"></div>
        </div>
        <div class="ch-text">CH ${channel + 1}</div>
      `;
            this.header.appendChild(headerElement);

            const oscElement = document.createElement("div");
            oscElement.className = "osc-box";
            oscElement.innerHTML = `
        <div class="osc-label">CH ${channel + 1}</div>
        <canvas id="canvas-${channel}"></canvas>
      `;
            this.oscilloscopeContainer.appendChild(oscElement);
        }

        this.currentPattern = -1;
        this.currentRow = -1;
        this.activeRowElement = null;
    }

    renderPattern(patternIndex: number, rows: PatternCell[][]): void {
        this.currentPattern = patternIndex;
        this.currentRow = -1;
        this.pendingHighlightedRow = -1;

        if (this.activeRowElement) {
            this.activeRowElement.classList.remove("active");
            this.activeRowElement = null;
        }

        const existingRows = this.body.querySelectorAll(".pattern-row");

        if (existingRows.length === rows.length && existingRows.length > 0) {
            requestAnimationFrame(() => {
                for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                    const rowData = rows[rowIndex];
                    const rowDiv = existingRows[rowIndex];
                    for (let colIndex = 0; colIndex < rowData.length; colIndex++) {
                        const cell = rowData[colIndex];
                        const channelDiv = rowDiv.children[colIndex + 1];
                        if (!channelDiv) continue;

                        const spans = channelDiv.children;
                        const noteClass =
                            cell.note !== "---" && cell.note !== "===" && cell.note !== "^^^" ? "nt" : "em";
                        const instClass = cell.inst !== "--" ? "in" : "em";
                        const effectClass = cell.eff !== "..." ? "ef" : "em";

                        if (spans[0].textContent !== cell.note) {
                            spans[0].textContent = cell.note;
                            spans[0].className = noteClass;
                        }
                        if (spans[1].textContent !== cell.inst) {
                            spans[1].textContent = cell.inst;
                            spans[1].className = instClass;
                        }
                        if (spans[2].textContent !== cell.eff) {
                            spans[2].textContent = cell.eff;
                            spans[2].className = effectClass;
                        }
                    }
                }
                if (this.pendingHighlightedRow >= 0) {
                    const rowToHighlight = this.pendingHighlightedRow;
                    this.pendingHighlightedRow = -1;
                    this.highlightRow(rowToHighlight);
                }
            });
            return;
        }

        const htmlParts: string[] = [];
        htmlParts.push('<div id="top-spacer"></div>');

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex];
            htmlParts.push(`<div class="pattern-row" id="row-${rowIndex}">`);
            htmlParts.push(`<div class="row-num">${rowIndex.toString().padStart(2, "0")}</div>`);

            for (let colIndex = 0; colIndex < row.length; colIndex++) {
                const cell = row[colIndex];
                const noteClass = cell.note !== "---" && cell.note !== "===" && cell.note !== "^^^" ? "nt" : "em";
                const instClass = cell.inst !== "--" ? "in" : "em";
                const effectClass = cell.eff !== "..." ? "ef" : "em";

                htmlParts.push(
                    `<div class="channel-data"><span class="${noteClass}">${cell.note}</span><span class="${instClass}">${cell.inst}</span><span class="${effectClass}">${cell.eff}</span></div>`,
                );
            }
            htmlParts.push("</div>");
        }

        htmlParts.push('<div id="bottom-spacer"></div>');

        requestAnimationFrame(() => {
            this.body.innerHTML = htmlParts.join("");
            this.updatePadding();

            if (this.pendingHighlightedRow >= 0) {
                const rowToHighlight = this.pendingHighlightedRow;
                this.pendingHighlightedRow = -1;
                this.highlightRow(rowToHighlight);
            }
        });
    }

    highlightRow(row: number): void {
        if (row === this.currentRow) {
            return;
        }

        this.currentRow = row;
        if (this.activeRowElement) {
            this.activeRowElement.classList.remove("active");
        }

        const activeRow = this.body.children[row + 1] as HTMLElement;
        if (!activeRow || !activeRow.classList.contains("pattern-row")) {
            this.pendingHighlightedRow = row;
            this.currentRow = -1;
            this.activeRowElement = null;
            return;
        }

        this.pendingHighlightedRow = -1;
        activeRow.classList.add("active");
        this.activeRowElement = activeRow;

        this.body.scrollTop = row * 20;
    }

    updatePadding(): void {
        const topSpacer = this.body.firstElementChild as HTMLElement;
        const bottomSpacer = this.body.lastElementChild as HTMLElement;
        if (!topSpacer || !bottomSpacer || topSpacer.id !== "top-spacer") {
            return;
        }

        const rowHeight = 20;
        const padding = Math.max(0, this.body.offsetHeight / 2 - rowHeight / 2);
        topSpacer.style.height = `${padding}px`;
        bottomSpacer.style.height = `${padding}px`;
    }

    getCurrentPattern(): number {
        return this.currentPattern;
    }

    resetPlaybackState(): void {
        if (this.activeRowElement) {
            this.activeRowElement.classList.remove("active");
        }

        this.currentRow = -1;
        this.pendingHighlightedRow = -1;
        this.activeRowElement = null;
        this.body.scrollTop = 0;
    }
}
