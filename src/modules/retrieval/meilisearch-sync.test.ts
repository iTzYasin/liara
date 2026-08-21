import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const scriptPath = path.join(projectRoot, "scripts", "sync-meilisearch.mjs");
const temporaryDirectories: string[] = [];
const desiredSettings = {
  searchableAttributes: ["title", "heading", "breadcrumb", "path", "text", "service"],
  displayedAttributes: [
    "id", "title", "heading", "breadcrumb", "service", "url", "path", "text", "content_hash",
    "source_commit", "settings_hash",
  ],
  filterableAttributes: ["service"],
  distinctAttribute: "path",
  stopWords: ["از", "به", "در", "با", "برای", "که", "را", "این", "آن", "یک", "است", "هست", "لیارا", "سرویس", "برنامه"],
  synonyms: {
    domain: ["دامنه", "dns"],
    deploy: ["deployment", "استقرار"],
    database: ["دیتابیس", "پایگاه داده"],
    error: ["خطا", "ارور"],
    wordpress: ["وردپرس"],
    nextjs: ["next", "next.js", "نکست"],
    postgresql: ["postgres", "پستگرس"],
    backup: ["بکاپ", "پشتیبان"],
  },
};

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, normalizeJson(record[key])]));
  }
  return value;
}

const settingsHash = createHash("sha256")
  .update(JSON.stringify(normalizeJson(desiredSettings)))
  .digest("hex");

