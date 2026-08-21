# LLM-First AvalAI Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** تمام پیام‌های معتبر ابتدا توسط `deepseek-v4-flash` فهمیده شوند و مدل فقط هنگام نیاز RAG مستندات لیارا را فعال کند.

**Architecture:** یک router ساختارمند و provider-neutral پیش از retrieval قرار می‌گیرد. تصمیم `respond` مستقیماً متن تولیدشده مدل را برمی‌گرداند و تصمیم `search_docs` جست‌وجو را اجرا کرده و نتیجه را برای پاسخ نهایی citationدار دوباره به مدل می‌دهد؛ منطق قطعی فقط امنیت، schema، citation و transport را کنترل می‌کند.

**Tech Stack:** Next.js 16.3.1، TypeScript 5.9، Vitest 4، Zod 4، AvalAI OpenAI-compatible Chat Completions، DeepSeek V4 Flash

**Spec:** `docs/superpowers/specs/2026-08-20-llm-first-agent-loop-design.md`

## Global Constraints

- خروجی کاربر فقط فارسی است و سطح تخصص هر پیام به‌صورت داخلی تعیین می‌شود.
- هیچ پاسخ social، clarification، escalation یا evidence-gap در کد ثابت نوشته نمی‌شود.
- ادعاهای مربوط به لیارا بدون citation معتبر نمایش داده نمی‌شوند.
- Secret پیش از هر فراخوانی مدل و retrieval ماسک می‌شود.
- `.env.local` حاوی کلید است و نباید وارد Git شود.
- Demo فقط با `DEMO_MODE=true` فعال می‌شود.

---

### Task 1: AvalAI provider adapter

**Files:**
- Create: `src/modules/agent/avalai-model-adapter.ts`
- Test: `src/modules/agent/avalai-model-adapter.test.ts`
- Test: `src/modules/agent/model-provider-selection.test.ts`
- Modify: `src/modules/agent/agent.ts`
- Modify: `.env.example`
- Local only: `.env.local`

**Interfaces:**
- Consumes: `LanguageModelAdapter.stream(input)`
- Produces: `AvalAIModelAdapter`, provider selection through `createModelAdapter()`

- [x] **Step 1: Write and run the failing streaming contract test**

```ts
const model = new AvalAIModelAdapter(key, "deepseek-v4-flash", baseUrl, providerFetch);
expect(await collect(model.stream(input))).toBe('{"answer_summary":"ok"}');
```

- [x] **Step 2: Implement SSE parsing and structured output request**

```ts
body: JSON.stringify({
  model: this.requestedModel,
  messages,
  stream: true,
  response_format: { type: "json_object" },
})
```

- [x] **Step 3: Select AvalAI from env and fail closed without a key**

```ts
if (provider === "avalai" && !avalaiApiKey) {
  throw new Error("AVALAI_API_KEY is required when MODEL_PROVIDER=avalai");
}
```

- [x] **Step 4: Verify with the real `/api/chat` seam**

Expected: `meta.model === "deepseek-v4-flash"` and the answer contains valid Liara citations.

### Task 2: Structured conversation router

**Files:**
- Create: `src/modules/agent/conversation-router.ts`
- Test: `src/modules/agent/conversation-router.test.ts`
- Modify: `src/modules/agent/agent.ts`
- Modify: `src/modules/agent/avalai-model-adapter.ts`

**Interfaces:**
- Consumes: `LanguageModelAdapter.stream(ModelTurnInput)` with an optional response schema
- Produces: `routeConversationTurn(request, model): Promise<ConversationRouteDecision>`

- [x] **Step 1: Write the failing router behavior test**

```ts
expect(await routeConversationTurn(socialRequest, model)).toEqual(expect.objectContaining({
  action: "respond",
  outcome: "conversation",
  response: "سلام! خوشحالم که حالت خوبه.",
}));
```

- [x] **Step 2: Verify RED**

Run: `npx vitest run src/modules/agent/conversation-router.test.ts --reporter=verbose`

Expected: FAIL because `routeConversationTurn` does not exist.

- [x] **Step 3: Implement the decision schema and one repair attempt**

```ts
const routeSchema = z.object({
  action: z.enum(["respond", "search_docs"]),
  intent: z.string().min(1).max(80),
  outcome: z.enum(["conversation", "answer", "clarification", "escalation", "out_of_scope"]),
  expertise_hint: z.enum(["beginner", "intermediate", "advanced"]),
  response: z.string().max(6_000),
  search_query: z.string().max(1_000),
  confidence: z.enum(["high", "medium", "low"]),
}).strict();
```

