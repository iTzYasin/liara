import type { AgentWorkflowState } from "@/modules/agent/workflow-state";
import type { ChatRequest } from "@/modules/chat/types";
import {
  redactObjectText,
  redactSensitiveText,
} from "@/modules/security/secret-redactor";

function sanitizeWorkflowState(state: AgentWorkflowState | undefined) {
  if (!state) return { state: undefined, count: 0 };
  const goal = redactSensitiveText(state.goal);
  let count = goal.count;
  const steps = state.steps.map((step) => {
    const label = redactSensitiveText(step.label);
    count += label.count;
    return { ...step, label: label.text };
  });
  return { state: { ...state, goal: goal.text, steps }, count };
}

export function sanitizeAgentRequest(request: ChatRequest) {
  const message = redactSensitiveText(request.message);
  const contextSummary = redactSensitiveText(request.contextSummary ?? "");
  const workflow = sanitizeWorkflowState(request.workflowState);
  const history = redactObjectText(request.history);
  const textAttachments = request.attachments.filter((item) => item.kind === "text");
  const attachments = redactObjectText(textAttachments);
  const binaryAttachments = request.attachments.filter((item) => item.kind !== "text");
  const redactionCount = message.count + contextSummary.count + workflow.count
    + history.count + attachments.count;

  return {
    request: {
      ...request,
      message: message.text,
      contextSummary: contextSummary.text,
      workflowState: workflow.state,
      history: history.items,
      attachments: [...attachments.items, ...binaryAttachments],
    } satisfies ChatRequest,
    textAttachments: attachments.items,
    binaryAttachments,
    redactionCount,
  };
}
