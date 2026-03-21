import { defineConfig } from "vite";
import { execSync } from "child_process";
import { ViteMinifyPlugin } from "vite-plugin-minify";
import preload from "vite-plugin-preload";
import viteCompression from "vite-plugin-compression";

const buildTime = Date.now();
const gitCommit = execSync("git rev-parse --short HEAD").toString().trim();
const gitCommitFull = execSync("git rev-parse HEAD").toString().trim();

export default defineConfig({
    plugins: [
        ViteMinifyPlugin({
            ignoreCustomComments: [],
        }),
        viteCompression(),
        preload(),
    ],
    define: {
        "import.meta.env.VITE_BUILD_TIME": JSON.stringify(buildTime),
        "import.meta.env.VITE_GIT_COMMIT": JSON.stringify(gitCommit),
        "import.meta.env.VITE_GIT_COMMIT_FULL": JSON.stringify(gitCommitFull),
    },
    build: {
        minify: "terser",
        sourcemap: "hidden",
        cssCodeSplit: false,
        terserOptions: {
            parse: {
                html5_comments: false,
            },
            format: {
                comments: false,
            },
        },
    },
});
