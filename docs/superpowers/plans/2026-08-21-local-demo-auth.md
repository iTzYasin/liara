# Local Demo Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-only mock login and registration gate, isolate local conversations per mock account, expose the active user in the sidebar, and replace the composer prompt with «از دستیار لیارا بپرس…».

**Architecture:** A focused `mock-auth-store` owns browser-only accounts and sessions, while a `MockAuthGate` chooses between the auth surface and the existing chat workspace. The chat stack receives a validated `MockUser` and uses that user ID to select an isolated IndexedDB conversation store; no server route or database is added.

**Tech Stack:** Next.js 16.3.1 App Router, React 19 Client Components, TypeScript, Web Crypto PBKDF2-SHA-256, localStorage, IndexedDB, Vitest, Testing Library, Playwright, existing shadcn primitives and global design tokens.

**Spec:** `docs/superpowers/specs/2026-08-21-local-demo-auth-design.md`

## Global Constraints

- This is a browser-only demo account system; add no auth API, PostgreSQL, server database, email flow, OAuth, or Liara account integration.
- Never store the raw password; derive a digest with a random salt and PBKDF2-SHA-256.
- Warn users not to enter a real password and do not claim real security or cross-device sync.
- Default unauthenticated screen is login, with a clear switch to registration.
- Normalize email with `trim().toLowerCase()` and require a unique normalized email.
- Require a non-empty trimmed name, a structurally valid email, and a password of at least 8 characters with matching confirmation.
- Invalid login copy is exactly «ایمیل یا رمز درست نیست.».
- Existing anonymous conversations remain untouched and are not migrated.
- The composer placeholder is exactly «از دستیار لیارا بپرس…».
- Maintain RTL, keyboard focus, screen-reader labels, 44px primary targets, responsive mobile layout, and reduced-motion behavior.
- Read the relevant local Next.js 16 guides under `node_modules/next/dist/docs/` before production code changes.

## File Responsibility Map

- Create `src/modules/auth/mock-auth-store.ts`: mock user types, versioned storage keys, PBKDF2 derivation, registration, login, session read/write/logout, and typed errors.
- Create `src/modules/auth/mock-auth-store.test.ts`: account, password-storage, login, and corrupt-session unit coverage.
- Create `src/components/auth/auth-screen.tsx`: controlled login/register UI and accessible validation/error copy.
- Create `src/components/auth/mock-auth-gate.tsx`: hydrate browser session and render either `AuthScreen` or `ChatWorkspace`.
- Create `tests/e2e/auth.spec.ts`: unauthenticated, registration, refresh, logout/login, placeholder, responsive, and account-isolation flows.
- Modify `src/app/page.tsx`: render `MockAuthGate` instead of `ChatWorkspace`.
- Modify `src/modules/conversations/conversation-store.ts`: key cached and IndexedDB stores by validated owner ID.
- Modify `src/modules/conversations/conversation-store.test.ts`: verify owner-store isolation.
- Modify `src/components/chat/chat-workspace.tsx`: consume `user` and `onLogout`, select the owner store, abort on unmount, and pass account UI props.
- Modify `src/components/chat/conversation-sidebar.tsx`: replace the local-storage notice with the account summary and logout action.
- Modify `src/components/chat/chat-composer.tsx`: change the composer placeholder.
- Modify `src/app/globals.css`: add the auth surface and account-footer styling using existing tokens.
- Modify `tests/e2e/chat.spec.ts`: seed a valid mock account/session before existing chat scenarios.

---

### Task 1: Browser-only account and session store

**Files:**
- Create: `src/modules/auth/mock-auth-store.ts`
- Create: `src/modules/auth/mock-auth-store.test.ts`

