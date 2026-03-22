export const APP_CONSTANTS = {
    sampleRate: 48000,
    readChunkSize: 4096,
    searchQuerySyncDelayMs: 700,
    queryKeySearch: "search",
    queryKeyType: "type",
    queryKeyPlaying: "playing",
    storageKeyTweakbarHidden: "nyantracker:tweakbar-hidden",
    storageKeyColorScheme: "nyantracker:color-scheme",
    storageKeyVolume: "nyantracker:volume",
    storageKeySearch: "nyantracker:modland-search",
    storageKeySource: "nyantracker:browser-source",
    storageKeyBrowserWidth: "nyantracker:browser-width",
    storageKeyBrowserOpen: "nyantracker:browser-open",
    storageKeyOscHeight: "nyantracker:osc-height",
    minBrowserWidth: 280,
    minTrackerWidth: 520,
    minOscHeight: 200,
    patternMinHeight: 120,
    oscHideThreshold: 100,
} as const;

export const COLOR_SCHEMES = [
    { id: "default", label: "Default", oscColor: "#4ade80", oscBg: "#0c0c0c" },
    { id: "neon-blue", label: "Neon Blue", oscColor: "#56d6ff", oscBg: "#08101f" },
    { id: "amber-dusk", label: "Amber Dusk", oscColor: "#ffd27a", oscBg: "#120e08" },
    { id: "violet-pulse", label: "Violet Pulse", oscColor: "#9a8cff", oscBg: "#0b0612" },
    { id: "dracula", label: "Dracula", oscColor: "#bd93f9", oscBg: "#191a21" },
    { id: "monokai", label: "Monokai", oscColor: "#a6e22e", oscBg: "#1f201b" },
    { id: "solarized", label: "Solarized", oscColor: "#2aa198", oscBg: "#002b36" },
] as const;

export type ColorSchemeId = (typeof COLOR_SCHEMES)[number]["id"];

export type ColorSchemeDefinition = (typeof COLOR_SCHEMES)[number];

const LEGACY_COLOR_SCHEME_ALIASES = {
    fasttracker2: "neon-blue",
    protracker: "amber-dusk",
    screamtracker: "violet-pulse",
} as const;

export function resolveColorSchemeId(value: string | null | undefined): ColorSchemeId {
    if (!value) {
        return "default";
    }

    const aliasMatch = LEGACY_COLOR_SCHEME_ALIASES[value as keyof typeof LEGACY_COLOR_SCHEME_ALIASES];
    if (aliasMatch) {
        return aliasMatch;
    }

    const matchedColorScheme = COLOR_SCHEMES.find((colorScheme) => colorScheme.id === value);
    return matchedColorScheme?.id ?? "default";
}

export function getColorSchemeDefinition(colorSchemeId: ColorSchemeId): ColorSchemeDefinition {
    return COLOR_SCHEMES.find((colorScheme) => colorScheme.id === colorSchemeId) ?? COLOR_SCHEMES[0];
}
