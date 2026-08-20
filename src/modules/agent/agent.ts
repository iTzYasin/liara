import { createHash, randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import type {
  AgentEvent,
  ChatAttachment,
  ChatRequest,
  Confidence,
  SourceDocument,
} from "@/modules/chat/types";
import type { DocsRetriever } from "@/modules/retrieval/docs-retriever";
import type { RetrievalResult } from "@/modules/retrieval/docs-retriever";
import { redactObjectText, redactSensitiveText } from "@/modules/security/secret-redactor";
import { logEvent } from "@/modules/infra/logger";
import { ResilientModelAdapter } from "@/modules/agent/resilient-model";
import { isPublicCacheableRequest, responseCache, responseCacheKey } from "@/modules/agent/response-cache";
import { metrics } from "@/modules/observability/metrics";

interface ModelTurnInput {
  systemInstruction: string;
  prompt: string;
  attachments: ChatAttachment[];
  sources: SourceDocument[];
}

export interface LanguageModelAdapter {
  readonly name: string;
  stream(input: ModelTurnInput): AsyncIterable<string>;
}

export class GeminiModelAdapter implements LanguageModelAdapter {
  readonly name: string;
  private readonly client: GoogleGenAI;

  constructor(apiKey: string, model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite") {
    this.client = new GoogleGenAI({ apiKey });
    this.name = model;
  }

  async *stream(input: ModelTurnInput): AsyncIterable<string> {
    const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
    for (const attachment of input.attachments) {
      if (attachment.kind === "text") continue;
      parts.push({
        inlineData: {
          mimeType: attachment.mimeType,
          data: attachment.content.replace(/^data:[^;]+;base64,/, ""),
        },
      });
    }

    const response = await this.client.models.generateContentStream({
      model: this.name,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: input.systemInstruction,
        maxOutputTokens: 2_000,
      },
    });

    for await (const chunk of response) {
      if (chunk.text) yield chunk.text;
    }
  }
}

export class DemoModelAdapter implements LanguageModelAdapter {
  readonly name = "demo-grounded";