**Interfaces:**
- Produces: `MockUser`, `RegisterMockUserInput`, `MockAuthErrorCode`, `MockAuthError`, `MOCK_AUTH_USERS_KEY`, `MOCK_AUTH_SESSION_KEY`, `MockAuthStore`, and `createBrowserMockAuthStore()`.
- `MockAuthStore.register(input: RegisterMockUserInput): Promise<MockUser>` registers and activates a user.
- `MockAuthStore.login(email: string, password: string): Promise<MockUser>` verifies and activates a user.
- `MockAuthStore.currentUser(): MockUser | undefined` validates the stored session against registered users.
- `MockAuthStore.logout(): void` removes only the active session.

- [ ] **Step 1: Write failing unit tests for registration and password storage**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  MOCK_AUTH_SESSION_KEY,
  MOCK_AUTH_USERS_KEY,
  MockAuthError,
  MockAuthStore,
} from "@/modules/auth/mock-auth-store";

describe("MockAuthStore", () => {
  let store: MockAuthStore;

  beforeEach(() => {
    localStorage.clear();
    store = new MockAuthStore(localStorage);
  });

  it("registers a normalized local account without storing the raw password", async () => {
    const user = await store.register({ name: "  سارا احمدی  ", email: " SARA@Example.COM ", password: "demo-pass-123" });
    expect(user).toMatchObject({ name: "سارا احمدی", email: "sara@example.com" });
    expect(localStorage.getItem(MOCK_AUTH_USERS_KEY)).not.toContain("demo-pass-123");
    expect(localStorage.getItem(MOCK_AUTH_SESSION_KEY)).toBe(user.id);
  });

  it("rejects a duplicate normalized email", async () => {
    await store.register({ name: "سارا", email: "sara@example.com", password: "demo-pass-123" });
    await expect(store.register({ name: "سارا دوم", email: " SARA@example.com ", password: "another-pass" }))
      .rejects.toMatchObject<Partial<MockAuthError>>({ code: "email-exists" });
  });
});
```

- [ ] **Step 2: Run the registration tests and verify RED**

Run: `npx vitest run src/modules/auth/mock-auth-store.test.ts`

Expected: FAIL because `@/modules/auth/mock-auth-store` does not exist.

- [ ] **Step 3: Implement versioned storage, normalized users, and PBKDF2 password derivation**

Implement these exact public shapes in `mock-auth-store.ts`:

```ts
export const MOCK_AUTH_USERS_KEY = "liara-mock-users-v1";
export const MOCK_AUTH_SESSION_KEY = "liara-mock-session-v1";

export interface MockUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface RegisterMockUserInput {
  name: string;
  email: string;
  password: string;
}

export type MockAuthErrorCode =
  | "email-exists"
  | "invalid-credentials"
  | "invalid-storage"
  | "crypto-unavailable";

export class MockAuthError extends Error {
  constructor(public readonly code: MockAuthErrorCode, message: string) {
    super(message);
    this.name = "MockAuthError";
  }
}
```

Store internal users as `{ ...MockUser, passwordSalt: string, passwordDigest: string }`. Registration creates `id` with `crypto.randomUUID()` and `createdAt` with `new Date().toISOString()`. Generate 16 random salt bytes, import the UTF-8 password as PBKDF2 key material, and derive 256 bits with `{ name: "PBKDF2", hash: "SHA-256", iterations: 100_000, salt }`. Encode salt and digest as base64. Parse storage with structural guards; malformed JSON returns no users and raises `invalid-storage` on mutating operations rather than crashing.

- [ ] **Step 4: Run registration tests and verify GREEN**

Run: `npx vitest run src/modules/auth/mock-auth-store.test.ts`

Expected: both registration tests PASS.

- [ ] **Step 5: Add failing login, logout, and corrupt-session tests**

```ts
it("logs in with the registered credentials and rejects a wrong password", async () => {
  const registered = await store.register({ name: "سارا", email: "sara@example.com", password: "demo-pass-123" });
  store.logout();
  await expect(store.login(" SARA@example.com ", "wrong-pass")).rejects.toMatchObject({ code: "invalid-credentials" });
  await expect(store.login("sara@example.com", "demo-pass-123")).resolves.toEqual(registered);
  expect(store.currentUser()).toEqual(registered);
});

