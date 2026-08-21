import { createHash, randomUUID } from "node:crypto";
import type {
  AgentEvent,
  ChatRequest,
  Confidence,
  SourceDocument,
  SupportTicketDraft,
} from "@/modules/chat/types";
import type { DocsRetriever } from "@/modules/retrieval/docs-retriever";
import { redactSensitiveText } from "@/modules/security/secret-redactor";
import { logEvent } from "@/modules/infra/logger";
import { isPublicCacheableRequest, responseCache, responseCacheKey } from "@/modules/agent/response-cache";
import { metrics } from "@/modules/observability/metrics";
import { enforceCitationPolicy } from "@/modules/agent/citation-policy";
import {
  groundStructuredModelResponse,
} from "@/modules/agent/model-response";
import {
  advanceWorkflow,
  workflowSourceOrder,
} from "@/modules/agent/workflow-state";
import { routeConversationTurn } from "@/modules/agent/conversation-router";
import { buildAgentModelInput } from "@/modules/agent/agent-prompt";
import {
  collectModelOutput,
  type LanguageModelAdapter,
} from "@/modules/agent/model-adapter";
import { sanitizeAgentRequest } from "@/modules/agent/sanitize-agent-request";
import {
  generateStructuredResponse,
  ModelContractError,
} from "@/modules/agent/structured-generation";

export interface AgentDependencies {
  retriever: DocsRetriever;
  model: LanguageModelAdapter;
}

function confidenceFor(score: number, sources: SourceDocument[], queryCoverage: number, domainMatched: boolean): Confidence {
  if (!sources.length || score < 10 || queryCoverage < 0.35) return "low";
  if (!domainMatched && queryCoverage < 0.75) return "low";
  if (queryCoverage < 0.55) return "medium";
  if (score < 32) return "medium";
  return "high";
}

function lowerConfidence(left: Confidence, right: Confidence): Confidence {
  const rank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
  return rank[left] <= rank[right] ? left : right;
}

function ticketSubjectFallback(message: string, service?: string) {
  const issue = message.replace(/\s+/g, " ").trim().slice(0, 100);
  const scope = service && service !== "unknown" ? `سرویس ${service}` : "لیارا";
  return `درخواست بررسی ${scope}: ${issue || "مشکل حل‌نشده"}`.slice(0, 180);
}

function ticketDraft(
  request: ChatRequest,
  body: string,
  subject?: string,
  service?: string,
): SupportTicketDraft {
  const safeSubject = redactSensitiveText(
    subject?.trim() || ticketSubjectFallback(request.message, service),
  );
  const safeBody = redactSensitiveText(body.trim() || [
    "شرح مسئله:",
    request.message,
    "",
    "اطلاعات تکمیلی موردنیاز:",
    "نام سرویس، زمان رخداد و متن کامل خطا",
  ].join("\n"));
  return {
    subject: safeSubject.text.slice(0, 180),
    body: safeBody.text.slice(0, 8_000),
  };
}

function honestEscalationLead(text: string) {
  if (/پاسخ قابل اتکا|نمی.?دانم|نمی.?دونم|نمی.?خواهم حدس/u.test(text)) return text;
  return `برای این مورد پاسخ قابل اتکایی در مستندات پیدا نکردم و نمی‌خواهم حدس بزنم.\n\n${text}`;
}

function minimumCitationCountFor(message: string, sourceCount: number) {
  if (sourceCount < 2) return 1;
  const normalized = message.replace(/\s+/g, " ");
  const multiStep = /(?:ابتدا|اول).{0,160}(?:بعد|سپس)|(?:بکاپ|پشتیبان).{0,100}(?:بازیابی|restore)|هم .{0,80}(?:و هم|هم)|مرحله.?ای|ترتیب (?:دقیق )?مراحل/i;
  return multiStep.test(normalized) ? 2 : 1;
}

