// Test-only bundle (no Vite needed): esbuild + the same source, pointed at the mock server.
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const out = process.argv[2] ?? "test/e2e/dist";
const apiUrl = process.argv[3] ?? "http://127.0.0.1:8787";
mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  outfile: `${out}/app.js`,
  format: "esm",
  jsx: "automatic",
  nodePaths: [process.env.EXTRA_NODE_PATH ?? ""],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(apiUrl),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("test-anon-key"),
    "process.env.NODE_ENV": '"production"',
  },
  logLevel: "warning",
});
const html = readFileSync("index.html", "utf8")
  .replace('<script type="module" src="/src/main.tsx"></script>', '<link rel="stylesheet" href="/app.css"><script type="module" src="/app.js"></script>');
writeFileSync(`${out}/index.html`, html);
console.log("built", out);