it("clears a session that references a missing account", () => {
  localStorage.setItem(MOCK_AUTH_SESSION_KEY, "missing-user");
  expect(store.currentUser()).toBeUndefined();
  expect(localStorage.getItem(MOCK_AUTH_SESSION_KEY)).toBeNull();
});
```

- [ ] **Step 6: Run login tests and verify RED**

Run: `npx vitest run src/modules/auth/mock-auth-store.test.ts`

Expected: FAIL because `login`, `logout`, or validated `currentUser` behavior is incomplete.

- [ ] **Step 7: Implement login, validated session hydration, logout, and browser factory**

`login` must always throw `new MockAuthError("invalid-credentials", "ایمیل یا رمز درست نیست.")` for unknown email and wrong password. `currentUser` must expose no digest/salt fields. Export:

```ts
export function createBrowserMockAuthStore() {
  return new MockAuthStore(window.localStorage);
}
```

- [ ] **Step 8: Run the complete auth-store unit suite**

Run: `npx vitest run src/modules/auth/mock-auth-store.test.ts`

Expected: all tests PASS and the raw password assertion remains green.

- [ ] **Step 9: Commit the isolated auth store**

```bash
git add src/modules/auth/mock-auth-store.ts src/modules/auth/mock-auth-store.test.ts
git commit -m "feat: add browser-only mock auth store"
```

### Task 2: User-scoped conversation storage

**Files:**
- Modify: `src/modules/conversations/conversation-store.ts`
- Modify: `src/modules/conversations/conversation-store.test.ts`

**Interfaces:**
- Consumes: `MockUser.id`, always a UUID created by Task 1.
- Produces: `getConversationStore(ownerId?: string): ConversationStore`; calls with an owner are isolated, while the temporary no-argument compatibility path continues to open the untouched legacy database until the workspace is upgraded in Task 4.
- Internal `IndexedDbConversationStore` constructor becomes `constructor(ownerId: string)` and opens `liara-assistant-user-${ownerId}`.

- [ ] **Step 1: Write the failing owner-isolation test**

```ts
import { getConversationStore } from "@/modules/conversations/conversation-store";

it("isolates conversations between local account owners", async () => {
  const saraStore = getConversationStore("11111111-1111-4111-8111-111111111111");
  const aliStore = getConversationStore("22222222-2222-4222-8222-222222222222");
  await saraStore.save({ id: "sara-chat", title: "سارا", createdAt: "1", updatedAt: "1", messages: [] });
  expect(await saraStore.get("sara-chat")).toBeDefined();
  expect(await aliStore.get("sara-chat")).toBeUndefined();
});
```

- [ ] **Step 2: Run the conversation-store test and verify RED**

Run: `npx vitest run src/modules/conversations/conversation-store.test.ts`

Expected: FAIL because `getConversationStore` currently accepts no owner and returns one global singleton.

- [ ] **Step 3: Implement owner validation and per-owner store caching**

Replace the single `browserStore` with `const browserStores = new Map<string, ConversationStore>()`. Validate provided owner IDs with `/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`; throw `new Error("Invalid conversation owner")` on invalid input. A provided owner opens `liara-assistant-user-${ownerId}`; an omitted owner keeps using the untouched legacy `liara-assistant` database so this task remains compatible with the current workspace. Do not rename or delete the legacy database.

- [ ] **Step 4: Run conversation-store tests and verify GREEN**

Run: `npx vitest run src/modules/conversations/conversation-store.test.ts`

Expected: all tests PASS and the owner isolation assertion is green.

- [ ] **Step 5: Commit owner-scoped local history**

```bash
git add src/modules/conversations/conversation-store.ts src/modules/conversations/conversation-store.test.ts
git commit -m "feat: isolate conversations by mock account"
```

### Task 3: Authentication screen and application gate

**Files:**
- Create: `src/components/auth/auth-screen.tsx`
- Create: `src/components/auth/mock-auth-gate.tsx`
- Create: `tests/e2e/auth.spec.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `MockAuthStore`, `MockUser`, and `createBrowserMockAuthStore()` from Task 1.
- Produces: `AuthScreen({ store, onAuthenticated })` and `MockAuthGate()`.
- `MockAuthGate` initially renders the existing `<ChatWorkspace />` after successful auth; Task 4 upgrades that boundary to pass `user` and `onLogout` once the workspace accepts them.

