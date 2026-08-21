import type { Conversation } from "@/modules/chat/types";

export interface ConversationStore {
  list(): Promise<Conversation[]>;
  get(id: string): Promise<Conversation | undefined>;
  save(conversation: Conversation): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, Conversation>();

  async list() {
    return [...this.conversations.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  async get(id: string) {
    return this.conversations.get(id);
  }

  async save(conversation: Conversation) {
    this.conversations.set(conversation.id, structuredClone(conversation));
  }

  async remove(id: string) {
    this.conversations.delete(id);
  }

  async clear() {
    this.conversations.clear();
  }
}

const legacyDatabaseName = "liara-assistant";
const storeName = "conversations";
const databaseVersion = 1;
const ownerIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function openDatabase(databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        const store = database.createObjectStore(storeName, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionResult<T>(request: IDBRequest<T>, transaction: IDBTransaction) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export class IndexedDbConversationStore implements ConversationStore {
  constructor(private readonly databaseName = legacyDatabaseName) {}

  async list() {
    const database = await openDatabase(this.databaseName);
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    const conversations = await transactionResult(request, transaction);
    database.close();
    return (conversations as Conversation[]).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  async get(id: string) {
    const database = await openDatabase(this.databaseName);
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(id);
    const result = await transactionResult(request, transaction);
    database.close();
    return result as Conversation | undefined;
  }

  async save(conversation: Conversation) {
    const database = await openDatabase(this.databaseName);
    const transaction = database.transaction(storeName, "readwrite");
    const request = transaction.objectStore(storeName).put(conversation);
    await transactionResult(request, transaction);
    database.close();
  }

  async remove(id: string) {
    const database = await openDatabase(this.databaseName);
    const transaction = database.transaction(storeName, "readwrite");
    const request = transaction.objectStore(storeName).delete(id);
    await transactionResult(request, transaction);
    database.close();
  }

  async clear() {
    const database = await openDatabase(this.databaseName);
    const transaction = database.transaction(storeName, "readwrite");
    const request = transaction.objectStore(storeName).clear();
    await transactionResult(request, transaction);
    database.close();
  }
}

const browserStores = new Map<string, ConversationStore>();

export function getConversationStore(ownerId?: string) {
  if (ownerId && !ownerIdPattern.test(ownerId)) {
    throw new Error("Invalid conversation owner");
  }
  const cacheKey = ownerId ?? "legacy";
  const existing = browserStores.get(cacheKey);
  if (existing) return existing;
  const store = typeof indexedDB === "undefined"
    ? new MemoryConversationStore()
    : new IndexedDbConversationStore(ownerId ? `liara-assistant-user-${ownerId}` : legacyDatabaseName);
  browserStores.set(cacheKey, store);
  return store;
}
