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

interface StoredMockUser extends MockUser {
  passwordSalt: string;
  passwordDigest: string;
}

const encoder = new TextEncoder();
const mockUserIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function toPublicUser(user: StoredMockUser): MockUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function isStoredMockUser(value: unknown): value is StoredMockUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return typeof user.id === "string"
    && mockUserIdPattern.test(user.id)
    && ["name", "email", "createdAt", "passwordSalt", "passwordDigest"]
    .every((key) => typeof user[key] === "string" && user[key].length > 0);
}

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function derivePassword(password: string, salt: Uint8Array<ArrayBuffer>) {
  if (!globalThis.crypto?.subtle) {
    throw new MockAuthError("crypto-unavailable", "امکان ساخت حساب نمایشی در این مرورگر وجود ندارد.");
  }
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", iterations: 100_000, salt },
    keyMaterial,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

export class MockAuthStore {
  constructor(private readonly storage: Storage) {}

  private readUsers(strict: boolean) {
    const raw = this.storage.getItem(MOCK_AUTH_USERS_KEY);
    if (!raw) return [];
    try {
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value) || !value.every(isStoredMockUser)) throw new Error("invalid mock users");
      return value;
    } catch {
      if (strict) {
        throw new MockAuthError("invalid-storage", "داده حساب‌های نمایشی قابل خواندن نیست.");
      }
      return [];
    }
  }

  private writeUsers(users: StoredMockUser[]) {
    try {
      this.storage.setItem(MOCK_AUTH_USERS_KEY, JSON.stringify(users));
    } catch {
      throw new MockAuthError("invalid-storage", "ذخیره حساب نمایشی در این مرورگر ممکن نیست.");
    }
  }

  private writeSession(userId: string) {
    try {
      this.storage.setItem(MOCK_AUTH_SESSION_KEY, userId);
    } catch {
      throw new MockAuthError("invalid-storage", "ذخیره نشست نمایشی در این مرورگر ممکن نیست.");
    }
  }

  async register(input: RegisterMockUserInput): Promise<MockUser> {
    const users = this.readUsers(true);
    const email = normalizeEmail(input.email);
    if (users.some((user) => user.email === email)) {
      throw new MockAuthError("email-exists", "این ایمیل قبلاً ثبت شده؛ وارد حساب شو.");
    }
    if (!globalThis.crypto?.randomUUID || !globalThis.crypto?.getRandomValues) {
      throw new MockAuthError("crypto-unavailable", "امکان ساخت حساب نمایشی در این مرورگر وجود ندارد.");
    }
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const user: StoredMockUser = {
      id: globalThis.crypto.randomUUID(),
      name: input.name.trim(),
      email,
      createdAt: new Date().toISOString(),
      passwordSalt: toBase64(salt),
      passwordDigest: await derivePassword(input.password, salt),
    };
    this.writeUsers([...users, user]);
    this.writeSession(user.id);
    return toPublicUser(user);
  }

  async login(email: string, password: string): Promise<MockUser> {
    const user = this.readUsers(true).find((item) => item.email === normalizeEmail(email));
    if (!user) {
      throw new MockAuthError("invalid-credentials", "ایمیل یا رمز درست نیست.");
    }
    const digest = await derivePassword(password, fromBase64(user.passwordSalt));
    if (digest !== user.passwordDigest) {
      throw new MockAuthError("invalid-credentials", "ایمیل یا رمز درست نیست.");
    }
    this.writeSession(user.id);
    return toPublicUser(user);
  }

  currentUser(): MockUser | undefined {
    const userId = this.storage.getItem(MOCK_AUTH_SESSION_KEY);
    if (!userId) return undefined;
    const user = this.readUsers(false).find((item) => item.id === userId);
    if (!user) {
      this.storage.removeItem(MOCK_AUTH_SESSION_KEY);
      return undefined;
    }
    return toPublicUser(user);
  }

  logout() {
    this.storage.removeItem(MOCK_AUTH_SESSION_KEY);
  }
}

export function createBrowserMockAuthStore() {
  return new MockAuthStore(window.localStorage);
}
