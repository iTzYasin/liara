# Panel, Docs, and Agent Entry Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build faithful mock Liara panel and documentation entry pages that route into the existing assistant with a safe, origin-aware empty state and a working return path.

**Architecture:** Keep the existing standalone `/` authentication and chat flow unchanged. Add `/panel` and `/docs` as focused demo surfaces, and `/assistant` as an authenticated demo route backed by the existing `ChatWorkspace`; a pure parser converts the `source` query parameter into a small `AssistantEntryContext` used only by UI. Reuse the current Next.js 16 runtime, local brand assets, chat storage, and component patterns instead of importing the separate Next.js 14 documentation application.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Lucide React, existing CSS design system, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-21-panel-docs-agent-entry-flow-design.md`

## Global Constraints

- Preserve the existing `/` route, `MockAuthGate`, registration, login, and standalone chat behavior.
- Use only `source=panel`, `source=docs`, or the safe direct fallback; never inject arbitrary query-string text or URLs into the model or UI.
- Do not automatically send a message when `/assistant` opens.
- Do not copy personal name, avatar, team, credit, or account data from the supplied screenshot.
- Do not import the Next.js 14 / React 18 documentation runtime into this Next.js 16.3.1 / React 19.2.8 app.
- Use the local Liara logo and a generated/local raster empty-state illustration; do not approximate visible assets with CSS art, inline SVG, emoji, or text symbols.
- Keep «ایجاد برنامه» as the primary panel action and the assistant as a clearly secondary entry.
- Keep routes RTL, keyboard navigable, responsive, and target WCAG AA contrast without claiming full WCAG compliance from screenshots.
- All new behavior follows red-green-refactor and must keep existing tests green.

---

### Task 1: Safe assistant entry context and origin-aware empty state

**Files:**
- Create: `src/modules/demo/assistant-entry-context.ts`
- Create: `src/modules/demo/assistant-entry-context.test.ts`
- Create: `src/components/chat/empty-state.test.tsx`
- Modify: `src/components/chat/empty-state.tsx`
- Modify: `src/components/chat/chat-workspace.tsx`

**Interfaces:**
- Consumes: `ChatWorkspace`'s existing `user: MockUser` and `onLogout: () => void` props.
- Produces: `AssistantEntryContext`, `parseAssistantEntryContext(source)`, and optional `entryContext` support on `ChatWorkspace`.

- [ ] **Step 1: Write failing parser tests**

```ts
import { describe, expect, it } from "vitest";
import { parseAssistantEntryContext } from "./assistant-entry-context";

describe("parseAssistantEntryContext", () => {
  it("maps the panel source to its fixed return route", () => {
    expect(parseAssistantEntryContext("panel")).toEqual({ source: "panel", returnHref: "/panel" });
  });

  it("maps the docs source to its fixed return route", () => {
    expect(parseAssistantEntryContext("docs")).toEqual({ source: "docs", returnHref: "/docs" });
  });

  it.each([undefined, null, "", "https://evil.example", "panel<script>"])(
    "falls back safely for %s",
    (source) => {
      expect(parseAssistantEntryContext(source)).toEqual({ source: "direct", returnHref: "/" });
    },
  );
});
```

- [ ] **Step 2: Run the parser test and verify red**

Run: `npx vitest run src/modules/demo/assistant-entry-context.test.ts`

Expected: FAIL because `assistant-entry-context.ts` does not exist.

- [ ] **Step 3: Implement the pure entry contract**

```ts
export type AssistantEntryContext =
  | { source: "panel"; returnHref: "/panel" }
  | { source: "docs"; returnHref: "/docs" }
  | { source: "direct"; returnHref: "/" };

export function parseAssistantEntryContext(source: string | null | undefined): AssistantEntryContext {
  if (source === "panel") return { source: "panel", returnHref: "/panel" };
  if (source === "docs") return { source: "docs", returnHref: "/docs" };
  return { source: "direct", returnHref: "/" };
}
```

- [ ] **Step 4: Run parser tests and verify green**

Run: `npx vitest run src/modules/demo/assistant-entry-context.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing empty-state rendering tests**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "./empty-state";