  async *stream(input: ModelTurnInput): AsyncIterable<string> {
    const source = input.sources[0];
    const second = input.sources[1];
    const answer = source
      ? [
          `**مسیر پیشنهادی**\n\nبر اساس بخش «${source.heading}» در مستندات لیارا، مسئله شما به حوزه ${serviceLabel(source.service)} مربوط است. [[1]]`,
          `\n\n${source.snippet.replace(/\[.*?\]\(.*?\)/g, "").slice(0, 260)}${source.snippet.length > 260 ? "…" : ""}`,
          second ? `\n\nبرای بررسی دقیق‌تر، بخش «${second.heading}» هم مرتبط است. [[2]]` : "",
          "\n\n**قدم بعدی**\n\nاگر خروجی دستور یا متن کامل خطا را بفرستید، مرحله بعد را دقیق‌تر و بر اساس همین منابع بررسی می‌کنم.",
          "\n\n> حالت دمو فعال است؛ با افزودن GEMINI_API_KEY پاسخ تحلیلی مدل فعال می‌شود.",
        ].join("")
      : buildEscalationText(input.prompt);

    const words = answer.split(/(\s+)/);
    for (let index = 0; index < words.length; index += 8) {
      yield words.slice(index, index + 8).join("");
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
  }
}

export interface AgentDependencies {
  retriever: DocsRetriever;
  model: LanguageModelAdapter;
}

function serviceLabel(service: string) {
  const labels: Record<string, string> = {
    paas: "استقرار برنامه",
    dbaas: "دیتابیس",
    iaas: "سرور ابری",
    ai: "هوش مصنوعی",
    "one-click-apps": "برنامه‌های آماده",
    "email-server": "ایمیل",
    "object-storage": "فضای ذخیره‌سازی",
    "dns-management-system": "DNS و دامنه",
    references: "تنظیمات و ابزارهای لیارا",
  };
  return labels[service] ?? service;
}

function classifyIntent(message: string) {
  if (/خطا|ارور|error|exception|failed|timeout|لاگ|log/i.test(message)) return "troubleshooting";
  if (/چطور|چگونه|راه.?انداز|نصب|deploy|استقرار|اتصال/i.test(message)) return "guided-setup";
  if (/مقایسه|فرق|تفاوت|بهتر/i.test(message)) return "comparison";
  if (/تیکت|پشتیبانی/i.test(message)) return "escalation";
  return "documentation-qa";
}

function inferMessageExpertise(message: string, attachments: ChatAttachment[]) {
  const technicalSignals = [
    /```|stack trace|traceback|exception|ECONN|ENOTFOUND/i,
    /\b(?:dockerfile|nginx|redis|mongodb|postgres|mysql|node_modules|package\.json)\b/i,
    /(?:--[a-z-]+|\$\s*\w+|npm\s|curl\s|ssh\s|liara\s)/i,
    /\b(?:HTTP|DNS|TLS|SSL|CORS|TCP|PORT|ENV)\b/i,
  ].filter((pattern) => pattern.test(message)).length;
  const hasTechnicalFile = attachments.some((item) => item.kind === "text" && /\.(?:log|json|ya?ml|env|ts|js|py|go|php)$/i.test(item.name));
  if (technicalSignals >= 2 || (technicalSignals >= 1 && hasTechnicalFile)) return "پیشرفته";
  if (technicalSignals === 1 || hasTechnicalFile) return "میانی";
  return "مقدماتی";
}

function needsClarification(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();
  const vagueProblem = /^(?:سلام[،, ]*)?(?:مشکل دارم|کار نمی.?کنه|کار نمی.?کند|خطا میده|خرابه|سرویس بالا نمیاد)[.!؟?]*$/i;
  return compact.length < 8 || vagueProblem.test(compact);
}

function citationStats(text: string, sources: SourceDocument[], outcome: "answer" | "clarification" | "escalation") {
  const markers = [...text.matchAll(/\[\[(\d+)\]\]/g)].map((match) => Number(match[1]));
  const validIndexes = new Set(sources.map((source) => source.citationIndex));
  const invalid = markers.filter((index) => !validIndexes.has(index)).length;
  if (outcome === "answer" && sources.length && markers.length === 0) {
    return { count: 1, invalid: 1 };
  }
  return { count: markers.length, invalid };
}

function confidenceFor(score: number, sources: SourceDocument[]): Confidence {
  if (!sources.length || score < 10) return "low";
  if (score < 32) return "medium";
  return "high";
}

function buildEscalationText(question: string) {
  return [
    "**برای این مسئله شاهد کافی در مستندات پیدا نکردم و نمی‌خواهم حدس بزنم.**",
    "",
    "### متن آماده تیکت",
    "",
    "**عنوان:** نیاز به بررسی مسئله خارج از پوشش مستندات",
    "",
    `**شرح مسئله:** ${question.slice(0, 700)}`,
    "",
    "**اقدام‌های انجام‌شده:** جستجو در مستندات رسمی لیارا؛ منبع کافی یا منطبق پیدا نشد.",
    "",
    "**اطلاعات تکمیلی پیشنهادی:** نام سرویس، زمان رخداد، متن کامل خطا و آخرین تغییری که پیش از خطا انجام شده است.",
    "",
    "[بازکردن صفحه ثبت تیکت](https://console.liara.ir/tickets/create)",
  ].join("\n");
}

function systemInstruction() {
  return `شما دستیار تخصصی مستندات لیارا هستید.
- همیشه فارسی پاسخ دهید؛ کد و دستورها را LTR و داخل code block بنویسید.
- ادعاهای مربوط به لیارا فقط باید از منابع ارائه‌شده باشند.
- بعد از هر ادعای مستند، با قالب [[شماره منبع]] ارجاع دهید.
- URL یا قابلیت نسازید و از شماره منبع خارج از فهرست استفاده نکنید.
- سطح تخصص پیام جاری را در لحن و جزئیات لحاظ کنید اما آن را نام نبرید.
- اگر داده کافی نیست فقط یک سؤال تکمیلی با بیشترین ارزش اطلاعاتی بپرسید.
- دانش عمومی را در بخشی با عنوان «راهنمای عمومی خارج از مستندات لیارا» جدا کنید.
- Secret ماسک‌شده را حدس نزنید یا بازسازی نکنید.
- پاسخ را با حداکثر سه قدم بعدی کوتاه و عملی تمام کنید.`;
}

function buildPrompt(
  request: ChatRequest,
  retrieval: RetrievalResult,
  textAttachments: ChatAttachment[],
) {
  const expertise = inferMessageExpertise(request.message, request.attachments);
  const relevantHistory = request.history.slice(-10);
  const recentHistory = relevantHistory.slice(-4);
  const olderSummary = relevantHistory
    .slice(0, -4)
    .map((item) => `${item.role === "user" ? "درخواست" : "نتیجه"}: ${item.content.replace(/\s+/g, " ").slice(0, 280)}`)
    .join(" | ");
  const history = recentHistory
    .map((item) => `${item.role === "user" ? "کاربر" : "دستیار"}: ${item.content.slice(0, 2_000)}`)
    .join("\n");
  const sourceText = retrieval.sources
    .map(
      (source) => {
        const fullContext = retrieval.context.find((item) => item.sourceId === source.id)?.text;
        return `[S${source.citationIndex}] ${source.title} > ${source.heading}\nURL: ${source.url}\n${fullContext ?? source.snippet}`;
      },
    )
    .join("\n\n");
  const attachmentText = textAttachments
    .map((attachment) => `فایل ${attachment.name}:\n${attachment.content.slice(0, 8_000)}`)
    .join("\n\n");

  return `سطح فنی استنباط‌شده فقط برای پیام جاری: ${expertise} (این برچسب را به کاربر نشان نده)\n\nخلاصه Turnهای قدیمی‌تر:\n${olderSummary || "ندارد"}\n\nچهار Turn اخیر:\n${history || "بدون تاریخچه"}\n\nمنابع رسمی بازیابی‌شده:\n${sourceText || "منبعی پیدا نشد"}\n\nداده متنی کاربر:\n${attachmentText || "ندارد"}\n\nپرسش فعلی:\n${request.message}`;
}

let modelSingleton: LanguageModelAdapter | undefined;
let modelSignature = "";

export function createModelAdapter(): LanguageModelAdapter {
  const apiKey = process.env.GEMINI_API_KEY;
  const signature = `${Boolean(apiKey)}:${process.env.DEMO_MODE}:${process.env.GEMINI_MODEL}`;
  if (modelSingleton && modelSignature === signature) return modelSingleton;
  const base = !apiKey || process.env.DEMO_MODE === "true"
    ? new DemoModelAdapter()
    : new GeminiModelAdapter(apiKey);
  modelSingleton = new ResilientModelAdapter(base);
  modelSignature = signature;
  return modelSingleton;
}

export async function* streamAgentTurn(
  request: ChatRequest,
  dependencies: AgentDependencies,
): AsyncGenerator<AgentEvent> {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const messageRedaction = redactSensitiveText(request.message);
  const historyRedaction = redactObjectText(request.history);
  const textAttachments = request.attachments.filter((item) => item.kind === "text");
  const attachmentRedaction = redactObjectText(textAttachments);
  const binaryAttachments = request.attachments.filter((item) => item.kind !== "text");
  const totalRedactions =
    messageRedaction.count + historyRedaction.count + attachmentRedaction.count;
  const sanitizedRequest: ChatRequest = {
    ...request,
    message: messageRedaction.text,
    history: historyRedaction.items,
    attachments: [...attachmentRedaction.items, ...binaryAttachments],
  };

  yield { type: "status", message: totalRedactions ? "اطلاعات حساس ماسک شد" : "در حال فهم مسئله" };
  const searchMaterial = [
    sanitizedRequest.message,
    ...attachmentRedaction.items.map((item) => item.content.slice(0, 2_000)),
  ].join("\n");
  yield { type: "status", message: "در حال یافتن مستندات مرتبط" };
  const retrieval = await dependencies.retriever.retrieve(searchMaterial, 8);
  const confidence = confidenceFor(retrieval.topScore, retrieval.sources);
  const intent = classifyIntent(sanitizedRequest.message);
  yield { type: "sources", sources: retrieval.sources };

  let firstTokenAt: number | undefined;
  let outputCharacters = 0;
  let inputCharacters = searchMaterial.length;
  let outcome: "answer" | "clarification" | "escalation" = "answer";
  let responseCacheHit = false;
  let finalResponse = "";
  const responseCacheEligible = isPublicCacheableRequest(sanitizedRequest, totalRedactions);
  if (needsClarification(sanitizedRequest.message)) {
    outcome = "clarification";
    const clarification = "برای اینکه مسیر درست را پیدا کنم، نام سرویس لیارا و متن دقیق خطا یا رفتاری که می‌بینید چیست؟";
    firstTokenAt = Date.now();
    outputCharacters = clarification.length;
    finalResponse = clarification;
    yield { type: "status", message: "نیاز به یک جزئیات کلیدی" };
    yield { type: "delta", text: clarification };
  } else if (confidence === "low") {
    outcome = "escalation";
    yield { type: "status", message: "شاهد کافی پیدا نشد؛ آماده‌سازی مسیر پشتیبانی" };
    const escalation = buildEscalationText(sanitizedRequest.message);
    firstTokenAt = Date.now();
    outputCharacters = escalation.length;
    finalResponse = escalation;
    yield { type: "delta", text: escalation };
  } else {
    const prompt = buildPrompt(sanitizedRequest, retrieval, attachmentRedaction.items);
    inputCharacters = prompt.length;
    const cacheKey = responseCacheEligible
      ? responseCacheKey(
          sanitizedRequest.message,
          retrieval.sources.map((source) => source.id),
          dependencies.model.name,
        )
      : undefined;
    const cached = cacheKey ? responseCache.get(cacheKey) : undefined;
    if (cached) {
      responseCacheHit = true;
      firstTokenAt = Date.now();
      outputCharacters = cached.text.length;
      finalResponse = cached.text;
      yield { type: "status", message: "پاسخ مستند از حافظه امن بازیابی شد" };
      yield { type: "delta", text: cached.text };
    } else {
      yield { type: "status", message: intent === "troubleshooting" ? "در حال بررسی نشانه‌های خطا" : "در حال ساخت پاسخ مستند" };
      for await (const text of dependencies.model.stream({
        systemInstruction: systemInstruction(),
        prompt,
        attachments: binaryAttachments,
        sources: retrieval.sources,
      })) {
        firstTokenAt ??= Date.now();
        outputCharacters += text.length;
        finalResponse += text;
        yield { type: "delta", text };
      }
      const generatedCitationStats = citationStats(finalResponse, retrieval.sources, outcome);
      if (cacheKey && generatedCitationStats.count > 0 && generatedCitationStats.invalid === 0) {
        responseCache.set(cacheKey, { text: finalResponse });
      }
    }
  }

  const latencyMs = Date.now() - startedAt;
  const inputTokenEstimate = Math.ceil(inputCharacters / 4);
  const outputTokenEstimate = Math.ceil(outputCharacters / 4);
  const firstTokenLatencyMs = firstTokenAt ? firstTokenAt - startedAt : null;
  const citations = citationStats(finalResponse, retrieval.sources, outcome);
  logEvent("info", "chat.completed", {
    request_id: requestId,
    anonymous_session_id: createHash("sha256").update(request.conversationId).digest("hex").slice(0, 16),
    intent,
    confidence,
    model: dependencies.model.name,
    source_count: retrieval.sources.length,
    citation_count: citations.count,
    invalid_citation_count: citations.invalid,
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
    sourceCount: retrieval.sources.length,
    citationCount: citations.count,
    invalidCitationCount: citations.invalid,
    redactionCount: totalRedactions,
    confidence,
    outcome,
    retrievalCacheHit: Boolean(retrieval.cacheHit),
    responseCacheEligible,
    responseCacheHit,
  });
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