- [ ] **Step 1: Read the required local Next.js 16 guides**

Run:

```powershell
Get-Content -Raw node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
Get-Content -Raw node_modules/next/dist/docs/01-app/01-getting-started/11-css.md
Get-Content -Raw node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md
```

Expected: confirm that browser storage and form state stay inside narrowly scoped Client Components and global CSS remains imported by the root layout.

- [ ] **Step 2: Write a failing E2E test for the default login and registration flow**

```ts
import { expect, test } from "@playwright/test";

test("registers a browser-only demo account from the default login screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ورود به دستیار لیارا" })).toBeVisible();
  await page.getByRole("button", { name: "ثبت‌نام کن" }).click();
  await page.getByLabel("نام").fill("سارا احمدی");
  await page.getByLabel("ایمیل").fill("sara@example.com");
  await page.getByLabel("رمز عبور").fill("demo-pass-123");
  await page.getByLabel("تکرار رمز عبور").fill("demo-pass-123");
  await page.getByRole("button", { name: "ساخت حساب نمایشی" }).click();
  await expect(page.getByRole("heading", { name: "چه مشکلی در لیارا داری؟" })).toBeVisible();
});
```

- [ ] **Step 3: Run the auth E2E test and verify RED**

Run against the local development server:

`npx playwright test tests/e2e/auth.spec.ts --project=desktop --grep "registers a browser-only"`

Expected: FAIL because the app still opens chat directly and has no auth UI.

- [ ] **Step 4: Implement the controlled auth form**

`AuthScreen` starts in `"login"` mode. Registration validates name, email, password length, and password confirmation before calling `store.register`. Login calls `store.login`. Map `email-exists` to «این ایمیل قبلاً ثبت شده؛ وارد حساب شو.» and all invalid login failures to «ایمیل یا رمز درست نیست.». Render the persistent notice «این حساب فقط برای نسخه نمایشی و روی همین مرورگر است؛ از رمز واقعی استفاده نکن.».

Use permanent `<label>` elements, `autoComplete="email"`, `autoComplete="current-password"` for login, `autoComplete="new-password"` for registration, `aria-live="polite"` for mode changes, and `role="alert"` for errors. Disable the primary button while the asynchronous digest is being derived.

- [ ] **Step 5: Implement the session gate and page integration**

`MockAuthGate` is a Client Component. Create the store once with `useMemo`, hydrate `currentUser()` inside `useEffect`, and use a three-state union: `loading`, `anonymous`, `authenticated`. During loading render a branded `.auth-loading` region instead of flashing the chat. On authentication render `<ChatWorkspace key={user.id} />`. Keep the authenticated `MockUser` in gate state; Task 4 will pass it into the workspace and add logout after those props exist.

Change `src/app/page.tsx` to keep `await connection()` and render `<MockAuthGate />`.

- [ ] **Step 6: Add focused auth styling**

Add `.auth-shell`, `.auth-card`, `.auth-brand`, `.auth-mode-switch`, `.auth-form`, `.auth-field`, `.auth-submit`, `.auth-demo-note`, `.auth-error`, and `.auth-loading` styles using `--paper`, `--surface-raised`, `--brand`, `--brand-soft`, `--ink`, `--muted`, `--line`, and `--shadow-lg`. The card is `width: min(430px, calc(100% - 28px))`; primary controls have `min-height: 44px`; mobile padding is at least 16px. Use one short fade/translate transition and disable it under the existing reduced-motion query.

- [ ] **Step 7: Run the auth E2E test and verify GREEN**

Run: `npx playwright test tests/e2e/auth.spec.ts --project=desktop --grep "registers a browser-only"`