describe("EmptyState entry variants", () => {
  it("welcomes a user arriving from the empty panel", () => {
    render(<EmptyState entryContext={{ source: "panel", returnHref: "/panel" }} onPrompt={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "برای شروع روی لیارا چه کمکی می‌خواهی؟" })).toBeVisible();
    expect(screen.getByRole("link", { name: "بازگشت به پیشخوان" })).toHaveAttribute("href", "/panel");
    expect(screen.getByText("ورود از پیشخوان لیارا")).toBeVisible();
  });

  it("welcomes a user arriving from docs without sending anything", () => {
    const onPrompt = vi.fn();
    render(<EmptyState entryContext={{ source: "docs", returnHref: "/docs" }} onPrompt={onPrompt} />);
    expect(screen.getByRole("heading", { name: "در مستندات دنبال چه چیزی هستی؟" })).toBeVisible();
    expect(screen.getByRole("link", { name: "بازگشت به مستندات" })).toHaveAttribute("href", "/docs");
    expect(onPrompt).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the empty-state test and verify red**

Run: `npx vitest run src/components/chat/empty-state.test.tsx`

Expected: FAIL because `EmptyState` does not accept `entryContext` and does not render origin-aware copy.

- [ ] **Step 7: Implement entry-aware content without duplicating chat behavior**

Add a typed content map in `empty-state.tsx` and keep the existing direct prompts as the default:

```tsx
interface EmptyStateProps {
  entryContext?: AssistantEntryContext;
  onPrompt: (prompt: string) => void;
}

const entryVariants = {
  panel: {
    eyebrow: "ورود از پیشخوان لیارا",
    title: "برای شروع روی لیارا چه کمکی می‌خواهی؟",
    description: "برای انتخاب سرویس، آماده‌سازی پروژه و اولین استقرار از مستندات رسمی راهنمایی بگیر.",
    returnLabel: "بازگشت به پیشخوان",
    prompts: panelPrompts,
  },
  docs: {
    eyebrow: "ورود از مستندات لیارا",
    title: "در مستندات دنبال چه چیزی هستی؟",
    description: "سؤالت را با زبان خودت بپرس تا صفحه مرتبط و قدم بعدی روشن شود.",
    returnLabel: "بازگشت به مستندات",
    prompts: docsPrompts,
  },
  direct: directVariant,
} as const;
```

Render the eyebrow and return `Link` only for `panel` and `docs`. Preserve the current prompt-button behavior: only `onPrompt(prompt.prompt)` sends text.

Add `entryContext?: AssistantEntryContext` to `ChatWorkspaceProps` and pass it to `EmptyState`. Do not add it to `consumeChatStream` or the chat API payload.

- [ ] **Step 8: Run focused chat tests and verify green**

Run: `npx vitest run src/modules/demo/assistant-entry-context.test.ts src/components/chat/empty-state.test.tsx src/components/chat/assistant-message.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```powershell
git add -- src/modules/demo/assistant-entry-context.ts src/modules/demo/assistant-entry-context.test.ts src/components/chat/empty-state.tsx src/components/chat/empty-state.test.tsx src/components/chat/chat-workspace.tsx
git commit -m "feat: add origin-aware assistant entry state"
```

---

### Task 2: Demo assistant route and universal navigation semantics

**Files:**
- Create: `src/components/demo/demo-assistant-gate.tsx`
- Create: `src/app/assistant/page.tsx`
- Modify: `src/components/chat/conversation-sidebar.tsx`
- Modify: `src/components/chat/chat-workspace.tsx`
- Modify: `src/components/auth/auth-screen.tsx`
- Modify: `src/components/auth/mock-auth-gate.tsx`
- Modify: `src/app/layout.tsx`
- Test: `tests/e2e/entry-flow.spec.ts`

**Interfaces:**
- Consumes: `parseAssistantEntryContext(source)` and `ChatWorkspace({ user, onLogout, entryContext, accountActionLabel })` from Task 1.
- Produces: a working `/assistant?source=panel|docs` route that skips standalone auth and safely returns to its fixed origin.

- [ ] **Step 1: Read the installed Next.js 16 routing guides before writing route code**

Read completely:

```text
node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md
node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md
node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md
```

Use the current documented `searchParams` page prop shape; do not rely on older Next.js conventions.

- [ ] **Step 2: Write the failing assistant-route E2E cases**

```ts
import { expect, test } from "@playwright/test";

test("opens the panel-aware assistant without a login wall", async ({ page }) => {
  await page.goto("/assistant?source=panel");
  await expect(page.getByRole("heading", { name: "برای شروع روی لیارا چه کمکی می‌خواهی؟" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /ورود|ثبت‌نام/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "بازگشت به پیشخوان" })).toHaveAttribute("href", "/panel");
});

test("falls back safely for an unknown assistant source", async ({ page }) => {
  await page.goto("/assistant?source=https://evil.example");
  await expect(page.getByRole("heading", { name: "چه مشکلی در لیارا داری؟" })).toBeVisible();
  await expect(page.getByText("evil.example")).toHaveCount(0);
});
```

- [ ] **Step 3: Run E2E and verify red**

Run: `npx playwright test tests/e2e/entry-flow.spec.ts --project=desktop`

Expected: FAIL with 404 for `/assistant`.

- [ ] **Step 4: Implement the demo gate and route**

Use a deterministic, non-personal demo user and a fixed storage namespace:

```tsx
"use client";

const demoUser: MockUser = {
  id: "liara-entry-demo-v1",
  name: "کاربر لیارا",
  email: "demo@liara.local",
  createdAt: "2026-08-21T00:00:00.000Z",
};

export function DemoAssistantGate({ source }: { source?: string }) {
  const router = useRouter();
  const entryContext = parseAssistantEntryContext(source);
  return (
    <ChatWorkspace
      user={demoUser}
      entryContext={entryContext}
      accountActionLabel="بازگشت به مبدأ"
      onLogout={() => router.push(entryContext.returnHref)}
    />
  );
}
```

The server page awaits the documented Next.js 16 `searchParams` promise and passes only `source` to the client gate.

```tsx
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string | string[] }>;
}) {
  const params = await searchParams;
  const source = typeof params.source === "string" ? params.source : undefined;
  return <DemoAssistantGate source={source} />;
}
```

- [ ] **Step 5: Make the account action and skip link route-neutral**

Add `accountActionLabel?: string` to `ChatWorkspace` and `ConversationSidebar`, defaulting to «خروج از حساب» so `/` is unchanged. Use the label for visible text, `aria-label`, and `title`.

Change the root skip link target to `#main-content` and text to «رفتن به محتوای اصلی». Rename the `ChatWorkspace` conversation section id from `conversation-main` to `main-content`. Add `id="main-content"` to the loaded and loading auth `<main>` elements, and use the same id on all new page `<main>` elements.