- [x] **Step 4: Make response schema provider-neutral**

```ts
export interface ModelTurnInput {
  systemInstruction: string;
  prompt: string;
  attachments: ChatAttachment[];
  sources: SourceDocument[];
  responseSchema?: Record<string, unknown>;
}
```

- [x] **Step 5: Verify GREEN**

Run: `npx vitest run src/modules/agent/conversation-router.test.ts src/modules/agent/avalai-model-adapter.test.ts src/modules/agent/gemini-model-adapter.test.ts --reporter=verbose`

Expected: all tests PASS.

### Task 3: Replace static pre-routing with the model decision

**Files:**
- Modify: `src/modules/agent/agent.ts`
- Modify: `src/modules/agent/agent.test.ts`
- Delete: `src/modules/agent/conversation-policy.ts`
- Modify: `src/modules/agent/workflow-state.ts`

**Interfaces:**
- Consumes: `routeConversationTurn()` and `ConversationRouteDecision`
- Produces: unchanged public stream `streamAgentTurn(request, dependencies)`

- [x] **Step 1: Write failing social-to-technical tests at the agent seam**

```ts
const social = await collect(streamAgentTurn(request("hi چطوری من خوبم"), deps));
expect(textOf(social)).toBe("سلام! خوشحالم که حالت خوبه.");
expect(metaOf(social).model).toBe("deepseek-v4-flash");
expect(retrieverCalls).toBe(0);
```

- [x] **Step 2: Write failing low-evidence test**

```ts
expect(textOf(await collect(streamAgentTurn(request("خطای ناشناخته"), deps))))
  .toBe("متن خطا و نام سرویس را می‌فرستی؟");
expect(modelCalls).toBe(2);
```

- [x] **Step 3: Verify RED**

Run: `npx vitest run src/modules/agent/agent.test.ts --reporter=verbose`

Expected: social metadata is `conversation-policy` and low retrieval bypasses the model.

- [x] **Step 4: Use the router before retrieval**

```ts
const route = await routeConversationTurn(sanitizedRequest, dependencies.model);
if (route.action === "respond") {
  yield { type: "sources", sources: [] };
  yield { type: "delta", text: route.response };
  return;
}
const retrieval = await dependencies.retriever.retrieve(route.search_query, 8);
```

- [x] **Step 5: Remove static clarification and evidence-gap replacement**

For a generated clarification use only `generated.response.clarification_question`; for a low-confidence generated response use its `answer_summary` or throw a model-contract error when both fields are empty. Do not call a local text builder.

- [x] **Step 6: Make Demo explicit and router-aware**

The demo adapter returns valid route JSON only when `DEMO_MODE=true`; normal missing-key configuration throws.

- [x] **Step 7: Verify GREEN**

Run: `npx vitest run src/modules/agent/agent.test.ts src/modules/evaluation/golden-set.test.ts --reporter=verbose`

Expected: all tests PASS and no successful user response has model `conversation-policy`.

### Task 4: Readiness, documentation and end-to-end verification

**Files:**
- Modify: `src/app/readyz/route.ts`
- Modify: `README.md`
- Modify: `tests/e2e/chat.spec.ts`
- Modify: `docs/superpowers/plans/2026-08-20-llm-first-avalai-agent.md`

**Interfaces:**
- Consumes: configured provider and public `/api/chat` stream
- Produces: accurate readiness and verified responsive conversation behavior

- [x] **Step 1: Add readiness coverage for AvalAI**

```ts
const providerReady = provider === "avalai"
  ? Boolean(process.env.AVALAI_API_KEY)
  : Boolean(process.env.GEMINI_API_KEY);
```

- [x] **Step 2: Document safe local configuration**

Document only variable names and non-sensitive defaults; never copy the key into README or `.env.example`.

- [x] **Step 3: Extend E2E metadata behavior**

The greeting-to-technical flow must show no source card for greeting and valid source cards for the technical turn, while preserving history on desktop, tablet and mobile.

- [x] **Step 4: Run full verification**

```powershell
npm run check
npm run golden:eval
npm run test:e2e -- --reporter=line
npm run build
```

Expected: all commands exit 0; Golden Set has no invalid citation leaks.

- [x] **Step 5: Run real AvalAI smoke cases**

Send `hi چطوری من خوبم`, `دامنه‌ام وصل نمی‌شود`, and a complete technical question through `/api/chat`.

Expected: model is `deepseek-v4-flash`; social skips retrieval; vague technical asks one contextual question; complete technical response includes valid Liara sources.
