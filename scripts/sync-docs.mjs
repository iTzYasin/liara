import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const repository = path.join(root, "liara-docs");
const source = process.env.LIARA_DOCS_REPOSITORY ?? "https://github.com/liara-cloud/docs.git";

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

if (await exists(path.join(repository, ".git"))) {
  console.log("Updating the existing Liara docs snapshot with fast-forward only…");
  await execFileAsync("git", ["-C", repository, "pull", "--ff-only", "--depth=1", "origin", "master"]);
} else {
  console.log("Cloning the official Liara docs snapshot…");
  await execFileAsync("git", ["clone", "--depth=1", "--branch", "master", source, repository]);
}

await execFileAsync(process.execPath, [path.join(root, "scripts", "build-docs-index.mjs")], {
  cwd: root,
  env: process.env,
});
await execFileAsync(process.execPath, [path.join(root, "scripts", "build-golden-set.mjs")], {
  cwd: root,
  env: process.env,
});

const { stdout: commit } = await execFileAsync("git", ["-C", repository, "rev-parse", "--short=7", "HEAD"]);
console.log(`Docs sync completed atomically at ${commit.trim()}.`);
