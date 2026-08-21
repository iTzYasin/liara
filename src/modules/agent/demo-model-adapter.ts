import type {
  LanguageModelAdapter,
  ModelTurnInput,
} from "@/modules/agent/model-adapter";
import { workflowSourceOrder } from "@/modules/agent/workflow-state";

export class DemoModelAdapter implements LanguageModelAdapter {
  readonly name = "demo-grounded";
  readonly structuredOutput = true;

  async *stream(input: ModelTurnInput): AsyncIterable<string> {
    const schemaProperties = (input.responseSchema as {
      properties?: Record<string, unknown>;
    } | undefined)?.properties;
    const isConversationRoute = Boolean(schemaProperties && "action" in schemaProperties);
    const currentQuestion = input.currentUserMessage?.trim()
      ?? input.prompt.match(/(?:پیام جاری کاربر|پرسش فعلی):\n([\s\S]*)$/)?.[1]?.trim()
      ?? input.prompt;
    const isContextualFollowUp = /این|همان|ادامه|بعدی|قبلی|آن را|آن مسیر/u.test(currentQuestion);
    const retrievalQuestion = isContextualFollowUp && input.retrievalContext?.trim()
      ? `${input.retrievalContext.trim()} ${currentQuestion}`
      : currentQuestion;

    if (isConversationRoute) {
      const normalizedQuestion = currentQuestion.replace(/\s+/g, " ").trim();
      const social = /^(?:(?:hi|hello|سلام|درود|خوبی|چطوری|ممنون|مرسی|خداحافظ)[.!؟?]*|hi چطوری من خوبم)$/i.test(normalizedQuestion);
      const vague = /^(?:(?:سلام|درود)[،, ]*)?(?:(?:یه |یک )?مشکل دارم|کمکم کن|کار نمی.?کنه|کار نمی.?کند|خطا میده|خرابه|سرویس بالا نمیاد|دامنه.?ام وصل نمی.?شود)[.!؟?]*$/i.test(normalizedQuestion);
      const escalation = /تیکت|پشتیبانی|کارشناس|اپراتور/i.test(currentQuestion);
      const outOfScope = /بیمه|نسخه پزشکی|بیمار|بلیت قطار|طلا|غذا سفارش|پرونده مالیاتی|حساب بانکی|تاکسی|موجودی انبار|آزمایش خون/i.test(currentQuestion);
      const route = outOfScope
        ? {
            action: "respond",
            intent: "out-of-scope",
            outcome: "out_of_scope",
            expertise_hint: "beginner",
            response_language: "fa",
            response: "این درخواست خارج از حوزه مستندات لیارا است. من فقط برای سؤال‌ها و مشکلات مربوط به لیارا و داده‌ای که خودت می‌فرستی طراحی شده‌ام.",
            search_query: "",
            confidence: "high",
          }
        : social
        ? {
            action: "respond",
            intent: "social",
            outcome: "conversation",
            expertise_hint: "beginner",
            response_language: "fa",
            response: "سلام! خوش اومدی. چطور می‌تونم کمکت کنم؟",
            search_query: "",
            confidence: "high",
          }
        : vague
          ? {
              action: "respond",
              intent: "support-intake",
              outcome: "clarification",
              expertise_hint: "beginner",
              response_language: "fa",
              response: "نام سرویس لیارا و متن دقیق خطا یا رفتاری که می‌بینی را می‌فرستی؟",
              search_query: "",
              confidence: "low",
            }
          : escalation
            ? {
                action: "respond",
                intent: "escalation",
                outcome: "escalation",
                expertise_hint: "intermediate",
                response_language: "fa",
                response: `نمی‌خواهم حدس بزنم. ### متن آماده تیکت\n\nشرح مسئله: ${currentQuestion.slice(0, 500)}\n\nنام سرویس، زمان رخداد و متن کامل خطا را هم ضمیمه کن.`,
                search_query: "",
                confidence: "medium",
                ticket_subject: `پیگیری مشکل لیارا: ${currentQuestion.slice(0, 90)}`,
                ticket_body: `شرح مسئله:\n${currentQuestion.slice(0, 1_500)}\n\nاقدام‌های انجام‌شده:\nدر گفتگو ثبت نشده است.\n\nاطلاعات تکمیلی موردنیاز:\nنام سرویس، زمان رخداد و متن کامل خطا`,
              }
            : {
                action: "search_docs",
                intent: "documentation-qa",
                outcome: "answer",
                expertise_hint: "intermediate",
                response_language: "fa",
                response: "",
                search_query: retrievalQuestion.slice(0, 1_000),
                confidence: "medium",
              };
      yield JSON.stringify(route);
      return;
    }

    const source = input.sources[0];
    const second = input.sources[1];
    const troubleshooting = /خطا|ارور|error|exception|failed|timeout|کار نمی|وصل نمی|بالا نمی/i.test(currentQuestion);
    const demoIntent = troubleshooting
      ? "troubleshooting"
      : /چطور|چگونه|راه.?انداز|نصب|استقرار|اتصال/i.test(currentQuestion)
        ? "guided-setup"
        : "documentation-qa";
    const shouldPlan = demoIntent !== "documentation-qa"
      || !input.prompt.includes("وضعیت جریان چندمرحله‌ای:\nندارد");
    const answer = source
      ? {
          intent: demoIntent,
          service: source.service,
          expertise_hint: "intermediate",
          needs_clarification: false,
          clarification_question: "",
          answer_summary: `${source.snippet.replace(/\[.*?\]\(.*?\)/g, "").slice(0, 480)} [[1]]`,
          steps: shouldPlan
            ? input.sources.slice(0, 3)
              .map((item, index) => ({ item, index }))
              .sort((left, right) =>
                workflowSourceOrder(left.item.path, left.index)
                - workflowSourceOrder(right.item.path, right.index))
              .map(({ item }) => `بررسی بخش «${item.heading}» [[${item.citationIndex}]]`)
            : [],
          code_blocks: [],
          citations: second ? [1, 2] : [1],
          section_titles: {
            steps: "مراحل پیشنهادی",
            general_guidance: "راهنمای عمومی خارج از مستندات لیارا",
            assumptions: "فرض‌های پاسخ",
            next_actions: "قدم بعدی",
          },
          general_guidance: "",
          assumptions: [],
          confidence: "high",
          next_actions: [],
          escalation: "",
        }
      : {
          intent: "support-intake",
          service: "unknown",
          expertise_hint: "beginner",
          needs_clarification: true,
          clarification_question: "نام سرویس و متن دقیق خطا یا رفتار مشاهده‌شده را می‌فرستی؟",
          answer_summary: "",
          steps: [],
          code_blocks: [],
          citations: [],
          section_titles: {
            steps: "مراحل پیشنهادی",
            general_guidance: "راهنمای عمومی خارج از مستندات لیارا",
            assumptions: "فرض‌های پاسخ",
            next_actions: "قدم بعدی",
          },
          general_guidance: "",
          assumptions: [],
          confidence: "low",
          next_actions: [],
          escalation: "",
        };
    yield JSON.stringify(answer);
  }
}
