import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const root = process.cwd();
const docsRoot = process.env.LIARA_DOCS_PATH
  ? path.resolve(process.env.LIARA_DOCS_PATH)
  : path.join(root, "liara-docs", "public", "llms");
const outputPath = path.join(root, "data", "liara-docs-index.json");
const maxChunkChars = 3_400;
const execFileAsync = promisify(execFile);

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
  }
  return files;
}

function cleanText(value) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/^## all links[\s\S]*$/gim, "")
    .replace(/^\[All links of docs\].*$/gim, "")
    .replace(/^\[Video link\]\([^\n]+\)\s*$/gim, "")
    .replace(/^!\[[^\]]*\]\([^\n]+\)\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLongSection(text) {
  if (text.length <= maxChunkChars) return [text];
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxChunkChars) {
      chunks.push(current.trim());
      current = "";
    }
    current += `${current ? "\n\n" : ""}${paragraph}`;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function parseDocument(filePath, raw) {
  raw = raw.replace(/^\uFEFF/, "");
  const relativePath = path.relative(docsRoot, filePath).replaceAll("\\", "/");
  const originalLink = raw.match(/^Original link:\s*(https?:\/\/\S+)/m)?.[1];
  if (!originalLink) return [];

  const withoutLink = raw.replace(/^Original link:.*\n+/m, "");
  const title = withoutLink.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(filePath, ".md");
  const service = relativePath.split("/")[0] ?? "overview";
  const lines = withoutLink.split(/\r?\n/);
  const sections = [];
  let heading = title;
  let buffer = [];

  const flush = () => {
    const body = cleanText(buffer.join("\n"));
    if (!body || body.length < 24) {
      buffer = [];
      return;
    }
    for (const part of splitLongSection(body)) {
      sections.push({ heading, text: part });
    }
    buffer = [];
  };

  for (const line of lines) {
    const match = line.match(/^(#{1,4})\s+(.+)$/);
    if (match) {
      flush();
      heading = match[2].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections.map((section, index) => {
    const anchor = section.heading === title
      ? ""
      : `#${section.heading
          .toLowerCase()
          .replace(/[\u200c\s]+/g, "-")
          .replace(/[^\p{L}\p{N}\-_]/gu, "")}`;
    const identity = `${relativePath}:${section.heading}:${index}`;
    return {
      id: createHash("sha1").update(identity).digest("hex").slice(0, 16),
      title,
      heading: section.heading,
      service,
      url: `${originalLink}${anchor}`,
      path: relativePath,
      text: section.text,
    };
  });
}

if (!(await exists(docsRoot))) {
  if (await exists(outputPath)) {
    console.log(`Docs source not found at ${docsRoot}; using committed index.`);
    process.exit(0);
  }
  throw new Error(`Liara docs source not found: ${docsRoot}`);
}

const files = await walk(docsRoot);
const chunks = [];
for (const file of files) {
  const raw = await readFile(file, "utf8");
  chunks.push(...parseDocument(file, raw));
}

let detectedCommit = "unknown";
try {
  const repositoryRoot = path.resolve(docsRoot, "..", "..");
  const { stdout } = await execFileAsync("git", ["-C", repositoryRoot, "rev-parse", "--short=7", "HEAD"]);
  detectedCommit = stdout.trim();
} catch {
  detectedCommit = "unknown";
}

const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: "https://github.com/liara-cloud/docs/tree/master/public/llms",
  sourceCommit: process.env.LIARA_DOCS_COMMIT ?? detectedCommit,
  documentCount: files.length,
  chunkCount: chunks.length,
  chunks,
};

await mkdir(path.dirname(outputPath), { recursive: true });
const temporaryOutput = `${outputPath}.${process.pid}.tmp`;
try {
  await writeFile(temporaryOutput, JSON.stringify(payload), "utf8");
  await rename(temporaryOutput, outputPath);
} catch (error) {
  await unlink(temporaryOutput).catch(() => undefined);
  throw error;
}
console.log(`Indexed ${files.length} documents into ${chunks.length} chunks.`);
