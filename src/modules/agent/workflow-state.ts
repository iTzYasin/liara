import { z } from "zod";

export const workflowStepSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(500),
  status: z.enum(["pending", "current", "confirmed"]),
}).strict();

export const agentWorkflowStateSchema = z.object({
  goal: z.string().min(1).max(500),
  phase: z.enum(["active", "awaiting-user", "resolved", "escalated"]),
  steps: z.array(workflowStepSchema).max(6),
  turnCount: z.number().int().min(1).max(100),
}).strict();

export type AgentWorkflowState = z.infer<typeof agentWorkflowStateSchema>;

export function workflowSourceOrder(path: string | undefined, fallbackOrder: number) {
  if (!path) return 100 + fallbackOrder;
  if (/\badd-domain\.md$|\bcreate-backup\.md$|\btake-full-backup\.md$/i.test(path)) return 10;
  if (/\benable-ssl\.md$|\brestore-backup\.md$/i.test(path)) return 20;
  return 100 + fallbackOrder;
}

interface WorkflowTurn {
  message: string;
  intent: string;
  outcome: "answer" | "clarification" | "escalation";
  proposedSteps: string[];
}

function cleanStep(value: string) {
  return value
    .replace(/\[\[[^\]]+\]\]/g, "")
    .replace(/^\s*(?:[-*]|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function identity(value: string) {
  return cleanStep(value)
    .normalize("NFKC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[.،,:؛!?؟\s]/g, "")
    .toLocaleLowerCase("fa-IR");
}

function explicitlyResolved(message: string) {
  return /(?:مشکل|مسئله|خطا)?.{0,18}(?:حل|برطرف|درست) شد|الان کار می.?کنه|الان کار می.?کند/i.test(message);
}

function explicitlyConfirmed(message: string) {
  return /انجام(?:ش)? دادم|انجام شد|اوکی شد|بررسی کردم|اجرا کردم|تمام شد/i.test(message);
}

function nextStatus(steps: AgentWorkflowState["steps"]) {
  let currentAssigned = false;
  return steps.map((step) => {
    if (step.status === "confirmed") return step;
    if (!currentAssigned) {
      currentAssigned = true;
      return { ...step, status: "current" as const };
    }
    return { ...step, status: "pending" as const };
  });
}

export function advanceWorkflow(
  previous: AgentWorkflowState | undefined,
  turn: WorkflowTurn,
): AgentWorkflowState | undefined {
  const proposed = turn.proposedSteps.map(cleanStep).filter(Boolean);
  if (!previous && proposed.length === 0 && turn.outcome !== "escalation") return undefined;

  let steps = previous?.steps.map((step) => ({ ...step })) ?? [];
  if (previous && explicitlyConfirmed(turn.message)) {
    const current = steps.find((step) => step.status === "current");
    if (current) current.status = "confirmed";
  }

  if (proposed.length) {
    const existing = new Map(steps.map((step) => [identity(step.label), step]));
    const reconciled = steps.filter((step) => step.status === "confirmed");
    const known = new Set(reconciled.map((step) => identity(step.label)));
    for (const label of proposed) {
      const key = identity(label);
      if (!key || known.has(key) || reconciled.length >= 6) continue;
      const matched = existing.get(key);
      known.add(key);
      reconciled.push({
        id: matched?.id ?? `step-${(previous?.turnCount ?? 0) + 1}-${reconciled.length + 1}`,
        label,
        status: matched?.status ?? "pending",
      });
    }
    // Proposed steps are the grounded plan for this turn. Retaining old,
    // unconfirmed steps would preserve retrieval/model mistakes as "memory".
    steps = reconciled;
  }
  if (!steps.length && turn.outcome === "escalation") {
    steps.push({ id: "step-1", label: "آماده‌سازی متن تیکت پشتیبانی", status: "current" });
  }

  if (explicitlyResolved(turn.message)) {
    return {
      goal: previous?.goal ?? cleanStep(turn.message).slice(0, 500),
      phase: "resolved",
      steps: steps.map((step) => ({ ...step, status: "confirmed" })),
      turnCount: (previous?.turnCount ?? 0) + 1,
    };
  }

  const phase = turn.outcome === "escalation"
    ? "escalated"
    : turn.outcome === "clarification"
      ? "awaiting-user"
      : "active";
  return {
    goal: previous?.goal ?? cleanStep(turn.message).slice(0, 500),
    phase,
    steps: nextStatus(steps),
    turnCount: (previous?.turnCount ?? 0) + 1,
  };
}

export function workflowContext(state: AgentWorkflowState | undefined) {
  if (!state) return "ندارد";
  const statusLabel = {
    confirmed: "تأییدشده توسط کاربر",
    current: "در حال بررسی",
    pending: "انجام‌نشده",
  } as const;
  return [
    `هدف: ${state.goal}`,
    `وضعیت جریان: ${state.phase}`,
    ...state.steps.map((step) => `${statusLabel[step.status]}: ${step.label}`),
  ].join("\n");
}
