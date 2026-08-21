import { beforeEach, describe, expect, it } from "vitest";
import {
  MOCK_AUTH_SESSION_KEY,
  MOCK_AUTH_USERS_KEY,
  MockAuthStore,
} from "@/modules/auth/mock-auth-store";

describe("MockAuthStore", () => {
  let store: MockAuthStore;

  beforeEach(() => {
    localStorage.clear();
    store = new MockAuthStore(localStorage);
  });

  it("registers a normalized local account without storing the raw password", async () => {
    const user = await store.register({
      name: "  سارا احمدی  ",
      email: " SARA@Example.COM ",
      password: "demo-pass-123",
    });

    expect(user).toMatchObject({ name: "سارا احمدی", email: "sara@example.com" });
    expect(localStorage.getItem(MOCK_AUTH_USERS_KEY)).not.toContain("demo-pass-123");
    expect(localStorage.getItem(MOCK_AUTH_SESSION_KEY)).toBe(user.id);
  });

  it("rejects a duplicate normalized email", async () => {
    await store.register({
      name: "سارا",
      email: "sara@example.com",
      password: "demo-pass-123",
    });

    await expect(store.register({
      name: "سارا دوم",
      email: " SARA@example.com ",
      password: "another-pass",
    })).rejects.toMatchObject({ code: "email-exists" });
  });

  it("logs in with registered credentials and rejects a wrong password", async () => {
    const registered = await store.register({
      name: "سارا",
      email: "sara@example.com",
      password: "demo-pass-123",
    });
    store.logout();

    await expect(store.login(" SARA@example.com ", "wrong-pass"))
      .rejects.toMatchObject({ code: "invalid-credentials" });
    await expect(store.login("sara@example.com", "demo-pass-123"))
      .resolves.toEqual(registered);
    expect(store.currentUser()).toEqual(registered);
  });

  it("clears a session that references a missing account", () => {
    localStorage.setItem(MOCK_AUTH_SESSION_KEY, "missing-user");

    expect(store.currentUser()).toBeUndefined();
    expect(localStorage.getItem(MOCK_AUTH_SESSION_KEY)).toBeNull();
  });
});