- [ ] **Step 6: Run focused tests and verify green**

Run: `npx playwright test tests/e2e/entry-flow.spec.ts --project=desktop`

Expected: PASS for assistant route cases.

Run: `npx vitest run src/components/chat/empty-state.test.tsx src/components/chat/assistant-message.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- src/components/demo/demo-assistant-gate.tsx src/app/assistant/page.tsx src/components/chat/conversation-sidebar.tsx src/components/chat/chat-workspace.tsx src/components/auth/auth-screen.tsx src/components/auth/mock-auth-gate.tsx src/app/layout.tsx tests/e2e/entry-flow.spec.ts
git commit -m "feat: add context-aware demo assistant route"
```

---

### Task 3: Faithful empty Liara panel entry surface

**Files:**
- Create: `public/demo/panel-empty-state.png`
- Create: `src/components/demo/panel-dashboard.tsx`
- Create: `src/components/demo/panel-dashboard.test.tsx`
- Create: `src/app/panel/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/e2e/entry-flow.spec.ts`

**Interfaces:**
- Consumes: `/assistant?source=panel`, `/docs`, local `/brand/liara-logo.svg`, and the supplied dashboard screenshot.
- Produces: a responsive `/panel` surface with two working assistant entry links and a preserved primary «ایجاد برنامه» action.

