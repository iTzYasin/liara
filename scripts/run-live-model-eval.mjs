import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is required. Set it only in your shell environment, then retry.");
  process.exit(1);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const vitestCli = path.join(root, "node_modules", "vitest", "vitest.mjs");
const child = spawn(
  process.execPath,
  [vitestCli, "run", "src/modules/evaluation/live-model-evaluation.live.test.ts", "--reporter=verbose"],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, RUN_LIVE_MODEL_EVAL: "true" },
  },
);

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) console.error(`Live evaluation terminated by ${signal}`);
  process.exitCode = code ?? 1;
});
