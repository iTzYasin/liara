import { z } from "zod";
import type {
  LanguageModelAdapter,
  ModelTurnInput,
} from "@/modules/agent/model-adapter";
import { buildConversationContext } from "@/modules/agent/context-manager";
import { workflowContext } from "@/modules/agent/workflow-state";
import type { ChatRequest } from "@/modules/chat/types";

export const conversationRouteSchema = z.object({
  action: z.enum(["respond", "search_docs"]),
  intent: z.string().min(1).max(80),
  outcome: z.enum([
    "conversation",
    "answer",
    "clarification",
    "escalation",
    "out_of_scope",
  ]),
  expertise_hint: z.enum(["beginner", "intermediate", "advanced"]),
  response_language: z.string()
    .min(2)
    .max(35)
    .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/),
  response: z.string().max(6_000),
  search_query: z.string().max(1_000),
  confidence: z.enum(["high", "medium", "low"]),
  ticket_subject: z.string().max(180).optional(),
  ticket_body: z.string().max(8_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "respond" && !value.response.trim()) {
    context.addIssue({
      code: "custom",
      path: ["response"],
      message: "respond requires a user-facing response",
    });
  }
  if (value.action === "search_docs" && !value.search_query.trim()) {
    context.addIssue({
      code: "custom",
      path: ["search_query"],
      message: "search_docs requires a retrieval query",
    });
  }
  if (value.action === "search_docs" && value.outcome !== "answer") {
    context.addIssue({
      code: "custom",
      path: ["outcome"],
      message: "search_docs must continue to the answer stage",
    });
  }
});

export type ConversationRouteDecision = z.infer<typeof conversationRouteSchema>;

export const conversationRouteJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "action",
    "intent",
    "outcome",
    "expertise_hint",
    "response_language",
    "response",
    "search_query",
    "confidence",
  ],
  properties: {
    action: { type: "string", enum: ["respond", "search_docs"] },
    intent: { type: "string" },
    outcome: {
      type: "string",
      enum: ["conversation", "answer", "clarification", "escalation", "out_of_scope"],
    },
    expertise_hint: {
      type: "string",
      enum: ["beginner", "intermediate", "advanced"],
    },
    response_language: {
      type: "string",
      pattern: "^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$",
    },
    response: { type: "string" },
    search_query: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    ticket_subject: { type: "string" },
    ticket_body: { type: "string" },
  },
};

export class ConversationRouteContractError extends Error {
  constructor() {
    super("The model did not return a valid conversation route after one repair attempt");
    this.name = "ConversationRouteContractError";
  }
}

function routerSystemInstruction() {
  return `شما لایه تصمیم‌گیری دستیار فارسی مستندات لیارا هستید.
برای هر پیام، طبیعی و متناسب با همان پیام تصمیم بگیرید؛ هیچ دسته‌بندی‌ای را به کاربر نشان ندهید.

قواعد تصمیم:
- سلام، تشکر، احوال‌پرسی و گفت‌وگوی کوتاه را با action=respond و outcome=conversation، کوتاه و دوستانه پاسخ دهید.
- زبان مطلوب پاسخ را از پیام جاری و تاریخچه تشخیص دهید و کد BCP 47 آن را در response_language قرار دهید. درخواست صریح زبان اولویت دارد؛ برای پیام کوتاه یا خنثی مانند نام یک فناوری، زبان آخرین پیام معنادار کاربر را ادامه دهید.
- اگر درخواست درباره محصولات، سرویس‌ها، خطاها، تنظیمات یا مستندات لیارا است و اطلاعات کافی برای جست‌وجو دارد، action=search_docs بدهید. در این حالت response خالی و search_query یک پرس‌وجوی مستقل و دقیق فارسی باشد، حتی اگر response_language زبان دیگری است.
- اگر مسئله فنی مرتبط با لیارا مبهم است، action=respond و outcome=clarification بدهید و فقط یک سؤال با بیشترین ارزش اطلاعاتی در response بپرسید.
- اگر کاربر صریحاً درخواست پیگیری انسانی دارد یا پس از تلاش‌های قبلی به بن‌بست رسیده، action=respond و outcome=escalation بدهید و اطلاعات لازم برای پیگیری را طبیعی جمع‌بندی کنید.
- برای escalation در response صادقانه بگویید پاسخ قابل اتکایی در مستندات ندارید. ticket_subject و ticket_body را به‌شکل یک تیکت آماده ارسال بنویسید؛ در body مسئله، رفتار مشاهده‌شده، اقدام‌های انجام‌شده و اطلاعاتِ هنوز لازم را فقط از گفتگو جمع‌بندی کنید و چیزی نسازید.
- در outcomeهای غیر escalation، ticket_subject و ticket_body را خالی بگذارید.
- اگر درخواست خارج از حوزه لیارا است، action=respond و outcome=out_of_scope بدهید؛ مؤدبانه محدودیت حوزه را بگویید و در صورت امکان ارتباط آن با لیارا را پیشنهاد کنید.
- درباره واقعیت‌ها و قابلیت‌های لیارا در response ادعای مستند نسازید؛ این ادعاها فقط بعد از search_docs پاسخ داده می‌شوند.
- response را به‌طور کامل به response_language بنویسید. کد، نام محصول، URL، متغیر محیطی، پیام خطا و اصطلاح فنی می‌تواند به زبان اصلی باقی بماند.
- سطح فنی را فقط از پیام جاری استنباط کنید و آن را به کاربر اعلام نکنید.
- Secret ماسک‌شده را حدس نزنید یا بازسازی نکنید.
- خروجی فقط یک شیء JSON معتبر مطابق schema باشد؛ markdown fence و توضیح بیرون JSON ممنوع است.`;
}

