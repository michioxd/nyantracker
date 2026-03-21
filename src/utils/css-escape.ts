export function cssEscape(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
    }

    return value.replace(/(["\\#.:\[\]>+~*^$|=\s])/g, "\\$1");
}