export async function* streamAgentTurn(
  request: ChatRequest,
  dependencies: AgentDependencies,
): AsyncGenerator<AgentEvent> {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const sanitized = sanitizeAgentRequest(request);
  const sanitizedRequest = sanitized.request;
  const totalRedactions = sanitized.redactionCount;

  yield { type: "status", message: totalRedactions ? "اطلاعات حساس ماسک شد" : "در حال فهم مسئله" };
  const route = await routeConversationTurn(sanitizedRequest, dependencies.model);
  if (route.action === "respond") {
    const directOutcome = route.outcome === "out_of_scope" ? "conversation" : route.outcome;
    const directResponse = directOutcome === "escalation"
      ? honestEscalationLead(route.response)
      : route.response;
    const firstTokenAt = Date.now();
    yield {
      type: "status",
      message: directOutcome === "clarification"
        ? "نیاز به یک جزئیات کلیدی"
        : directOutcome === "escalation"
          ? "در حال آماده‌سازی مسیر پیگیری"
          : "در حال آماده‌سازی پاسخ",
    };
    yield { type: "sources", sources: [] };
    yield { type: "delta", text: directResponse };
    if (directOutcome === "escalation") {
      yield {
        type: "ticket",
        draft: ticketDraft(
          sanitizedRequest,
          route.ticket_body?.trim() || route.response,
          route.ticket_subject,
        ),
      };
    }

    const latencyMs = Date.now() - startedAt;
    const inputCharacters = sanitizedRequest.message.length
      + sanitizedRequest.history.reduce((sum, item) => sum + item.content.length, 0)
      + (sanitizedRequest.contextSummary?.length ?? 0);
    const inputTokenEstimate = Math.ceil(inputCharacters / 4);
    const outputTokenEstimate = Math.ceil(directResponse.length / 4);
    const firstTokenLatencyMs = firstTokenAt - startedAt;
    logEvent("info", "chat.completed", {
      request_id: requestId,
      anonymous_session_id: createHash("sha256").update(request.conversationId).digest("hex").slice(0, 16),
      intent: route.intent,
      confidence: route.confidence,
      outcome: directOutcome,
      model: dependencies.model.name,
      source_count: 0,
      citation_count: 0,
      invalid_citation_count: 0,
      retrieved_chunk_ids: [],
      input_token_estimate: inputTokenEstimate,
      output_token_estimate: outputTokenEstimate,
      latency_to_first_token_ms: firstTokenLatencyMs,
      retrieval_cache_hit: false,
      response_cache_hit: false,
      redaction_count: totalRedactions,
      latency_ms: latencyMs,
    });
    metrics.record({
      type: "chat.completed",
      latencyMs,
      firstTokenLatencyMs,
      inputTokens: inputTokenEstimate,
      outputTokens: outputTokenEstimate,
      sourceCount: 0,
      citationCount: 0,
      invalidCitationCount: 0,
      redactionCount: totalRedactions,
      confidence: route.confidence,
      outcome: directOutcome,
      retrievalCacheHit: false,
      responseCacheEligible: false,
      responseCacheHit: false,
    });
    if (directOutcome === "clarification" || directOutcome === "escalation") {
      const nextWorkflowState = advanceWorkflow(sanitizedRequest.workflowState, {
        message: sanitizedRequest.message,
        intent: route.intent,
        outcome: directOutcome,
        proposedSteps: [],
      });
      if (nextWorkflowState) yield { type: "workflow", state: nextWorkflowState };
    }
    yield {
      type: "meta",
      requestId,
      confidence: route.confidence,
      intent: route.intent,
      redactionCount: totalRedactions,
      model: dependencies.model.name,
      latencyMs,
    };
    yield { type: "done" };
    return;
  }
  const searchMaterial = route.search_query;
  yield { type: "status", message: "در حال یافتن مستندات مرتبط" };
  const retrieval = await dependencies.retriever.retrieve(searchMaterial, 8);
  const retrievalConfidence = confidenceFor(
    retrieval.topScore,
    retrieval.sources,
    retrieval.queryCoverage,
    retrieval.domainMatched,
  );
  let confidence = retrievalConfidence;
  let intent = route.intent;

  let firstTokenAt: number | undefined;
  let outputCharacters = 0;
  let inputCharacters = searchMaterial.length;
  let outcome: "answer" | "clarification" | "escalation" = "answer";
  let responseCacheHit = false;
  let finalResponse = "";
  let proposedWorkflowSteps: string[] = [];
  let displayedSources: SourceDocument[] = [];
  let supportTicketDraft: SupportTicketDraft | undefined;
  let invalidCitationCount = 0;
  const responseCacheEligible = isPublicCacheableRequest(sanitizedRequest, totalRedactions);
  const modelInput = buildAgentModelInput(
    sanitizedRequest,
    retrieval,
    sanitized.textAttachments,
    sanitized.binaryAttachments,
    route.response_language,
  );
  const prompt = modelInput.prompt;
  inputCharacters = prompt.length;
  const cacheKey = responseCacheEligible
    ? responseCacheKey(
        sanitizedRequest.message,
        retrieval.sources.map((source) => source.id),
        dependencies.model.name,
        route.response_language,
      )
    : undefined;
  const cached = cacheKey ? responseCache.get(cacheKey) : undefined;
  if (cached) {
    responseCacheHit = true;
    finalResponse = cached.text;
    intent = cached.intent ?? intent;
    confidence = lowerConfidence(retrievalConfidence, cached.confidence ?? "high");
    yield { type: "status", message: "پاسخ مستند از حافظه امن بازیابی شد" };
  } else {
    yield {
      type: "status",
      message: intent === "troubleshooting"
        ? "در حال بررسی نشانه‌های خطا"
        : "در حال ساخت پاسخ مستند",
    };
    if (dependencies.model.structuredOutput) {
      const generated = await generateStructuredResponse(
        dependencies.model,
        modelInput,
        minimumCitationCountFor(sanitizedRequest.message, retrieval.sources.length),
      );
      inputCharacters = generated.inputCharacters;
      if (!generated.response) throw new ModelContractError();

      intent = generated.response.intent;
      confidence = lowerConfidence(retrievalConfidence, generated.response.confidence);
      if (generated.response.needs_clarification) {
        outcome = "clarification";
        finalResponse = generated.response.clarification_question.trim();
        if (!finalResponse) {
          throw new ModelContractError("The model requested clarification without a question");
        }
      } else if (generated.response.confidence === "low") {
        finalResponse = generated.response.clarification_question.trim()
          || generated.response.escalation.trim()
          || generated.response.answer_summary.trim();
        if (!finalResponse) {
          throw new ModelContractError("The low-confidence model response did not contain safe user-facing text");
        }
        outcome = generated.response.escalation.trim() ? "escalation" : "clarification";
        if (outcome === "escalation") {
          finalResponse = honestEscalationLead(finalResponse);
          supportTicketDraft = ticketDraft(
            sanitizedRequest,
            generated.response.escalation,
            generated.response.escalation_title,
            generated.response.service,
          );
        }
      } else {
        proposedWorkflowSteps = [
          ...generated.response.steps,
        ];
        const grounded = groundStructuredModelResponse(
          generated.response,
          retrieval.sources.length,
        );
        finalResponse = grounded.markdown;
        invalidCitationCount += grounded.invalidCitationCount;
      }
    } else {
      finalResponse = (await collectModelOutput(dependencies.model, modelInput)).trim();
      if (!finalResponse) throw new ModelContractError("The model returned an empty response");
    }
  }

  if (outcome === "answer") {
    const validated = enforceCitationPolicy(finalResponse, retrieval.sources);
    if (!validated.sources.length) {
      throw new ModelContractError("The model answer had no valid Liara citation");
    }
    finalResponse = validated.text;
    displayedSources = validated.sources;
    invalidCitationCount += validated.invalidCitationCount;
    confidence = lowerConfidence(confidence, validated.confidence);
  }
  outputCharacters = finalResponse.length;

  if (!cached && cacheKey && outcome === "answer" && displayedSources.length > 0 && invalidCitationCount === 0) {
    responseCache.set(cacheKey, { text: finalResponse, intent, confidence });
  }

  yield { type: "sources", sources: displayedSources };
  const safeSegments = finalResponse.match(/[\s\S]{1,160}/g) ?? [finalResponse];
  for (const text of safeSegments) {
    firstTokenAt ??= Date.now();
    yield { type: "delta", text };
  }
  if (supportTicketDraft) yield { type: "ticket", draft: supportTicketDraft };

  const latencyMs = Date.now() - startedAt;
  const inputTokenEstimate = Math.ceil(inputCharacters / 4);
  const outputTokenEstimate = Math.ceil(outputCharacters / 4);
  const firstTokenLatencyMs = firstTokenAt ? firstTokenAt - startedAt : null;
  const citationCount = [...finalResponse.matchAll(/\[\[(\d+)\]\]/g)].length;
  if (
    proposedWorkflowSteps.length === 0
    && outcome === "answer"
    && (
      /guided-setup|troubleshooting/.test(intent)
      || Boolean(sanitizedRequest.workflowState)
    )
  ) {
    proposedWorkflowSteps = displayedSources
      .slice(0, 3)
      .map((source, index) => ({ source, index }))
      .sort((left, right) =>
        workflowSourceOrder(left.source.path, left.index)
        - workflowSourceOrder(right.source.path, right.index))
      .map(({ source }) => source)
      .map((source) => `بررسی بخش «${source.heading}»`);
  }
  const nextWorkflowState = advanceWorkflow(sanitizedRequest.workflowState, {
    message: sanitizedRequest.message,
    intent,
    outcome,
    proposedSteps: proposedWorkflowSteps,
  });
  logEvent("info", "chat.completed", {
    request_id: requestId,
    anonymous_session_id: createHash("sha256").update(request.conversationId).digest("hex").slice(0, 16),
    intent,
    confidence,
    model: dependencies.model.name,
    source_count: displayedSources.length,
    citation_count: citationCount,
    invalid_citation_count: invalidCitationCount,
    retrieved_chunk_ids: retrieval.sources.map((source) => source.id),
    input_token_estimate: inputTokenEstimate,
    output_token_estimate: outputTokenEstimate,
    latency_to_first_token_ms: firstTokenLatencyMs,
    retrieval_cache_hit: Boolean(retrieval.cacheHit),
    response_cache_hit: responseCacheHit,
    redaction_count: totalRedactions,
    latency_ms: latencyMs,
  });
  metrics.record({
    type: "chat.completed",
    latencyMs,
    firstTokenLatencyMs,
    inputTokens: inputTokenEstimate,
    outputTokens: outputTokenEstimate,
    sourceCount: displayedSources.length,
    citationCount,
    invalidCitationCount,
    redactionCount: totalRedactions,
    confidence,
    outcome,
    retrievalCacheHit: Boolean(retrieval.cacheHit),
    responseCacheEligible,
    responseCacheHit,
  });
  if (nextWorkflowState) yield { type: "workflow", state: nextWorkflowState };
  yield {
    type: "meta",
    requestId,
    confidence,
    intent,
    redactionCount: totalRedactions,
    model: dependencies.model.name,
    latencyMs,
  };
  yield { type: "done" };
}