- [ ] **Step 1: Create the raster empty-state illustration**

Use the image generation workflow with the supplied screenshot as visual reference. Generate a transparent or dark-background raster asset sized for a 360×280 CSS slot: three compact dark service cards with Liara-cyan cube marks, muted text bars, and two thin curved cyan/green connector lines. Do not include readable text, logos, people, account data, gradients, or extra decoration. Save the accepted output as `public/demo/panel-empty-state.png` and inspect it before use.

- [ ] **Step 2: Write failing panel component tests**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PanelDashboard } from "./panel-dashboard";

describe("PanelDashboard", () => {
  it("keeps service creation primary and offers assistant help secondarily", () => {
    render(<PanelDashboard />);
    expect(screen.getByRole("button", { name: "ایجاد برنامه" })).toBeVisible();
    expect(screen.getByRole("link", { name: "برای شروع از دستیار راهنمایی بگیر" }))
      .toHaveAttribute("href", "/assistant?source=panel");
  });

  it("explains the mock boundary when service creation is selected", () => {
    render(<PanelDashboard />);
    fireEvent.click(screen.getByRole("button", { name: "ایجاد برنامه" }));
    expect(screen.getByRole("status")).toHaveTextContent("ساخت سرویس در این نمونه فعال نیست.");
  });

  it("links the mock panel to docs and the permanent assistant entry", () => {
    render(<PanelDashboard />);
    expect(screen.getByRole("link", { name: "مستندات" })).toHaveAttribute("href", "/docs");
    expect(screen.getByRole("link", { name: "دستیار" })).toHaveAttribute("href", "/assistant?source=panel");
  });
});
```

- [ ] **Step 3: Run panel tests and verify red**

Run: `npx vitest run src/components/demo/panel-dashboard.test.tsx`

Expected: FAIL because `PanelDashboard` does not exist.

- [ ] **Step 4: Implement the panel structure with semantic links**

Create focused arrays for top links and products. Make the component a client component and reveal the demo boundary through an accessible status message when the primary button is pressed:

```tsx
export function PanelDashboard() {
  const [noticeVisible, setNoticeVisible] = useState(false);
  return (
    <div className="panel-demo-shell" data-theme="panel-dark">
      <header className="panel-demo-header">...</header>
      <nav className="panel-product-nav" aria-label="محصولات لیارا">...</nav>
      <main id="main-content" className="panel-empty-main">
        <img src="/demo/panel-empty-state.png" alt="" width={360} height={280} />
        <h1>شما تا الان هیچ برنامه‌ای ایجاد نکرده‌اید.</h1>
        <p>با کلیک روی دکمهٔ ایجاد برنامه، یک برنامهٔ جدید بسازید.</p>
        <button type="button" onClick={() => setNoticeVisible(true)}>ایجاد برنامه</button>
        {noticeVisible && <span role="status">ساخت سرویس در این نمونه فعال نیست.</span>}
        <Link href="/assistant?source=panel">برای شروع از دستیار راهنمایی بگیر</Link>
      </main>
    </div>
  );
}
```

Use sanitized copy such as «تیم نمونه» and «۵٬۰۰۰٬۰۰۰ تومان اعتبار نمایشی». Put «دستیار» near «راهنما» and «پشتیبانی». Use Lucide icons and the local Liara logo; all visible navigation that appears active must have a real route or official URL.

- [ ] **Step 5: Add scoped responsive panel styles**

Add `.panel-demo-*` classes to `globals.css` with values measured from the screenshot: dark surfaces, two 80–96px navigation bands on desktop, centered empty state, cyan/green accent, clear secondary CTA, and visible focus rings. At `max-width: 840px`, allow horizontal product-nav scrolling and collapse nonessential top links without hiding the assistant, docs, or account controls.

- [ ] **Step 6: Run panel component tests and verify green**

Run: `npx vitest run src/components/demo/panel-dashboard.test.tsx`

Expected: PASS.

- [ ] **Step 7: Add and run panel E2E navigation**

Append:

```ts
test("moves from the empty panel into the panel-aware assistant", async ({ page }) => {
  await page.goto("/panel");
  await expect(page.getByRole("heading", { name: "شما تا الان هیچ برنامه‌ای ایجاد نکرده‌اید." })).toBeVisible();
  await page.getByRole("link", { name: "برای شروع از دستیار راهنمایی بگیر" }).click();
  await expect(page).toHaveURL(/\/assistant\?source=panel$/);
  await expect(page.getByRole("heading", { name: "برای شروع روی لیارا چه کمکی می‌خواهی؟" })).toBeVisible();
});
```

Run: `npx playwright test tests/e2e/entry-flow.spec.ts --project=desktop`

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```powershell
git add -- public/demo/panel-empty-state.png src/components/demo/panel-dashboard.tsx src/components/demo/panel-dashboard.test.tsx src/app/panel/page.tsx src/app/globals.css tests/e2e/entry-flow.spec.ts
git commit -m "feat: add empty Liara panel entry surface"
```

---

### Task 4: Liara documentation preview and docs-to-agent handoff

**Files:**
- Create: `src/components/demo/docs-preview.tsx`
- Create: `src/components/demo/docs-preview.test.tsx`
- Create: `src/app/docs/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/e2e/entry-flow.spec.ts`

**Interfaces:**
- Consumes: `/assistant?source=docs`, `/panel`, local logo, Lucide icons, and official `https://docs.liara.ir/` destinations.
- Produces: a responsive `/docs` surface with a working global assistant CTA, usable navigation, and honest search handoff.

