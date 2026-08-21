import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const scriptPath = path.join(projectRoot, "scripts", "check-docs-update.mjs");
const temporaryDirectories: string[] = [];

async function createDocsRepository() {
  const directory = await mkdtemp(path.join(tmpdir(), "liara-docs-update-"));
  temporaryDirectories.push(directory);
  const repository = path.join(directory, "docs");
  await mkdir(repository);
  await execFileAsync("git", ["init", "--initial-branch=master"], { cwd: repository });
  await execFileAsync("git", ["config", "user.name", "Docs Test"], { cwd: repository });
  await execFileAsync("git", ["config", "user.email", "docs-test@example.com"], { cwd: repository });
  await writeFile(path.join(repository, "guide.md"), "# Guide\n\nInitial documentation.\n", "utf8");
  await execFileAsync("git", ["add", "guide.md"], { cwd: repository });
  await execFileAsync("git", ["commit", "-m", "initial docs"], { cwd: repository });
  return { directory, repository };
}

async function currentCommit(repository: string) {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repository });
  return stdout.trim();
}

async function runUpdateCheck(repository: string, indexCommit: string, directory: string) {
  const indexPath = path.join(directory, "docs-index.json");
  const outputPath = path.join(directory, "github-output.txt");
  await writeFile(indexPath, JSON.stringify({ sourceCommit: indexCommit }), "utf8");
  await execFileAsync(process.execPath, [scriptPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DOCS_INDEX_PATH: indexPath,
      GITHUB_OUTPUT: outputPath,
      LIARA_DOCS_BRANCH: "master",
      LIARA_DOCS_REPOSITORY: repository,
    },
  });
  const output = await readFile(outputPath, "utf8");
  return Object.fromEntries(
    output.trim().split(/\r?\n/).map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
  );
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

describe("docs update preflight", () => {
  it("skips the expensive sync when the indexed commit is already current", async () => {
    const { directory, repository } = await createDocsRepository();
    const commit = await currentCommit(repository);

    const result = await runUpdateCheck(repository, commit, directory);

    expect(result).toEqual({
      changed: "false",
      current_commit: commit,
      upstream_commit: commit,
    });
  });

  it("enables the sync when the upstream documentation has a new commit", async () => {
    const { directory, repository } = await createDocsRepository();
    const indexedCommit = await currentCommit(repository);
    await appendFile(path.join(repository, "guide.md"), "\nUpdated documentation.\n", "utf8");
    await execFileAsync("git", ["add", "guide.md"], { cwd: repository });
    await execFileAsync("git", ["commit", "-m", "update docs"], { cwd: repository });
    const upstreamCommit = await currentCommit(repository);

    const result = await runUpdateCheck(repository, indexedCommit.slice(0, 7), directory);

    expect(result).toEqual({
      changed: "true",
      current_commit: indexedCommit.slice(0, 7),
      upstream_commit: upstreamCommit,
    });
  });

  it("fails quickly when the upstream repository does not respond", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "liara-docs-timeout-"));
    temporaryDirectories.push(directory);
    const indexPath = path.join(directory, "docs-index.json");
    await writeFile(indexPath, JSON.stringify({ sourceCommit: "abcdef1" }), "utf8");
    const server = createServer(() => {
      // Intentionally never respond so git ls-remote must be terminated by the preflight timeout.
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to TCP");

    try {
      await expect(execFileAsync(process.execPath, [scriptPath], {
        cwd: projectRoot,
        env: {
          ...process.env,
          DOCS_CHECK_TIMEOUT_MS: "50",
          DOCS_INDEX_PATH: indexPath,
          LIARA_DOCS_BRANCH: "master",
          LIARA_DOCS_REPOSITORY: `http://127.0.0.1:${address.port}/docs.git`,
        },
      })).rejects.toThrow("Docs upstream check timed out after 50ms");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
