import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseUrl = `http://127.0.0.1:${port}`;
const serverPath = path.join(projectRoot, ".next", "standalone", "server.js");
const playwrightCliPath = path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js");

if (!existsSync(serverPath)) {
  throw new Error("Standalone build not found. Run `npm run build` before the E2E runner.");
}

const server = spawn(process.execPath, [serverPath], {
  cwd: projectRoot,
  env: {
    ...process.env,
    DEMO_MODE: "true",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    RATE_LIMIT_PER_MINUTE: "100",
    RATE_LIMIT_PER_HOUR: "300",
  },
  stdio: "inherit",
  windowsHide: true,
});

let playwrightProcess;
let stopping = false;

async function stopChild(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([once(child, "close"), delay(timeoutMs)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function stopAll() {
  if (stopping) return;
  stopping = true;
  await stopChild(playwrightProcess);
  await stopChild(server);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stopAll();
    process.exitCode = 130;
  });
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  let lastStatus = "no response";
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`E2E server exited before becoming ready (code ${server.exitCode}).`);
    }
    try {
      const response = await fetch(`${baseUrl}/readyz`, {
        signal: AbortSignal.timeout(10_000),
      });
      lastStatus = `HTTP ${response.status}`;
      if (response.ok) return;
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await delay(150);
  }
  throw new Error(`E2E server did not become ready at ${baseUrl} (${lastStatus}).`);
}

try {
  await waitForServer();
  playwrightProcess = spawn(
    process.execPath,
    [playwrightCliPath, "test", ...process.argv.slice(2)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: baseUrl,
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const [exitCode] = await once(playwrightProcess, "close");
  process.exitCode = typeof exitCode === "number" ? exitCode : 1;
} finally {
  await stopAll();
}
