import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GeminiModelAdapter } from "@/modules/agent/gemini-model-adapter";
import { AgentEvaluationSubject } from "@/modules/evaluation/agent-evaluation-subject";
import {
  EvaluationRunner,
  type GoldenSet,
} from "@/modules/evaluation/evaluation-runner";
import { GeminiEvaluationJudge } from "@/modules/evaluation/gemini-evaluation-judge";
import { FileDocsRetriever } from "@/modules/retrieval/docs-retriever";

const enabled = process.env.RUN_LIVE_MODEL_EVAL === "true";

describe.skipIf(!enabled)("live Gemini golden-set evaluation", () => {
  it("evaluates the full release set through the production agent seam", async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required for the live model evaluation");
    }

    const root = process.cwd();
    const golden = JSON.parse(
      await readFile(path.join(root, "data", "retrieval-golden-set.json"), "utf8"),
    ) as GoldenSet;
    const requestedLimit = Number(process.env.GEMINI_EVAL_LIMIT ?? golden.scenarios.length);
    const scenarios = golden.scenarios.slice(0, requestedLimit);
    const candidateModel = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
    const judgeModel = process.env.GEMINI_EVAL_JUDGE_MODEL ?? candidateModel;
    const subject = new AgentEvaluationSubject(
      {
        retriever: new FileDocsRetriever(),
        model: new GeminiModelAdapter(apiKey, candidateModel),
      },
      `production-agent:${candidateModel}`,
    );
    const judge = new GeminiEvaluationJudge(apiKey, judgeModel);
    const report = await new EvaluationRunner(subject, judge).evaluate(scenarios);
    const artifactDirectory = path.join(root, "artifacts", "evaluation");
    const artifactPath = path.join(artifactDirectory, "gemini-golden-report.json");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify({
      goldenSetVersion: golden.version,
      goldenSetSourceCommit: golden.sourceCommit,
      evaluatedScenarioCount: scenarios.length,
      completeGoldenSet: scenarios.length === golden.scenarios.length,
      report,
    }, null, 2)}\n`, "utf8");

    console.info(JSON.stringify({
      artifactPath,
      completeGoldenSet: scenarios.length === golden.scenarios.length,
      ...report.summary,
    }, null, 2));
    expect(report.results).toHaveLength(scenarios.length);
    expect(report.summary.invalidCitationLeaks).toBe(0);
  }, 60 * 60_000);
});
