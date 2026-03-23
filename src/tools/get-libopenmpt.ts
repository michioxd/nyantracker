/// <reference types="node" />

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "fflate";

const VER = "0.8.5";
const URL = `https://lib.openmpt.org/files/libopenmpt/dev/libopenmpt-${VER}+release.dev.js.tar.gz`;
const DIR = "../lib/wasm";
const ARCHIVE_PREFIX = `libopenmpt-${VER}+release/bin/wasm/`;

interface TarEntry {
    name: string;
    type: string;
    data: Uint8Array;
}

function getScriptDirectory(): string {
    return dirname(fileURLToPath(import.meta.url));
}

function getTargetDirectory(): string {
    return resolve(getScriptDirectory(), DIR);
}

function isZeroBlock(block: Uint8Array): boolean {
    return block.every((byte) => byte === 0);
}

function decodeString(bytes: Uint8Array): string {
    const end = bytes.indexOf(0);
    const slice = end === -1 ? bytes : bytes.subarray(0, end);
    return new TextDecoder().decode(slice).trim();
}

function readOctal(bytes: Uint8Array): number {
    const value = decodeString(bytes).replace(/\0/g, "").trim();
    return value ? Number.parseInt(value, 8) : 0;
}

function parseTarArchive(archive: Uint8Array): TarEntry[] {
    const entries: TarEntry[] = [];
    let offset = 0;

    while (offset + 512 <= archive.length) {
        const header = archive.subarray(offset, offset + 512);
        if (isZeroBlock(header)) {
            break;
        }

        const name = decodeString(header.subarray(0, 100));
        const prefix = decodeString(header.subarray(345, 500));
        const fullName = prefix ? `${prefix}/${name}` : name;
        const size = readOctal(header.subarray(124, 136));
        const type = decodeString(header.subarray(156, 157)) || "0";
        const dataStart = offset + 512;
        const dataEnd = dataStart + size;

        entries.push({
            name: fullName,
            type,
            data: archive.subarray(dataStart, dataEnd),
        });

        offset = dataStart + Math.ceil(size / 512) * 512;
    }

    return entries;
}

async function downloadArchive(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }

    return new Uint8Array(await response.arrayBuffer());
}

async function extractWasmDirectory(targetDir: string, archive: Uint8Array): Promise<string[]> {
    const extractedFiles: string[] = [];
    const entries = parseTarArchive(archive);

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });

    for (const entry of entries) {
        if (!entry.name.startsWith(ARCHIVE_PREFIX) || entry.type === "5") {
            continue;
        }

        const relativePath = entry.name.slice(ARCHIVE_PREFIX.length);
        if (!relativePath) {
            continue;
        }

        const outputPath = resolve(targetDir, relativePath);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, entry.data);
        extractedFiles.push(outputPath);
    }

    if (extractedFiles.length === 0) {
        throw new Error(`Could not find ${ARCHIVE_PREFIX} in downloaded archive.`);
    }

    return extractedFiles;
}

async function main(): Promise<void> {
    try {
        const targetDir = getTargetDirectory();

        console.log(`Downloading libopenmpt ${VER}...`);
        const compressedArchive = await downloadArchive(URL);

        console.log("Decompressing archive...");
        const tarArchive = gunzipSync(compressedArchive);

        console.log(`Extracting ${ARCHIVE_PREFIX} to ${targetDir}...`);
        const extractedFiles = await extractWasmDirectory(targetDir, tarArchive);

        console.log(`Done. Extracted ${extractedFiles.length} file(s).`);
    } catch (error) {
        console.error("Error:", error);
        throw error;
    }
}

await main().catch((error: unknown) => {
    console.error("Failed to fetch libopenmpt:", error);
    process.exitCode = 1;
});
