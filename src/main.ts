import "./style.scss";

import { nyantracker } from "./app";

function getElement<T extends HTMLElement>(parent: ParentNode, selector: string): T {
    const element = parent.querySelector<T>(selector);
    if (!element) {
        throw new Error(`Missing required element: ${selector}`);
    }
    return element;
}

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
    throw new Error("App root not found.");
}

const trackerApp = new nyantracker(appRoot, {
    songSelector: getElement<HTMLElement>(appRoot, ".song-selector"),
    browserResizer: getElement<HTMLElement>(appRoot, ".resize-browser"),
    btnToggleBrowser: getElement<HTMLButtonElement>(appRoot, "#btnToggleBrowser"),
    sourceSelect: getElement<HTMLSelectElement>(appRoot, "#sourceSelect"),
    searchInput: getElement<HTMLInputElement>(appRoot, "#searchInput"),
    btnSongPrev: getElement<HTMLButtonElement>(appRoot, "#btnSongPrev"),
    btnPagePrev: getElement<HTMLButtonElement>(appRoot, "#btnPagePrev"),
    songPageInfo: getElement<HTMLElement>(appRoot, "#songPageInfo"),
    btnPageNext: getElement<HTMLButtonElement>(appRoot, "#btnPageNext"),
    btnSongNext: getElement<HTMLButtonElement>(appRoot, "#btnSongNext"),
    songList: getElement<HTMLElement>(appRoot, "#songList"),
    fileInput: getElement<HTMLInputElement>(appRoot, "#fileInput"),
    fileLabel: getElement<HTMLLabelElement>(appRoot, "#fileLabel"),
    btnPrevPat: getElement<HTMLButtonElement>(appRoot, "#btnPrevPat"),
    btnPlay: getElement<HTMLButtonElement>(appRoot, "#btnPlay"),
    btnNextPat: getElement<HTMLButtonElement>(appRoot, "#btnNextPat"),
    btnStop: getElement<HTMLButtonElement>(appRoot, "#btnStop"),
    btnShowTweaks: getElement<HTMLButtonElement>(appRoot, "#btnShowTweaks"),
    tweakBar: getElement<HTMLElement>(appRoot, "#tweak-bar"),
    progressCurrent: getElement<HTMLElement>(appRoot, "#progress-current"),
    progressTotal: getElement<HTMLElement>(appRoot, "#progress-total"),
    progressBar: getElement<HTMLElement>(appRoot, ".progress-bar"),
    progressHandler: getElement<HTMLElement>(appRoot, ".progress-handler"),
    progressFill: getElement<HTMLElement>(appRoot, "#progress-fill"),
    posDisplay: getElement<HTMLElement>(appRoot, "#pos-display"),
    patDisplay: getElement<HTMLElement>(appRoot, "#pat-display"),
    rowDisplay: getElement<HTMLElement>(appRoot, "#row-display"),
    topStatus: getElement<HTMLElement>(appRoot, "#top-status"),
    titleDisplay: getElement<HTMLElement>(appRoot, "#title-display"),
    volumeSlider: getElement<HTMLInputElement>(appRoot, "#volume-slider"),
    volumeOutput: getElement<HTMLOutputElement>(appRoot, "#volume-output"),
    pitchSlider: getElement<HTMLInputElement>(appRoot, "#pitch-slider"),
    pitchOutput: getElement<HTMLOutputElement>(appRoot, "#pitch-output"),
    tempoSlider: getElement<HTMLInputElement>(appRoot, "#tempo-slider"),
    tempoOutput: getElement<HTMLOutputElement>(appRoot, "#tempo-output"),
    mainContainer: getElement<HTMLElement>(appRoot, ".main-container"),
    patternViewContainer: getElement<HTMLElement>(appRoot, ".pattern-view"),
    patternHeader: getElement<HTMLElement>(appRoot, "#pattern-header"),
    patternBody: getElement<HTMLElement>(appRoot, "#pattern-body"),
    oscResizer: getElement<HTMLElement>(appRoot, ".resize-osc"),
    oscView: getElement<HTMLElement>(appRoot, "#osc-view"),
    dropZone: getElement<HTMLElement>(appRoot, "#drop-zone"),
    dropIndicator: getElement<HTMLElement>(appRoot, "#drop-indicator"),
});

void trackerApp.init();