Expected: PASS from login screen through automatic post-registration entry.

- [ ] **Step 8: Commit the auth gate and screen**

```bash
git add src/components/auth/auth-screen.tsx src/components/auth/mock-auth-gate.tsx src/app/page.tsx src/app/globals.css tests/e2e/auth.spec.ts
git commit -m "feat: gate chat behind local demo login"
```

### Task 4: Account-aware chat chrome and composer copy

**Files:**
- Modify: `src/components/chat/chat-workspace.tsx`
- Modify: `src/components/chat/conversation-sidebar.tsx`
- Modify: `src/components/chat/chat-composer.tsx`
- Modify: `src/components/auth/mock-auth-gate.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `MockUser` from Task 1 and `getConversationStore(ownerId)` from Task 2.
- Changes: `ChatWorkspace({ user, onLogout }: { user: MockUser; onLogout: () => void })`.
- Changes: `ConversationSidebar` receives `user: MockUser` and `onLogout: () => void`.

- [ ] **Step 1: Extend the auth E2E suite with failing account chrome, placeholder, persistence, and logout assertions**

```ts
await expect(page.getByPlaceholder("از دستیار لیارا بپرس…")).toBeVisible();
const sidebar = page.getByRole("complementary", { name: "تاریخچه گفتگوها" });
await expect(sidebar.getByText("sara@example.com", { exact: true })).toBeVisible();
await page.reload();
await expect(page.getByPlaceholder("از دستیار لیارا بپرس…")).toBeVisible();
await sidebar.getByRole("button", { name: "خروج از حساب" }).click();
await expect(page.getByRole("heading", { name: "ورود به دستیار لیارا" })).toBeVisible();
```

Add a second login step with the registered credentials and assert the same account returns to chat.

- [ ] **Step 2: Run the expanded auth E2E test and verify RED**

Run: `npx playwright test tests/e2e/auth.spec.ts --project=desktop`

Expected: FAIL because chat props, account footer, logout, and new placeholder are missing.

- [ ] **Step 3: Make the workspace owner-aware and abort streams on unmount**

Change `ChatWorkspace` to accept `user` and `onLogout`. Replace `getConversationStore()` with `getConversationStore(user.id)`. Pass both account props to `ConversationSidebar`. Update `MockAuthGate` to render `<ChatWorkspace key={user.id} user={user} onLogout={logout} />`, where `logout` calls `store.logout()` and sets the gate state to anonymous. Add:

```ts
useEffect(() => () => abortRef.current?.abort(), []);
```

This prevents an in-flight response from persisting after logout unmounts the workspace.

- [ ] **Step 4: Replace the sidebar notice with account identity and logout**

Render `.sidebar-account` containing `.sidebar-account-avatar` with the first non-space character of `user.name`, `.sidebar-account-copy` with exact name and email, and a button labeled `aria-label="خروج از حساب"` using the existing Lucide `LogOut` icon. Keep the footer compact and keyboard reachable; do not include the removed local-storage notice.

- [ ] **Step 5: Change the composer copy**

Set the textarea placeholder in `chat-composer.tsx` to exactly:

```tsx
placeholder="از دستیار لیارا بپرس…"
```

- [ ] **Step 6: Style the account footer for desktop and mobile**

Add `.sidebar-account`, `.sidebar-account-avatar`, `.sidebar-account-copy`, and `.sidebar-account-logout` styles. Truncate long email/name with `min-width: 0`, `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap`. Give logout a 36px desktop target and the existing 44px mobile target floor.

- [ ] **Step 7: Run the account integration E2E test and verify GREEN**

Run: `npx playwright test tests/e2e/auth.spec.ts --project=desktop --project=mobile`

Expected: registration, placeholder, account footer, refresh, logout, and login PASS on both viewports.

- [ ] **Step 8: Commit the account-aware chat UI**

```bash
git add src/components/chat/chat-workspace.tsx src/components/chat/conversation-sidebar.tsx src/components/chat/chat-composer.tsx src/app/globals.css tests/e2e/auth.spec.ts
git commit -m "feat: show local account in chat workspace"
```

### Task 5: Existing chat coverage, account isolation, and final verification

**Files:**
- Modify: `tests/e2e/chat.spec.ts`
- Modify: `tests/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `MOCK_AUTH_USERS_KEY`, `MOCK_AUTH_SESSION_KEY`, and the stored mock-user schema from Task 1.
- Produces: a deterministic Playwright seed helper for existing chat tests; no production interface changes.

