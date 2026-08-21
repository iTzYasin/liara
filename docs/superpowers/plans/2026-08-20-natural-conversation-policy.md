# Natural Conversation Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Liara assistant respond naturally to social messages, remain rigorous for technical questions, ask one useful clarification when evidence is insufficient, and escalate only when the user asks or repeated attempts fail.

**Architecture:** Add one in-process conversation-policy module in front of retrieval. It owns whole-message social routing, vague-support intake, scope boundaries, and staged evidence-gap decisions; `streamAgentTurn` remains the single public orchestration seam and keeps security, retrieval, citation validation, workflow, and observability intact. Social turns use the same SSE contract but skip retrieval/model work and do not mutate an active technical workflow.

**Tech Stack:** TypeScript, Next.js 16 App Router, Vitest, Playwright, existing RAG and SSE modules.

**Spec:** `PRD-liara-assistant.md`, `liara-req.txt`, and the approved conversation design in the current task.

## Global Constraints

- All user-facing replies remain Persian; code and commands remain LTR.
- Liara-specific claims may use only indexed Liara documentation and user-provided content.
- The assistant has no access to user accounts, services, or logs unless the user pastes data into the conversation.
- Per-message expertise adaptation remains internal and is never shown as a label.
- Pure social messages must not call retrieval or the language model.
- A mixed message such as `سلام، دامنه‌ام وصل نمی‌شود` remains a technical RAG turn.
- Missing evidence must never produce an invented Liara claim or an automatic support ticket on the first attempt.
- Existing redaction, prompt-injection filtering, citation enforcement, response cache, and workflow behavior remain in force.

---

### Task 1: Pre-retrieval conversation policy

**Files:**
- Create: `src/modules/agent/conversation-policy.ts`
- Modify: `src/modules/agent/agent.ts`
- Test: `src/modules/agent/agent.test.ts`

**Interfaces:**
- Consumes: redacted `ChatRequest.message` before retrieval.
- Produces: `conversationDecisionBeforeRetrieval(message, history)` returning a direct decision or `undefined`.
- Produces: direct decision fields `outcome`, `intent`, `confidence`, `status`, and `text`.

- [x] **Step 1: Write failing social-routing tests**

Add seam-level tests proving `سلام` and `ممنون از راهنمایی` produce short Persian replies, emit `intent: "social"`, emit no workflow event, and complete even when both retriever and model throw if called. Add counterexamples proving `سلام، دامنه‌ام وصل نمی‌شود` and `ممنون، ولی خطا هنوز هست` are not classified as social.

- [x] **Step 2: Run the focused test and observe the current failure**

Run: `npx vitest run src/modules/agent/agent.test.ts -t "social|mixed"`

Expected: pure social messages currently invoke retrieval or return a technical clarification, so the new assertions fail.

- [x] **Step 3: Implement whole-message social routing**

Create an anchored, normalized classifier for greetings, thanks, farewells, and capability questions. Return concise replies such as `سلام! خوش اومدی...`; never match when technical or unresolved-problem content remains in the normalized message. Integrate the decision before `retriever.retrieve` while retaining common meta, metrics, and `done` events.

- [x] **Step 4: Run the focused tests until green**

Run: `npx vitest run src/modules/agent/agent.test.ts -t "social|mixed"`

Expected: all social and mixed-message tests pass.

- [x] **Step 5: Add and implement warm vague-support intake**

Write a failing test for `یه مشکلی دارم`, then implement a direct clarification that acknowledges the user and asks exactly one high-information question for service name plus exact error/behavior. Verify the response contains one Persian question mark and no ticket template.

### Task 2: Progressive evidence gap and escalation

**Files:**
- Modify: `src/modules/agent/conversation-policy.ts`
- Modify: `src/modules/agent/agent.ts`
- Modify: `src/modules/observability/metrics.ts`
- Test: `src/modules/agent/agent.test.ts`
- Test: `src/modules/observability/metrics.test.ts`

**Interfaces:**
- Consumes: technical message, sanitized history, and low retrieval confidence.
- Produces: `conversationDecisionForEvidenceGap(message, history)` with either `clarification` or `escalation`.
- Extends: `MetricEvent.chat.completed.outcome` with `conversation` so social turns do not pollute RAG no-result, source, clarification, or escalation rates.

- [x] **Step 1: Replace the automatic-ticket expectation with a failing staged-fallback test**

For an undocumented first attempt, assert one evidence-gap clarification, no fabricated source, no model call, and no `متن آماده تیکت`. Add separate failing tests proving an explicit `لطفاً متن تیکت بساز` request and a repeated unresolved low-evidence attempt can produce the ticket template.

- [x] **Step 2: Implement evidence-gap policy and scope boundary**

On the first low-confidence retrieval, state that evidence is insufficient, ask for service/error/last change, and offer ticket preparation without creating it. Generate the existing ticket template only for explicit support/ticket intent or after a prior evidence-gap response appears in history. For medical or unrelated requests, return a brief safe scope boundary without creating a Liara ticket.

- [x] **Step 3: Verify policy behavior through `streamAgentTurn`**

Run: `npx vitest run src/modules/agent/agent.test.ts`

Expected: social, vague, evidence-gap, explicit escalation, out-of-scope, security, context, structured-output, citation, and workflow tests all pass.

- [x] **Step 4: Protect quality metrics from social traffic**

Write a failing metrics test with one grounded answer and one `conversation` turn. Assert `averageSources` and `noResultRate` use only knowledge turns, while request success and usage still include both. Implement the knowledge-turn denominator and rerun `npx vitest run src/modules/observability/metrics.test.ts`.

### Task 3: Natural technical tone and end-to-end proof

**Files:**
- Modify: `src/modules/agent/agent.ts`
- Modify: `tests/e2e/chat.spec.ts`

**Interfaces:**
- Consumes: existing structured response schema and source list.
- Produces: concise Persian technical responses with claim-level citations and contextual next steps, without forced generic headings or unnecessary requests for logs.

- [x] **Step 1: Add a failing browser scenario for a social-to-technical conversation**

Send `سلام` and assert a short greeting without a source panel or workflow card. Continue in the same conversation with a documented domain question and assert a grounded technical answer plus the source control.

- [x] **Step 2: Tune model and demo instructions**

Tell the model to use a natural, direct, non-condescending Persian tone; avoid repeating the user or adding generic headings; ask a follow-up only when it changes the next action. Make the demo adapter concise and contextual while retaining citations.

- [x] **Step 3: Run focused and full verification**

Run: `npm run check`

Run: `npm run golden:eval`

Run: `npm run test:e2e`

Run: `npm run build`

Expected: every command exits with code 0; golden retrieval/citation safety remains at the established baseline; browser tests prove the social-to-technical flow.
