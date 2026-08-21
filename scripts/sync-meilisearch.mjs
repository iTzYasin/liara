import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const url = process.env.MEILI_URL?.replace(/\/+$/, "");
const apiKey = process.env.MEILI_API_KEY;
const indexUid = process.env.MEILI_INDEX_UID ?? "liara_docs";
const stagingIndexUid = process.env.MEILI_STAGING_INDEX_UID ?? `${indexUid}_staging`;
const deferStagingMirror = process.env.MEILI_DEFER_STAGING_MIRROR === "true";
const publishedSourceCommit = process.env.MEILI_PUBLISHED_SOURCE_COMMIT;
const githubOutput = process.env.GITHUB_OUTPUT;
const command = process.argv[2] ?? "--sync";
const syncMarkerId = "__liara_docs_sync__";
if (!url) throw new Error("MEILI_URL is required for search:sync");
if (stagingIndexUid === indexUid) throw new Error("Meilisearch live and staging index UIDs must differ");
if (!["--sync", "--swap-back"].includes(command)) throw new Error(`Unknown command: ${command}`);

const index = JSON.parse(await readFile(path.join(root, "data", "liara-docs-index.json"), "utf8"));
if (!index.sourceCommit) throw new Error("Docs index has no sourceCommit");
const headers = { "Content-Type": "application/json" };
if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
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

async function request(apiPath, init = {}, allowed = [200, 201, 202]) {
  const response = await fetch(`${url}${apiPath}`, {
    ...init,
    headers: { ...headers, ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!allowed.includes(response.status)) {
    throw new Error(`Meilisearch ${init.method ?? "GET"} ${apiPath} failed with status ${response.status}`);
  }
  if (response.status === 204) return undefined;
  return response.json();
}

async function waitTask(taskUid) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const task = await request(`/tasks/${taskUid}`);
    if (task.status === "succeeded") return;
    if (task.status === "failed" || task.status === "canceled") {
      throw new Error(`Meilisearch task ${taskUid} ${task.status}: ${task.error?.message ?? "unknown error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Meilisearch task ${taskUid} timed out`);
}

async function enqueue(apiPath, init) {
  const task = await request(apiPath, init);
  await waitTask(task.taskUid);
}

async function writeOutput(name, value) {
  if (githubOutput) await appendFile(githubOutput, `${name}=${value}\n`, "utf8");
}

async function swapIndexes() {
  await enqueue("/swap-indexes", {
    method: "POST",
    body: JSON.stringify([{ indexes: [indexUid, stagingIndexUid] }]),
  });
}

async function ensureIndex(uid) {
  const current = await request(`/indexes/${encodeURIComponent(uid)}`, {}, [200, 404]);
  if (current?.uid) return false;
  await enqueue("/indexes", {
    method: "POST",
    body: JSON.stringify({ uid, primaryKey: "id" }),
  });
  return true;
}

function normalizeJson(value) {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeJson(value[key])]));
  }
  return value;
}

function settingsMatch(current) {
  return Object.entries(desiredSettings).every(([key, value]) => (
    JSON.stringify(normalizeJson(current?.[key])) === JSON.stringify(normalizeJson(value))
  ));
}

const settingsHash = createHash("sha256")
  .update(JSON.stringify(normalizeJson(desiredSettings)))
  .digest("hex");
const syncMarker = {
  id: syncMarkerId,
  source_commit: index.sourceCommit,
  settings_hash: settingsHash,
  content_hash: `source:${index.sourceCommit}:settings:${settingsHash}`,
};
const targetDocuments = [...index.chunks, syncMarker];

function markerMatches(marker) {
  return marker?.source_commit === index.sourceCommit && marker?.settings_hash === settingsHash;
}

function commitMatches(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  if (left.length < 7 || right.length < 7) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

async function fetchRemoteHashes(uid) {
  const hashes = {};
  const limit = 1_000;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const page = await request(`/indexes/${encodeURIComponent(uid)}/documents/fetch`, {
      method: "POST",
      body: JSON.stringify({ fields: ["id", "content_hash"], limit, offset }),
    });
    const results = Array.isArray(page.results) ? page.results : [];
    total = Number(page.total ?? results.length);
    for (const document of results) {
      if (document?.id === undefined) continue;
      hashes[String(document.id)] = String(document.content_hash ?? "");
    }
    if (results.length === 0) break;
    offset += results.length;
  }
  return hashes;
}

