import type { AnswerRequest } from "@/lib/api/types";

const DATABASE = "grammar-mastery-stage22";
const STORE = "pending_answers";
const VERSION = 1;

export interface PendingAnswerRecord extends AnswerRequest {
  key: string;
  attempt_id: string;
  idempotency_key: string;
  queued_at: string;
}

export function pendingAnswerKey(attemptId: string, questionId: string): string {
  return `${attemptId}:${questionId}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, {keyPath: "key"});
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open pending-answer storage."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Pending-answer operation failed."));
      transaction.onerror = () => reject(transaction.error ?? new Error("Pending-answer transaction failed."));
    });
  } finally {
    database.close();
  }
}

export async function putPendingAnswer(record: PendingAnswerRecord): Promise<void> {
  await withStore("readwrite", (store) => store.put(record));
}

export async function getPendingAnswer(attemptId: string, questionId: string): Promise<PendingAnswerRecord | null> {
  const result = await withStore<PendingAnswerRecord | undefined>(
    "readonly",
    (store) => store.get(pendingAnswerKey(attemptId, questionId)),
  );
  return result ?? null;
}

export async function removePendingAnswer(attemptId: string, questionId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(pendingAnswerKey(attemptId, questionId)));
}