function buildRouterPrompt(request: ChatRequest) {
  const conversation = buildConversationContext(
    request.history,
    request.contextSummary,
    { recentMessageCount: 6, summaryMaxCharacters: 2_400 },
  );
  const history = conversation.recent
    .map((item) => `${item.role === "user" ? "کاربر" : "دستیار"}: ${item.content.slice(0, 2_000)}`)
    .join("\n");
  const attachments = request.attachments
    .map((attachment) => attachment.kind === "text"
      ? `${attachment.name} (${attachment.mimeType}):\n${attachment.content.slice(0, 2_000)}`
      : `${attachment.name} (${attachment.kind}, ${attachment.mimeType})`)
    .join("\n\n");

  return `حافظه فشرده گفتگو:\n${conversation.summary || "ندارد"}

پیام‌های اخیر:\n${history || "بدون تاریخچه"}

وضعیت جریان چندمرحله‌ای:\n${workflowContext(request.workflowState)}

فایل‌های همراه:\n${attachments || "ندارد"}

پیام جاری کاربر:\n${request.message}`;
}

async function collectRouteOutput(model: LanguageModelAdapter, input: ModelTurnInput) {
  let output = "";
  for await (const chunk of model.stream(input)) output += chunk;
  return output;
}

function parseRoute(raw: string) {
  try {
    return conversationRouteSchema.safeParse(JSON.parse(raw));
  } catch {
    return conversationRouteSchema.safeParse(undefined);
  }
}

function explicitlyRequestsTicketDraft(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  const mentionsTicket = /تیکت|ticket/iu.test(normalized);
  const requestsCreation = /آماده|بساز|بنویس|تهیه|ایجاد|ثبت|درست کن|prepare|create|draft|write|submit/iu
    .test(normalized);
  return mentionsTicket && requestsCreation;
}

function explicitTicketFallback(
  request: ChatRequest,
  firstDecision: ConversationRouteDecision,
): ConversationRouteDecision {
  const recentContext = request.history
    .slice(-6)
    .map((item) => `${item.role === "user" ? "کاربر" : "دستیار"}: ${item.content}`)
    .join("\n")
    .slice(0, 5_000);
  const body = [
    "شرح مسئله:",
    request.message,
    recentContext ? "\nاطلاعات مرتبط از گفتگو:\n" + recentContext : "",
    "\nاطلاعات تکمیلی موردنیاز:",
    "نام سرویس، زمان رخداد، مرحله وقوع و متن کامل خطا (اگر در گفتگو ثبت نشده است)",
  ].filter(Boolean).join("\n");

  return {
    ...firstDecision,
    action: "respond",
    intent: "escalation",
    outcome: "escalation",
    response: "برای این مورد پاسخ قابل اتکایی در مستندات پیدا نکردم و نمی‌خواهم حدس بزنم. پیش‌نویس تیکت را براساس اطلاعات همین گفتگو آماده کردم.",
    search_query: "",
    confidence: "low",
    ticket_subject: `درخواست بررسی مشکل گزارش‌شده در لیارا: ${request.message.replace(/\s+/g, " ").trim().slice(0, 90)}`.slice(0, 180),
    ticket_body: body.slice(0, 8_000),
  };
}

export async function routeConversationTurn(
  request: ChatRequest,
  model: LanguageModelAdapter,
): Promise<ConversationRouteDecision> {
  const previousUserMessage = [...request.history]
    .reverse()
    .find((message) => message.role === "user")
    ?.content;
  const input: ModelTurnInput = {
    systemInstruction: routerSystemInstruction(),
    prompt: buildRouterPrompt(request),
    currentUserMessage: request.message,
    retrievalContext: (request.workflowState?.goal || previousUserMessage)?.slice(0, 600),
    attachments: [],
    sources: [],
    responseSchema: conversationRouteJsonSchema,
  };
  const firstOutput = await collectRouteOutput(model, input);
  const firstParsed = parseRoute(firstOutput);
  if (firstParsed.success) {
    if (
      !explicitlyRequestsTicketDraft(request.message)
      || firstParsed.data.outcome === "escalation"
    ) {
      return firstParsed.data;
    }

    const escalationOutput = await collectRouteOutput(model, {
      ...input,
      prompt: [
        input.prompt,
        "",
        "کاربر صریحاً خواسته یک تیکت آماده شود. سؤال تکمیلی نپرسید؛ با outcome=escalation پاسخ دهید.",
        "ticket_subject و ticket_body را فقط از اطلاعات موجود گفتگو پر کنید و اطلاعات ناقص را در بخش «اطلاعات تکمیلی موردنیاز» بنویسید.",
        "خروجی فقط یک شیء JSON معتبر مطابق schema باشد.",
      ].join("\n"),
    });
    const escalationParsed = parseRoute(escalationOutput);
    if (escalationParsed.success && escalationParsed.data.outcome === "escalation") {
      return escalationParsed.data;
    }
    return explicitTicketFallback(request, firstParsed.data);
  }

  const repairedOutput = await collectRouteOutput(model, {
    ...input,
    prompt: [
      input.prompt,
      "",
      "خروجی قبلی با قرارداد route معتبر نبود. تصمیم را دوباره و فقط به صورت یک شیء JSON دقیقاً مطابق schema بنویس.",
      "خروجی قبلی:",
      firstOutput.slice(0, 4_000),
    ].join("\n"),
  });
  const repairedParsed = parseRoute(repairedOutput);
  if (repairedParsed.success) return repairedParsed.data;
  throw new ConversationRouteContractError();
}
