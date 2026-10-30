import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import legacy from "@vitejs/plugin-legacy";
import react from "@vitejs/plugin-react";
import { normalizePath, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import pkg from "./package.json";

// Browser analysis (src/app/browser-analysis.ts) reuses the offline app's
// engine straight from its source.
const PWA_SRC = normalizePath(fileURLToPath(new URL("../pwa/src", import.meta.url)));
const MADMOM_DIR = fileURLToPath(new URL("../pwa/public/madmom", import.meta.url));
const MADMOM_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
};

// That engine's beat-detection worker loads /madmom/* from the offline app's
// public folder: serve it in dev and copy it into the build.
function madmomAssets(): Plugin {
  return {
    name: "madmom-assets",
    configureServer(server) {
      server.middlewares.use("/madmom", (req, res, next) => {
        const relative = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const path = normalize(join(MADMOM_DIR, relative));
        if (!path.startsWith(MADMOM_DIR + sep) || !existsSync(path) || !statSync(path).isFile()) {
          next();
          return;
        }
        res.setHeader("Content-Type", MADMOM_TYPES[extname(path)] ?? "application/octet-stream");
        createReadStream(path).pipe(res);
      });
    },
    writeBundle(options) {
      cpSync(MADMOM_DIR, join(options.dir ?? "dist", "madmom"), { recursive: true });
    },
  };
}

export default defineConfig(() => {
  const enableLan = process.env.VITE_LAN === "1";
  return {
    define: {
      // Reported in feedback submissions; the date distinguishes deploys
      // that share a package version.
      __APP_VERSION__: JSON.stringify(
        `${pkg.version} (${new Date().toISOString().slice(0, 10)})`,
      ),
    },
    plugins: [
      react(),
      legacy({
        targets: ["chrome 63"],
        additionalLegacyPolyfills: ["regenerator-runtime/runtime"],
      }),
      madmomAssets(),
    ],
    optimizeDeps: {
      // Only reached from inside the analysis worker, so the dev server would
      // find them mid-analysis and reload the page; bundle them up front.
      include: [
        "essentia.js/dist/essentia.js-core.es.js",
        "essentia.js/dist/essentia-wasm.es.js",
      ],
    },
    resolve: {
      alias: [
        { find: /^@pwa\//, replacement: `${PWA_SRC}/` },
        // The offline app's modules import one another as "@/...".
        { find: /^@\//, replacement: `${PWA_SRC}/` },
      ],
    },
    server: {
      port: 5173,
      host: enableLan ? true : "localhost",
      ...(enableLan ? { allowedHosts: ["c-macbook.local"] } : {}),
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
        "/sitemap.xml": {
          target: "http://localhost:8000",
        },
        "/robots.txt": {
          target: "http://localhost:8000",
        },
      },
    },
    test: {
      environment: "node",
      environmentMatchGlobs: [["**/*.test.tsx", "jsdom"] as [string, "jsdom"]],
      exclude: ["e2e/**", "node_modules/**", "dist/**"],
    },
  };
});
