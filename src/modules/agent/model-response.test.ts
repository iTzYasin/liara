import { describe, expect, it } from "vitest";
import {
  groundStructuredModelResponse,
  parseStructuredModelResponse,
  renderStructuredModelResponse,
  type StructuredModelResponse,
} from "@/modules/agent/model-response";

const valid = {
  intent: "guided-setup",
  service: "paas",
  expertise_hint: "intermediate",
  needs_clarification: false,
  clarification_question: "",
  answer_summary: "دامنه را از بخش دامنه‌ها اضافه کنید. [[1]]",
  steps: ["رکورد DNS نمایش‌داده‌شده را ثبت کنید. [[1]]"],
  code_blocks: [],
  citations: [1],
  section_titles: {
    steps: "مراحل پیشنهادی",
    general_guidance: "راهنمای عمومی خارج از مستندات لیارا",
    assumptions: "فرض‌های پاسخ",
    next_actions: "قدم بعدی",
  },
  general_guidance: "",
  assumptions: [],
  confidence: "high",
  next_actions: ["وضعیت دامنه را دوباره بررسی کنید"],
  escalation: "",
} satisfies StructuredModelResponse;

describe("structured model response", () => {
  it("validates and renders the PRD response contract", () => {
    const parsed = parseStructuredModelResponse(JSON.stringify(valid));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const markdown = renderStructuredModelResponse(parsed.data);
    expect(markdown).toContain("دامنه را از بخش دامنه‌ها اضافه کنید. [[1]]");
    expect(markdown).toContain("### مراحل پیشنهادی");
    expect(markdown).toContain("### قدم بعدی");
  });

  it("rejects output that exceeds the three-action product limit", () => {
    const parsed = parseStructuredModelResponse(JSON.stringify({
      ...valid,
      next_actions: ["یک", "دو", "سه", "چهار"],
    }));
    expect(parsed.success).toBe(false);
  });

  it("attaches only valid structured citations to uncited claims", () => {
    const grounded = groundStructuredModelResponse({
      ...valid,
      answer_summary: "دامنه را از بخش دامنه‌ها اضافه کنید.",
      steps: ["رکورد DNS نمایش‌داده‌شده را ثبت کنید."],
      citations: [1, 8],
      next_actions: ["وضعیت دامنه را دوباره بررسی کنید"],
    }, 2);

    expect(grounded.markdown).toContain("دامنه‌ها اضافه کنید. [[1]]");
    expect(grounded.markdown).toContain("رکورد DNS نمایش‌داده‌شده را ثبت کنید. [[1]]");
    expect(grounded.markdown).toContain("وضعیت دامنه را دوباره بررسی کنید");
    expect(grounded.markdown).not.toContain("وضعیت دامنه را دوباره بررسی کنید [[1]]");
    expect(grounded.markdown).not.toContain("[[8]]");
    expect(grounded.invalidCitationCount).toBe(1);
  });

  it("renders section titles supplied by the model in the answer language", () => {
    const parsed = parseStructuredModelResponse(JSON.stringify({
      ...valid,
      answer_summary: "Добавьте домен в панели Liara. [[1]]",
      steps: ["Настройте указанную DNS-запись. [[1]]"],
      next_actions: ["Снова проверьте статус домена"],
      section_titles: {
        steps: "Рекомендуемые шаги",
        general_guidance: "Общие рекомендации вне документации Liara",
        assumptions: "Предположения",
        next_actions: "Следующий шаг",
      },
    }));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const markdown = renderStructuredModelResponse(parsed.data);
    expect(markdown).toContain("### Рекомендуемые шаги");
    expect(markdown).toContain("### Следующий шаг");
    expect(markdown).not.toContain("### مراحل پیشنهادی");
  });
});
