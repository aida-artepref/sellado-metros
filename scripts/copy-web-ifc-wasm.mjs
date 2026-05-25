import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nodeModules = join(root, "node_modules", "web-ifc");
const outDir = join(root, "public", "wasm");

function walk(dir, result = []) {
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, result);
    if (stat.isFile() && entry.endsWith(".wasm")) result.push(full);
  }
  return result;
}

mkdirSync(outDir, { recursive: true });

const wasmFiles = walk(nodeModules);
if (wasmFiles.length === 0) {
  console.warn("[copy-web-ifc-wasm] No wasm files found in node_modules/web-ifc. Run npm install first.");
  process.exit(0);
}

for (const file of wasmFiles) {
  const target = join(outDir, file.split(/[\\/]/).pop());
  copyFileSync(file, target);
  console.log(`[copy-web-ifc-wasm] ${file} -> ${target}`);
}
