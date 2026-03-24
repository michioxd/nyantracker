# nyantracker player

![GitHub License](https://img.shields.io/github/license/michioxd/nyantracker)
 ![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/michioxd/nyantracker/build.yml)
![Website](https://img.shields.io/website?url=http%3A%2F%2Fnyantracker.michioxd.ch%2F)

A simple web-based player for chiptune music modules or music tracker, built with WebAssembly and TypeScript. It supports various module formats and provides a user-friendly interface for playback and navigation. Using [DrSnuggles's chiptune3](https://github.com/DrSnuggles/chiptune) for playback (via [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)) and [libopenmpt (WASM)](https://lib.openmpt.org/libopenmpt) for pattern viewer.

![screenshot](https://github.com/user-attachments/assets/8f80792f-6bc0-492c-9432-9b16c1544129)

## Features

- Support for various module formats (e.g., MOD, XM, S3M, IT)
- Pattern viewer for visualizing the music structure
- Oscilloscope for visualizing each channel's output
- Support multiple sources (local files, modland.com, etc.). You can create your own source by implementing the [`BrowserSource`](./src/sources/base.ts) interface.
- Support multiple color themes.

## Development

You must have the latest version of [bun](https://bun.sh/). If not, please install it first.

```bash
git clone https://github.com/michioxd/nyantracker.git
cd nyantracker
bun i
bun dev
```

Then open `http://localhost:5173` in your browser to see the player in action.

To build the project, run:

```bash
bun run build
```

## Contributing

Contributions are welcome! If you have any ideas, suggestions, or bug reports, please open an issue or submit a pull request. Please make sure to follow the existing code style and include tests for any new features or bug fixes.

**AI-generated (or *vibe-coded*) contributions are not accepted at this time.**

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
