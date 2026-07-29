// Bundle api/index.ts + dependências em um único arquivo CommonJS
// para o Vercel serverless (evita problemas de ESM + resolução de módulos).
import { build } from "esbuild";
import { rmSync, mkdirSync } from "fs";
import { join } from "path";

const root = process.cwd();
const outdir = join(root, "api-build");
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: [join(root, "api/index.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: join(outdir, "index.cjs"),
  external: [
    // dependências nativas (bindings) — devem vir do node_modules em runtime
    "better-sqlite3",
    "bufferutil",
    "utf-8-validate",
  ],
  sourcemap: false,
  minify: false,
  logLevel: "info",
  banner: {
    // Shim para `import.meta` se aparecer em algum lugar
    js: `const __filename_polyfill = ""; const __dirname_polyfill = "";`,
  },
});

console.log("✓ Bundle criado em", outdir);