async function readIndexState(uid) {
  const created = await ensureIndex(uid);
  if (created) return { created, marker: undefined, settings: undefined };
  const [marker, settings] = await Promise.all([
    request(
      `/indexes/${encodeURIComponent(uid)}/documents/${encodeURIComponent(syncMarkerId)}?fields=id,source_commit,settings_hash`,
      {},
      [200, 404],
    ),
    request(`/indexes/${encodeURIComponent(uid)}/settings`),
  ]);
  return { created, marker, settings };
}

function stateMatches(state) {
  return !state.created && markerMatches(state.marker) && settingsMatch(state.settings);
}

async function syncTargetTo(uid, state) {
  if (state.created || !settingsMatch(state.settings)) {
    await enqueue(`/indexes/${encodeURIComponent(uid)}/settings`, {
      method: "PATCH",
      body: JSON.stringify(desiredSettings),
    });
  }

  const remoteHashes = await fetchRemoteHashes(uid);
  const currentHashes = Object.fromEntries(targetDocuments.map((document) => [document.id, document.content_hash]));
  const changed = targetDocuments.filter((document) => remoteHashes[document.id] !== document.content_hash);
  const removed = Object.keys(remoteHashes).filter((id) => !Object.hasOwn(currentHashes, id));

  for (let offset = 0; offset < changed.length; offset += 500) {
    await enqueue(`/indexes/${encodeURIComponent(uid)}/documents?primaryKey=id`, {
      method: "POST",
      body: JSON.stringify(changed.slice(offset, offset + 500)),
    });
  }
  for (let offset = 0; offset < removed.length; offset += 500) {
    await enqueue(`/indexes/${encodeURIComponent(uid)}/documents/delete-batch`, {
      method: "POST",
      body: JSON.stringify(removed.slice(offset, offset + 500)),
    });
  }
  return { changed: changed.length, removed: removed.length };
}

async function syncIndex() {
  await writeOutput("swapped", "false");
  let liveState = await readIndexState(indexUid);
  let stagingState = await readIndexState(stagingIndexUid);
  const candidateIsUnpublished = publishedSourceCommit
    && !commitMatches(index.sourceCommit, publishedSourceCommit);

  if (
    deferStagingMirror
    && candidateIsUnpublished
    && stateMatches(liveState)
    && commitMatches(stagingState.marker?.source_commit, publishedSourceCommit)
  ) {
    console.log(
      `Recovering rollback window: ${indexUid} has unpublished ${index.sourceCommit}; `
      + `${stagingIndexUid} still has published ${publishedSourceCommit}.`,
    );
    await swapIndexes();
    [liveState, stagingState] = [stagingState, liveState];
  }

  const liveCurrent = stateMatches(liveState);
  const stagingCurrent = stateMatches(stagingState);

  if (liveCurrent && stagingCurrent) {
    console.log(`Meilisearch live and staging indexes are current at ${index.sourceCommit}; no write required.`);
    return;
  }

  if (liveCurrent) {
    const repaired = await syncTargetTo(stagingIndexUid, stagingState);
    console.log(`Meilisearch staging repaired: ${repaired.changed} changed, ${repaired.removed} removed.`);
    return;
  }

  const published = await syncTargetTo(stagingIndexUid, stagingState);

  await swapIndexes();
  await writeOutput("swapped", "true");

  if (deferStagingMirror) {
    console.log(
      `Meilisearch atomic sync complete: ${published.changed} changed, ${published.removed} removed, `
      + `${index.chunks.length} chunks live; previous live index retained for publication rollback.`,
    );
    return;
  }

  const mirrored = await syncTargetTo(stagingIndexUid, liveState);
  console.log(
    `Meilisearch atomic sync complete: ${published.changed} changed, ${published.removed} removed, `
    + `${index.chunks.length} chunks live; staging mirror ${mirrored.changed} changed, ${mirrored.removed} removed.`,
  );
}

if (command === "--swap-back") {
  await swapIndexes();
  console.log(`Meilisearch swap rolled back: ${indexUid} is live again; ${stagingIndexUid} retains the candidate.`);
} else {
  await syncIndex();
}