- [ ] **Step 1: Write failing documentation preview tests**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocsPreview } from "./docs-preview";

describe("DocsPreview", () => {
  it("offers assistant and panel entry routes", () => {
    render(<DocsPreview />);
    expect(screen.getByRole("link", { name: "از دستیار بپرس" }))
      .toHaveAttribute("href", "/assistant?source=docs");
    expect(screen.getByRole("link", { name: "ورود به پنل کاربری" })).toHaveAttribute("href", "/panel");
  });

  it("keeps official content links external and named", () => {
    render(<DocsPreview />);
    expect(screen.getByRole("link", { name: "شروع به کار با NextJS" }))
      .toHaveAttribute("href", "https://docs.liara.ir/paas/nextjs/getting-started/");
  });
});
```

- [ ] **Step 2: Run docs tests and verify red**

Run: `npx vitest run src/components/demo/docs-preview.test.tsx`

Expected: FAIL because `DocsPreview` does not exist.

- [ ] **Step 3: Implement the documentation preview**

Create semantic `aside`, `header`, `nav`, and `main` regions. Use compact arrays for sidebar sections, quick starts, and products. The header must include:

```tsx
<label className="docs-search">
  <Search aria-hidden="true" />
  <input aria-label="جستجو در مستندات" placeholder="جستجو کنید" />
</label>
<Link className="docs-agent-link" href="/assistant?source=docs">از دستیار بپرس</Link>
<Link className="docs-panel-link" href="/panel">ورود به پنل کاربری</Link>
```

Render a persistent note under the search input: «برای جستجوی کامل، مستندات رسمی را باز کنید» linking to `https://docs.liara.ir/`. Do not render fake search results.

- [ ] **Step 4: Add scoped documentation styles**

Add `.docs-demo-*` classes to `globals.css`: white content, fixed-width RTL sidebar on desktop, sticky top search bar, neutral borders, Liara cyan accents, readable content width, and 44px targets. At `max-width: 840px`, replace the sidebar with a `<details>` navigation drawer and stack the header controls without horizontal overflow.

- [ ] **Step 5: Run docs component tests and verify green**

Run: `npx vitest run src/components/demo/docs-preview.test.tsx`

Expected: PASS.

- [ ] **Step 6: Add and run docs E2E navigation**

Append:

