import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standaloneRoot = path.join(root, ".next", "standalone");

await mkdir(path.join(standaloneRoot, ".next"), { recursive: true });
await cp(path.join(root, "public"), path.join(standaloneRoot, "public"), {
  recursive: true,
  force: true,
});
await cp(path.join(root, ".next", "static"), path.join(standaloneRoot, ".next", "static"), {
  recursive: true,
  force: true,
});

console.log("Prepared standalone runtime assets.");
