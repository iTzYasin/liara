import { streamAgentTurn, type AgentDependencies } from "@/modules/agent/agent";
import type { ChatAttachment, ChatRequest, SourceDocument } from "@/modules/chat/types";
import type {
  EvaluationSubject,
  EvaluationTurn,
  GoldenScenario,
} from "@/modules/evaluation/evaluation-runner";

function scenarioAttachments(scenario: GoldenScenario): ChatAttachment[] {
  return scenario.context.map((item, index) => ({
    id: `${scenario.id}:${index}`,
    name: item.name,
    mimeType: "text/plain",
    size: Buffer.byteLength(item.content, "utf8"),
    kind: "text",
    content: item.content,
  }));
}

/** Runs release evaluations through the exact agent seam used by the chat API. */
export class AgentEvaluationSubject implements EvaluationSubject {
  readonly name: string;

  constructor(
    private readonly dependencies: AgentDependencies,
    name = `agent:${dependencies.model.name}`,
  ) {
    this.name = name;
  }

  async run(scenario: GoldenScenario): Promise<EvaluationTurn> {
    const request: ChatRequest = {
      message: scenario.question,
      conversationId: `evaluation:${scenario.id}`,
      history: [],
      attachments: scenarioAttachments(scenario),
    };
    const startedAt = Date.now();
    let answer = "";
    let sources: SourceDocument[] = [];
    let intent: string | undefined;
    let confidence: EvaluationTurn["confidence"];
    let model = this.dependencies.model.name;
    let redactionCount = 0;
    let latencyMs = 0;

    for await (const event of streamAgentTurn(request, this.dependencies)) {
      if (event.type === "delta") answer += event.text;
      if (event.type === "sources") sources = event.sources;
      if (event.type === "meta") {
        intent = event.intent;
        confidence = event.confidence;
        model = event.model;
        redactionCount = event.redactionCount;
        latencyMs = event.latencyMs;
      }
      if (event.type === "error") throw new Error(event.message);
    }

    return {
      answer,
      sources,
      intent,
      confidence,
      model,
      redactionCount,
      latencyMs: latencyMs || Date.now() - startedAt,
    };
  }
}
