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

const databaseName = "liara-assistant";
const storeName = "conversations";
const databaseVersion = 1;

function openDatabase(): Promise<IDBDatabase> {
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
  async list() {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    const conversations = await transactionResult(request, transaction);
    database.close();
    return (conversations as Conversation[]).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  async get(id: string) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(id);
    const result = await transactionResult(request, transaction);
    database.close();
    return result as Conversation | undefined;
  }

  async save(conversation: Conversation) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    const request = transaction.objectStore(storeName).put(conversation);
    await transactionResult(request, transaction);
    database.close();
  }

  async remove(id: string) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    const request = transaction.objectStore(storeName).delete(id);
    await transactionResult(request, transaction);
    database.close();
  }

  async clear() {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    const request = transaction.objectStore(storeName).clear();
    await transactionResult(request, transaction);
    database.close();
  }
}

let browserStore: ConversationStore | undefined;

export function getConversationStore() {
  if (browserStore) return browserStore;
  browserStore = typeof indexedDB === "undefined"
    ? new MemoryConversationStore()
    : new IndexedDbConversationStore();
  return browserStore;
}
