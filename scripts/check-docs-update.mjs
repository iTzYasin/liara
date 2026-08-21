import { execFile } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const repository = process.env.LIARA_DOCS_REPOSITORY ?? "https://github.com/liara-cloud/docs.git";
const branch = process.env.LIARA_DOCS_BRANCH ?? "master";
const timeoutMs = Number(process.env.DOCS_CHECK_TIMEOUT_MS ?? 10_000);
const indexPath = process.env.DOCS_INDEX_PATH
  ? path.resolve(process.env.DOCS_INDEX_PATH)
  : path.join(root, "data", "liara-docs-index.json");

const index = JSON.parse(await readFile(indexPath, "utf8"));
const currentCommit = String(index.sourceCommit ?? "").trim();
if (!/^[0-9a-f]{7,40}$/i.test(currentCommit)) {
  throw new Error(`Docs index at ${indexPath} has an invalid sourceCommit`);
}

let stdout;
try {
  ({ stdout } = await execFileAsync("git", [
    "ls-remote",
    repository,
    `refs/heads/${branch}`,
  ], { timeout: timeoutMs }));
} catch (error) {
  if (error?.killed || error?.signal) {
    throw new Error(`Docs upstream check timed out after ${timeoutMs}ms`, { cause: error });
  }
  throw error;
}
const upstreamCommit = stdout.trim().split(/\s+/)[0] ?? "";
if (!/^[0-9a-f]{40}$/i.test(upstreamCommit)) {
  throw new Error(`Could not resolve ${repository}#${branch}`);
}

const changed = currentCommit.length === 40
  ? upstreamCommit !== currentCommit
  : !upstreamCommit.startsWith(currentCommit);
const values = {
  changed: String(changed),
  current_commit: currentCommit,
  upstream_commit: upstreamCommit,
};

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
    "utf8",
  );
}

console.log(changed
  ? `Liara docs changed: ${currentCommit} -> ${upstreamCommit.slice(0, 7)}`
  : `Liara docs index is current at ${currentCommit}.`);