```ts
test("moves from docs into the docs-aware assistant without auto-sending", async ({ page }) => {
  await page.goto("/docs");
  await page.getByRole("link", { name: "از دستیار بپرس" }).click();
  await expect(page).toHaveURL(/\/assistant\?source=docs$/);
  await expect(page.getByRole("heading", { name: "در مستندات دنبال چه چیزی هستی؟" })).toBeVisible();
  await expect(page.locator(".user-bubble")).toHaveCount(0);
  await page.getByRole("link", { name: "بازگشت به مستندات" }).click();
  await expect(page).toHaveURL(/\/docs$/);
});
```

Run: `npx playwright test tests/e2e/entry-flow.spec.ts --project=desktop`

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- src/components/demo/docs-preview.tsx src/components/demo/docs-preview.test.tsx src/app/docs/page.tsx src/app/globals.css tests/e2e/entry-flow.spec.ts
git commit -m "feat: add docs entry surface for the assistant"
```

---

### Task 5: Responsive QA, regression coverage, and visual verification

**Files:**
- Modify: `src/app/globals.css`
- Modify: `tests/e2e/entry-flow.spec.ts`
- Modify only if a confirmed regression requires it: files changed in Tasks 1–4

**Interfaces:**
- Consumes: all routes and components from Tasks 1–4.
- Produces: verified desktop, tablet, and mobile demo flow with no regressions in the standalone assistant.

- [ ] **Step 1: Add mobile overflow and landmark assertions**

```ts
test("keeps demo surfaces usable without horizontal page overflow", async ({ page }) => {
  for (const route of ["/panel", "/docs", "/assistant?source=panel"]) {
    await page.goto(route);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.locator("#main-content")).toBeVisible();
  }
});
```

- [ ] **Step 2: Run entry-flow E2E in all configured viewports and verify red or green**

Run: `npx playwright test tests/e2e/entry-flow.spec.ts`

Expected: PASS; if a viewport fails, the failure identifies the exact route and target before CSS is changed.

- [ ] **Step 3: Fix only confirmed responsive or semantic regressions**

Adjust scoped `.panel-demo-*`, `.docs-demo-*`, or existing entry-state classes based on the failing assertion or rendered screenshot. Do not redesign unrelated chat UI.

- [ ] **Step 4: Run the complete fast verification suite**

Run: `npm run lint`

Expected: exit 0.

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm test`

Expected: all Vitest tests pass.

- [ ] **Step 5: Build and run targeted E2E regression**

Run: `npm run build`

Expected: Next.js build succeeds and standalone output preparation completes.

Run: `npx playwright test tests/e2e/entry-flow.spec.ts tests/e2e/chat.spec.ts --project=desktop --project=mobile`

Expected: all selected desktop and mobile tests pass.

- [ ] **Step 6: Visually compare the implemented panel to the supplied reference**

Start the verified app, capture `/panel` at the same 1847×917 viewport as the supplied screenshot, and create a side-by-side comparison containing the reference and implementation. Inspect header heights, two-row navigation, centered empty state, font scale, borders, icon alignment, CTA hierarchy, and background values. Fix visible mismatches and compare once more.

- [ ] **Step 7: Visually inspect docs and assistant handoffs**

Capture `/docs`, `/assistant?source=panel`, and `/assistant?source=docs` at desktop and mobile sizes. Confirm no crop, overflow, unreadable text, hidden CTA, wrong origin label, or broken return link remains.

- [ ] **Step 8: Commit verified polish**

```powershell
git add -- src/app/globals.css tests/e2e/entry-flow.spec.ts
git commit -m "test: verify responsive agent entry flow"
```

If Step 3 required another scoped source file, add only that exact file to this commit.

---

## Final Completion Checklist

- [ ] `/` still provides the standalone mock-auth assistant.
- [ ] `/panel` matches the supplied empty-dashboard structure without personal data.
- [ ] `/docs` matches the official documentation information architecture without importing its older runtime.
- [ ] Both entry surfaces reach one `/assistant` experience with correct origin copy.
- [ ] Opening the assistant never auto-sends a message.
- [ ] Unknown query values do not appear in the UI or model request.
- [ ] Return controls route back to the correct origin.
- [ ] Desktop and mobile entry-flow E2E tests pass.
- [ ] Lint, typecheck, unit tests, build, and targeted chat regressions pass.
