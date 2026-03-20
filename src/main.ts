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
    fileInput: getElement<HTMLInputElement>(appRoot, "#fileInput"),
    fileLabel: getElement<HTMLLabelElement>(appRoot, "#fileLabel"),
    btnPrevPat: getElement<HTMLButtonElement>(appRoot, "#btnPrevPat"),
    btnPlay: getElement<HTMLButtonElement>(appRoot, "#btnPlay"),
    btnNextPat: getElement<HTMLButtonElement>(appRoot, "#btnNextPat"),
    progressCurrent: getElement<HTMLElement>(appRoot, "#progress-current"),
    progressTotal: getElement<HTMLElement>(appRoot, "#progress-total"),
    progressBar: getElement<HTMLElement>(appRoot, ".progress-bar"),
    progressHandler: getElement<HTMLElement>(appRoot, ".progress-handler"),
    progressFill: getElement<HTMLElement>(appRoot, "#progress-fill"),
    posDisplay: getElement<HTMLElement>(appRoot, "#pos-display"),
    patDisplay: getElement<HTMLElement>(appRoot, "#pat-display"),
    rowDisplay: getElement<HTMLElement>(appRoot, "#row-display"),
    topStatus: getElement<HTMLElement>(appRoot, "#top-status"),
    fileDisplay: getElement<HTMLElement>(appRoot, "#file-display"),
    titleDisplay: getElement<HTMLElement>(appRoot, "#title-display"),
    durationDisplay: getElement<HTMLElement>(appRoot, "#duration-display"),
    libraryDisplay: getElement<HTMLElement>(appRoot, "#library-display"),
    volumeSlider: getElement<HTMLInputElement>(appRoot, "#volume-slider"),
    volumeOutput: getElement<HTMLOutputElement>(appRoot, "#volume-output"),
    pitchSlider: getElement<HTMLInputElement>(appRoot, "#pitch-slider"),
    pitchOutput: getElement<HTMLOutputElement>(appRoot, "#pitch-output"),
    tempoSlider: getElement<HTMLInputElement>(appRoot, "#tempo-slider"),
    tempoOutput: getElement<HTMLOutputElement>(appRoot, "#tempo-output"),
    patternHeader: getElement<HTMLElement>(appRoot, "#pattern-header"),
    patternBody: getElement<HTMLElement>(appRoot, "#pattern-body"),
    oscView: getElement<HTMLElement>(appRoot, "#osc-view"),
    dropZone: getElement<HTMLElement>(appRoot, "#drop-zone"),
    dropIndicator: getElement<HTMLElement>(appRoot, "#drop-indicator"),
});

void trackerApp.init();