async function readJson(request: IncomingMessage) {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(Buffer.from(part));
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

describe("Meilisearch docs sync", () => {
  it("stages only the delta and atomically swaps it into the live index", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "liara-meili-sync-"));
    temporaryDirectories.push(directory);
    await mkdir(path.join(directory, "data"));
    await writeFile(path.join(directory, "data", "liara-docs-index.json"), JSON.stringify({
      sourceCommit: "abcdef1",
      chunks: [
        { id: "same", content_hash: "hash-same", text: "same text" },
        { id: "changed", content_hash: "hash-new", text: "updated text" },
        { id: "new", content_hash: "hash-new-doc", text: "new text" },
      ],
    }), "utf8");

    const addedBatches: unknown[][] = [];
    const removedBatches: unknown[][] = [];
    const swaps: unknown[] = [];
    const server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && requestUrl.pathname === "/indexes/liara_docs") {
        sendJson(response, 200, { uid: "liara_docs", primaryKey: "id" });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/indexes/liara_docs/documents/__liara_docs_sync__") {
        sendJson(response, 404, { code: "document_not_found" });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/indexes/liara_docs/settings") {
        sendJson(response, 200, desiredSettings);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/indexes/liara_docs_staging") {
        sendJson(response, 200, { uid: "liara_docs_staging", primaryKey: "id" });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/indexes/liara_docs_staging/settings") {
        sendJson(response, 200, desiredSettings);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/indexes/liara_docs_staging/documents/__liara_docs_sync__") {
        sendJson(response, 404, { code: "document_not_found" });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname.startsWith("/tasks/")) {
        sendJson(response, 200, { status: "succeeded" });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/indexes/liara_docs_staging/documents/fetch") {
        const query = await readJson(request);
        expect(query).toEqual({ fields: ["id", "content_hash"], limit: 1_000, offset: 0 });
        sendJson(response, 200, {
          results: [
            { id: "same", content_hash: "hash-same" },
            { id: "changed", content_hash: "hash-old" },
            { id: "removed", content_hash: "hash-removed" },
          ],
          offset: 0,
          limit: 1_000,
          total: 3,
        });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/indexes/liara_docs_staging/documents") {
        addedBatches.push(await readJson(request));
        sendJson(response, 202, { taskUid: 2 });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/indexes/liara_docs_staging/documents/delete-batch") {
        removedBatches.push(await readJson(request));
        sendJson(response, 202, { taskUid: 3 });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/swap-indexes") {
        swaps.push(await readJson(request));
        sendJson(response, 202, { taskUid: 4 });
        return;
      }
      sendJson(response, 500, { method: request.method, path: requestUrl.pathname });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to TCP");

    try {
      await execFileAsync(process.execPath, [scriptPath], {
        cwd: directory,
        env: {
          ...process.env,
          MEILI_API_KEY: "test-key",
          MEILI_INDEX_UID: "liara_docs",
          MEILI_URL: `http://127.0.0.1:${address.port}`,
        },
      });

      expect(addedBatches.map((batch) => batch.map((document) => (document as { id: string }).id))).toEqual([
        ["changed", "new", "__liara_docs_sync__"],
        ["changed", "new", "__liara_docs_sync__"],
      ]);
      expect(removedBatches).toEqual([["removed"], ["removed"]]);
      expect(swaps).toEqual([[{ indexes: ["liara_docs", "liara_docs_staging"] }]]);

      addedBatches.length = 0;
      removedBatches.length = 0;
      swaps.length = 0;
      const githubOutput = path.join(directory, "github-output.txt");
      await writeFile(githubOutput, "", "utf8");
      await execFileAsync(process.execPath, [scriptPath], {
        cwd: directory,
        env: {
          ...process.env,
          GITHUB_OUTPUT: githubOutput,
          MEILI_API_KEY: "test-key",
          MEILI_DEFER_STAGING_MIRROR: "true",
          MEILI_INDEX_UID: "liara_docs",
          MEILI_URL: `http://127.0.0.1:${address.port}`,
        },
      });

      expect(addedBatches.map((batch) => batch.map((document) => (document as { id: string }).id))).toEqual([
        ["changed", "new", "__liara_docs_sync__"],
      ]);
      expect(removedBatches).toEqual([["removed"]]);
      expect(swaps).toEqual([[{ indexes: ["liara_docs", "liara_docs_staging"] }]]);
      expect(await readFile(githubOutput, "utf8")).toContain("swapped=true");

      swaps.length = 0;
      await execFileAsync(process.execPath, [scriptPath, "--swap-back"], {
        cwd: directory,
        env: {
          ...process.env,
          MEILI_API_KEY: "test-key",
          MEILI_INDEX_UID: "liara_docs",
          MEILI_URL: `http://127.0.0.1:${address.port}`,
        },
      });
      expect(swaps).toEqual([[{ indexes: ["liara_docs", "liara_docs_staging"] }]]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("does not mutate Meilisearch when the live source commit is current", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "liara-meili-current-"));
    temporaryDirectories.push(directory);
    await mkdir(path.join(directory, "data"));
    await writeFile(path.join(directory, "data", "liara-docs-index.json"), JSON.stringify({
      sourceCommit: "abcdef1",
      chunks: [{ id: "same", content_hash: "hash-same", text: "same text" }],
    }), "utf8");
    const requests: string[] = [];
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      requests.push(`${request.method} ${requestUrl.pathname}`);
      if (request.method === "GET" && requestUrl.pathname === "/indexes/liara_docs") {
        sendJson(response, 200, { uid: "liara_docs", primaryKey: "id" });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/indexes/liara_docs/documents/__liara_docs_sync__") {
        sendJson(response, 200, {
          id: "__liara_docs_sync__",
          source_commit: "abcdef1",
          settings_hash: settingsHash,
        });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/indexes/liara_docs/settings") {
        sendJson(response, 200, desiredSettings);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/indexes/liara_docs_staging") {
        sendJson(response, 200, { uid: "liara_docs_staging", primaryKey: "id" });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/indexes/liara_docs_staging/documents/__liara_docs_sync__") {
        sendJson(response, 200, {
          id: "__liara_docs_sync__",
          source_commit: "abcdef1",
          settings_hash: settingsHash,
        });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/indexes/liara_docs_staging/settings") {
        sendJson(response, 200, desiredSettings);
        return;
      }
      sendJson(response, 500, { method: request.method, path: requestUrl.pathname });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to TCP");

    try {
      await execFileAsync(process.execPath, [scriptPath], {
        cwd: directory,
        env: {
          ...process.env,
          MEILI_API_KEY: "test-key",
          MEILI_INDEX_UID: "liara_docs",
          MEILI_URL: `http://127.0.0.1:${address.port}`,
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }

    expect(requests).toEqual([
      "GET /indexes/liara_docs",
      "GET /indexes/liara_docs/documents/__liara_docs_sync__",
      "GET /indexes/liara_docs/settings",
      "GET /indexes/liara_docs_staging",
      "GET /indexes/liara_docs_staging/documents/__liara_docs_sync__",
      "GET /indexes/liara_docs_staging/settings",
    ]);
  });

  it("recreates a rollback window when an unpublished candidate is still live", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "liara-meili-recovery-"));
    temporaryDirectories.push(directory);
    await mkdir(path.join(directory, "data"));
    await writeFile(path.join(directory, "data", "liara-docs-index.json"), JSON.stringify({
      sourceCommit: "abcdef1",
      chunks: [{ id: "same", content_hash: "hash-same", text: "same text" }],
    }), "utf8");

    const swaps: unknown[] = [];
    const server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && ["/indexes/liara_docs", "/indexes/liara_docs_staging"].includes(requestUrl.pathname)) {
        sendJson(response, 200, { uid: requestUrl.pathname.split("/").at(-1), primaryKey: "id" });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/indexes/liara_docs/documents/__liara_docs_sync__") {
        sendJson(response, 200, {
          id: "__liara_docs_sync__",
          source_commit: "abcdef1",
          settings_hash: settingsHash,
        });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/indexes/liara_docs_staging/documents/__liara_docs_sync__") {
        sendJson(response, 200, {
          id: "__liara_docs_sync__",
          source_commit: "0000000",
          settings_hash: settingsHash,
        });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname.endsWith("/settings")) {
        sendJson(response, 200, desiredSettings);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname.startsWith("/tasks/")) {
        sendJson(response, 200, { status: "succeeded" });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/indexes/liara_docs_staging/documents/fetch") {
        sendJson(response, 200, {
          results: [
            { id: "same", content_hash: "hash-same" },
            {
              id: "__liara_docs_sync__",
              content_hash: `source:abcdef1:settings:${settingsHash}`,
            },
          ],
          offset: 0,
          limit: 1_000,
          total: 2,
        });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/swap-indexes") {
        swaps.push(await readJson(request));
        sendJson(response, 202, { taskUid: swaps.length });
        return;
      }
      sendJson(response, 500, { method: request.method, path: requestUrl.pathname });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to TCP");

    try {
      await execFileAsync(process.execPath, [scriptPath], {
        cwd: directory,
        env: {
          ...process.env,
          MEILI_API_KEY: "test-key",
          MEILI_DEFER_STAGING_MIRROR: "true",
          MEILI_INDEX_UID: "liara_docs",
          MEILI_PUBLISHED_SOURCE_COMMIT: "0000000",
          MEILI_URL: `http://127.0.0.1:${address.port}`,
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }

    expect(swaps).toEqual([
      [{ indexes: ["liara_docs", "liara_docs_staging"] }],
      [{ indexes: ["liara_docs", "liara_docs_staging"] }],
    ]);
  });
});
