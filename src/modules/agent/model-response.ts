import { z } from "zod";

const codeBlockSchema = z.object({
  language: z.string().max(32),
  code: z.string().max(8_000),
}).strict();

const sectionTitlesSchema = z.object({
  steps: z.string().min(1).max(120),
  general_guidance: z.string().min(1).max(120),
  assumptions: z.string().min(1).max(120),
  next_actions: z.string().min(1).max(120),
}).strict();

export const structuredModelResponseSchema = z.object({
  intent: z.string().min(1).max(80),
  service: z.string().min(1).max(80),
  expertise_hint: z.enum(["beginner", "intermediate", "advanced"]),
  needs_clarification: z.boolean(),
  clarification_question: z.string().max(500),
  answer_summary: z.string().max(6_000),
  steps: z.array(z.string().max(2_000)).max(8),
  code_blocks: z.array(codeBlockSchema).max(4),
  citations: z.array(z.number().int().min(1).max(8)).max(8),
  section_titles: sectionTitlesSchema,
  general_guidance: z.string().max(3_000),
  assumptions: z.array(z.string().max(500)).max(5),
  confidence: z.enum(["high", "medium", "low"]),
  next_actions: z.array(z.string().max(500)).max(3),
  escalation: z.string().max(4_000),
  escalation_title: z.string().max(180).optional(),
}).strict();

export type StructuredModelResponse = z.infer<typeof structuredModelResponseSchema>;

export const structuredModelResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent", "service", "expertise_hint", "needs_clarification", "clarification_question",
    "answer_summary", "steps", "code_blocks", "citations", "section_titles", "general_guidance", "assumptions",
    "confidence", "next_actions", "escalation",
  ],
  properties: {
    intent: { type: "string" },
    service: { type: "string" },
    expertise_hint: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
    needs_clarification: { type: "boolean" },
    clarification_question: { type: "string" },
    answer_summary: { type: "string" },
    steps: { type: "array", maxItems: 8, items: { type: "string" } },
    code_blocks: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["language", "code"],
        properties: { language: { type: "string" }, code: { type: "string" } },
      },
    },
    citations: { type: "array", maxItems: 8, items: { type: "integer", minimum: 1, maximum: 8 } },
    section_titles: {
      type: "object",
      additionalProperties: false,
      required: ["steps", "general_guidance", "assumptions", "next_actions"],
      properties: {
        steps: { type: "string" },
        general_guidance: { type: "string" },
        assumptions: { type: "string" },
        next_actions: { type: "string" },
      },
    },
    general_guidance: { type: "string" },
    assumptions: { type: "array", maxItems: 5, items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    next_actions: { type: "array", maxItems: 3, items: { type: "string" } },
    escalation: { type: "string" },
    escalation_title: { type: "string" },
  },
} as const;

export function parseStructuredModelResponse(raw: string) {
  try {
    return structuredModelResponseSchema.safeParse(JSON.parse(raw));
  } catch {
    return structuredModelResponseSchema.safeParse(undefined);
  }
}

export function renderStructuredModelResponse(response: StructuredModelResponse) {
  const sections: string[] = [];
  if (response.answer_summary.trim()) sections.push(response.answer_summary.trim());
  if (response.steps.length) {
    sections.push(`### ${response.section_titles.steps}\n\n${response.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`);
  }
  for (const block of response.code_blocks) {
    sections.push(`\`\`\`${block.language}\n${block.code}\n\`\`\``);
  }
  if (response.general_guidance.trim()) {
    sections.push(`### ${response.section_titles.general_guidance}\n\n${response.general_guidance.trim()}`);
  }
  if (response.assumptions.length) {
    sections.push(`### ${response.section_titles.assumptions}\n\n${response.assumptions.map((item) => `- ${item}`).join("\n")}`);
  }
  if (response.next_actions.length) {
    sections.push(`### ${response.section_titles.next_actions}\n\n${response.next_actions.map((item) => `- ${item}`).join("\n")}`);
  }
  return sections.join("\n\n").trim();
}

function attachCitations(text: string, markers: string) {
  const trimmed = text.trim();
  if (!trimmed || /\[\[\d+\]\]/.test(trimmed) || !markers) return trimmed;
  return `${trimmed} ${markers}`;
}

/**
 * Converts the model's structured citation list into claim-level markers.
 * Unknown source indexes are discarded before Markdown reaches the policy
 * validator, while their count still lowers confidence and feeds metrics.
 */
export function groundStructuredModelResponse(
  response: StructuredModelResponse,
  sourceCount: number,
) {
  const uniqueCitations = [...new Set(response.citations)];
  const validCitations = uniqueCitations.filter((index) => index <= sourceCount);
  const invalidCitationCount = uniqueCitations.length - validCitations.length;
  const markers = validCitations.map((index) => `[[${index}]]`).join(" ");
  const grounded: StructuredModelResponse = {
    ...response,
    citations: validCitations,
    answer_summary: attachCitations(response.answer_summary, markers),
    steps: response.steps.map((step) => attachCitations(step, markers)),
    assumptions: response.assumptions,
    next_actions: response.next_actions,
  };
  return { markdown: renderStructuredModelResponse(grounded), invalidCitationCount };
}