- [ ] **Step 1: Add a deterministic account/session seed before existing chat E2E scenarios**

At the top of `chat.spec.ts`, define a fixed UUID user whose stored shape includes non-secret dummy salt/digest values, then install it before navigation:

```ts
test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ usersKey, sessionKey, user }) => {
    window.localStorage.setItem(usersKey, JSON.stringify([user]));
    window.localStorage.setItem(sessionKey, user.id);
  }, {
    usersKey: "liara-mock-users-v1",
    sessionKey: "liara-mock-session-v1",
    user: {
      id: "33333333-3333-4333-8333-333333333333",
      name: "کاربر تست",
      email: "test@example.com",
      createdAt: "2026-08-21T00:00:00.000Z",
      passwordSalt: "dGVzdC1zYWx0",
      passwordDigest: "dGVzdC1kaWdlc3Q=",
    },
  });
});
```

The existing chat tests never call mock login, so the dummy digest is acceptable and no raw password is stored.

- [ ] **Step 2: Run a representative existing chat test and verify it reaches chat**

Run: `npx playwright test tests/e2e/chat.spec.ts --project=desktop --grep "keeps the new-chat control"`

Expected: PASS without being redirected to login.

- [ ] **Step 3: Add account-history isolation to the auth E2E test**

Register account A, create a conversation, logout, register account B, and assert `.conversation-row` has count 0. Logout, sign back into account A, open history on mobile if necessary, and assert the original conversation title is visible. Use the public UI only; do not mutate IndexedDB directly.

- [ ] **Step 4: Run the isolation E2E test and verify GREEN**

Run: `npx playwright test tests/e2e/auth.spec.ts --project=desktop --grep "isolates local conversation history"`

Expected: PASS with account B empty and account A restored.

- [ ] **Step 5: Run focused static and unit verification**

Run:

```powershell
npx eslint src/modules/auth src/components/auth src/modules/conversations/conversation-store.ts src/components/chat/chat-workspace.tsx src/components/chat/conversation-sidebar.tsx src/components/chat/chat-composer.tsx tests/e2e/auth.spec.ts tests/e2e/chat.spec.ts
npm run typecheck
npx vitest run src/modules/auth/mock-auth-store.test.ts src/modules/conversations/conversation-store.test.ts
```

Expected: zero lint/type errors and all focused unit tests PASS.

- [ ] **Step 6: Run the complete project check**

Run: `npm run check`

Expected: lint, typecheck, and all Vitest suites PASS with only the repository's intentional skip.

- [ ] **Step 7: Run focused responsive E2E verification**

Run:

`npx playwright test tests/e2e/auth.spec.ts --project=desktop --project=mobile`

Expected: all auth and account-isolation scenarios PASS in desktop and mobile projects.

- [ ] **Step 8: Inspect the final diff and whitespace**

Run:

```powershell
git diff --check -- src/modules/auth src/components/auth src/modules/conversations/conversation-store.ts src/modules/conversations/conversation-store.test.ts src/components/chat/chat-workspace.tsx src/components/chat/conversation-sidebar.tsx src/components/chat/chat-composer.tsx src/app/page.tsx src/app/globals.css tests/e2e/auth.spec.ts tests/e2e/chat.spec.ts
git status --short
```

Expected: no whitespace errors; unrelated pre-existing worktree changes remain untouched.

- [ ] **Step 9: Commit final test integration**

```bash
git add tests/e2e/chat.spec.ts tests/e2e/auth.spec.ts
git commit -m "test: cover local demo account flows"
```
