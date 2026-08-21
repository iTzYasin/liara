import { buildConversationContext } from "@/modules/agent/context-manager";
import type { ModelTurnInput } from "@/modules/agent/model-adapter";
import { structuredModelResponseJsonSchema } from "@/modules/agent/model-response";
import { workflowContext } from "@/modules/agent/workflow-state";
import type { ChatAttachment, ChatRequest } from "@/modules/chat/types";
import type { RetrievalResult } from "@/modules/retrieval/docs-retriever";

function inferMessageExpertise(message: string, attachments: ChatAttachment[]) {
  const technicalSignals = [
    /```|stack trace|traceback|exception|ECONN|ENOTFOUND/i,
    /\b(?:dockerfile|nginx|redis|mongodb|postgres|mysql|node_modules|package\.json)\b/i,
    /(?:--[a-z-]+|\$\s*\w+|npm\s|curl\s|ssh\s|liara\s)/i,
    /\b(?:HTTP|DNS|TLS|SSL|CORS|TCP|PORT|ENV)\b/i,
  ].filter((pattern) => pattern.test(message)).length;
  const hasTechnicalFile = attachments.some((item) =>
    item.kind === "text" && /\.(?:log|json|ya?ml|env|ts|js|py|go|php)$/i.test(item.name));
  if (technicalSignals >= 2 || (technicalSignals >= 1 && hasTechnicalFile)) return "پیشرفته";
  if (technicalSignals === 1 || hasTechnicalFile) return "میانی";
  return "مقدماتی";
}

function systemInstruction(responseLanguage: string) {
  return `شما دستیار تخصصی مستندات لیارا هستید.
کد زبان پاسخ: ${responseLanguage}
- تمام متن کاربرپسند، سؤال تکمیلی و عنوان‌های section_titles را به زبان مشخص‌شده بنویسید. اطلاعات مستندات فارسی را در همان پاسخ ترجمه کنید.
- کد، دستور، URL، متغیر محیطی، پیام خطا و نام محصول را ترجمه نکنید و کد و دستورها را LTR و داخل code block بنویسید.
- عنوان، heading، snippet یا URL منبع را در پاسخ بازتولید یا ترجمه نکنید؛ برنامه منابع اصلی را جداگانه نمایش می‌دهد.
- طبیعی، مستقیم، دوستانه و بدون لحن رباتیک یا سرزنش‌آمیز بنویسید؛ جدیت را فقط متناسب با موضوع بالا ببرید.
- پرسش کاربر را تکرار نکنید و برای پاسخ‌های ساده، عنوان‌هایی مثل «مسیر پیشنهادی» یا قالب رسمی اجباری نسازید.
- ادعاهای مربوط به لیارا فقط باید از منابع ارائه‌شده باشند.
- بعد از هر ادعای مستند، با قالب [[شماره منبع]] ارجاع دهید.
- URL یا قابلیت نسازید و از شماره منبع خارج از فهرست استفاده نکنید.
- سطح تخصص پیام جاری را در لحن و جزئیات لحاظ کنید اما آن را نام نبرید.
- اگر داده کافی نیست فقط یک سؤال تکمیلی با بیشترین ارزش اطلاعاتی بپرسید؛ اگر پاسخ بدون سؤال کامل است، سؤال عمومی یا درخواست لاگ اضافه نکنید.
- اگر سؤال مشخص است اما پس از بررسی منابع پاسخ قابل اتکایی وجود ندارد، confidence را low، needs_clarification را false و escalation را به‌صورت متن کامل تیکت پر کنید؛ escalation_title نیز موضوع کوتاه تیکت باشد. در این حالت حدس نزنید.
- اگر هنوز یک جزئیات مشخص می‌تواند جستجو را به نتیجه برساند، escalation نسازید و فقط همان یک سؤال تکمیلی را بپرسید.
- دانش عمومی را در general_guidance جدا کنید و عنوان آن را در section_titles به زبان پاسخ بنویسید.
- Secret ماسک‌شده را حدس نزنید یا بازسازی نکنید.
- فقط وقتی واقعاً به ادامه کار کمک می‌کند، پاسخ را با حداکثر سه قدم بعدی کوتاه و عملی تمام کنید.
- تمام زیرمسئله‌های یک درخواست چندمرحله‌ای را جداگانه پوشش دهید و هیچ بخش درخواستی را حذف نکنید.
- خروجی را دقیقاً مطابق JSON Schema ارائه‌شده بسازید؛ در answer_summary و steps ارجاع [[شماره]] را کنار ادعای مستند نگه دارید.
- اگر سؤال تکمیلی لازم است needs_clarification را true و فقط یک clarification_question با بیشترین ارزش اطلاعاتی ثبت کنید.`;
}

function buildPrompt(
  request: ChatRequest,
  retrieval: RetrievalResult,
  textAttachments: ChatAttachment[],
) {
  const expertise = inferMessageExpertise(request.message, request.attachments);
  const conversationContext = buildConversationContext(
    request.history,
    request.contextSummary,
    { recentMessageCount: 6, summaryMaxCharacters: 2_400 },
  );
  const history = conversationContext.recent
    .map((item) => `${item.role === "user" ? "کاربر" : "دستیار"}: ${item.content.slice(0, 2_000)}`)
    .join("\n");
  const sourceText = retrieval.sources
    .map((source) => {
      const fullContext = retrieval.context.find((item) => item.sourceId === source.id)?.text;
      return `[منبع ${source.citationIndex}] ${source.title} > ${source.heading}\nURL: ${source.url}\n${fullContext ?? source.snippet}`;
    })
    .join("\n\n");
  const attachmentText = textAttachments
    .map((attachment) => `فایل ${attachment.name}:\n${attachment.content.slice(0, 8_000)}`)
    .join("\n\n");

  return `سطح فنی استنباط‌شده فقط برای پیام جاری: ${expertise} (این برچسب را به کاربر نشان نده)\n\nحافظه فشرده گفتگو:\n${conversationContext.summary || "ندارد"}\n\nپیام‌های اخیر:\n${history || "بدون تاریخچه"}\n\nوضعیت جریان چندمرحله‌ای:\n${workflowContext(request.workflowState)}\n\nمنابع رسمی بازیابی‌شده:\n${sourceText || "منبعی پیدا نشد"}\n\nداده متنی کاربر:\n${attachmentText || "ندارد"}\n\nپرسش فعلی:\n${request.message}`;
}

export function buildAgentModelInput(
  request: ChatRequest,
  retrieval: RetrievalResult,
  textAttachments: ChatAttachment[],
  binaryAttachments: ChatAttachment[],
  responseLanguage: string,
): ModelTurnInput {
  return {
    systemInstruction: systemInstruction(responseLanguage),
    prompt: buildPrompt(request, retrieval, textAttachments),
    currentUserMessage: request.message,
    attachments: binaryAttachments,
    sources: retrieval.sources,
    responseSchema: structuredModelResponseJsonSchema,
  };
}
