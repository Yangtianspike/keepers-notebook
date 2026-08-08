"use client";

import type { Project, TextChunk } from "./types";

const DB_NAME = "keeper-atlas";
const DB_VERSION = 3;
const PROJECTS = "projects";
const FILES = "files";
const CHUNKS = "chunks";
const VECTORS = "vectors";

export type ChunkIndexMeta = {
  id: string;
  projectId: string;
  chunkCount: number;
  textHash: string;
  builtAt: string;
  embedModel?: string;
  kind: "meta";
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS)) {
        db.createObjectStore(PROJECTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FILES)) {
        db.createObjectStore(FILES);
      }
      if (!db.objectStoreNames.contains(CHUNKS)) {
        db.createObjectStore(CHUNKS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(VECTORS)) {
        db.createObjectStore(VECTORS);
      }

      if (event.oldVersion < 3 && request.transaction) {
        const projects = request.transaction.objectStore(PROJECTS);
        const cursorRequest = projects.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;

          const project = cursor.value as unknown as {
            analysis: {
              relationshipLayout?: Record<string, { x: number; y: number }>;
              relations: Array<Record<string, unknown>>;
            };
          };

          project.analysis.relations = project.analysis.relations.map(
            (relation) => {
              const layer = relation.layer;
              relation.type =
                layer === "belief" || layer === "inferred"
                  ? "hidden"
                  : "real";
              relation.confidence = 1;
              delete relation.layer;
              delete relation.provenance;
              delete relation.source;
              return relation;
            },
          );
          delete project.analysis.relationshipLayout;
          cursor.update(project);
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listProjects(): Promise<Project[]> {
  const db = await openDatabase();
  const transaction = db.transaction(PROJECTS, "readonly");
  const projects = await requestToPromise(
    transaction.objectStore(PROJECTS).getAll() as IDBRequest<Project[]>,
  );
  db.close();
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveProject(project: Project): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(PROJECTS, "readwrite");
  transaction.objectStore(PROJECTS).put(project);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function saveSourceFile(
  projectId: string,
  file: Blob,
): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(FILES, "readwrite");
  transaction.objectStore(FILES).put(file, projectId);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function loadSourceFile(projectId: string): Promise<Blob | null> {
  const db = await openDatabase();
  const transaction = db.transaction(FILES, "readonly");
  const blob = await requestToPromise(
    transaction.objectStore(FILES).get(projectId) as IDBRequest<Blob>,
  );
  db.close();
  return blob ?? null;
}

export async function deleteSourceFile(key: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(FILES, "readwrite");
  transaction.objectStore(FILES).delete(key);
  await transactionDone(transaction);
  db.close();
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveChunks(projectId: string, chunks: TextChunk[]): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(CHUNKS, "readwrite");
  const store = transaction.objectStore(CHUNKS);
  const records = await requestToPromise(store.getAll() as IDBRequest<Array<TextChunk | ChunkIndexMeta>>);
  records.filter((record) => record.projectId === projectId).forEach((record) => store.delete(record.id));
  chunks.forEach((chunk) => store.put(chunk));
  await transactionDone(transaction);
  db.close();
}

export async function loadChunks(projectId: string): Promise<TextChunk[]> {
  const db = await openDatabase();
  const transaction = db.transaction(CHUNKS, "readonly");
  const records = await requestToPromise(transaction.objectStore(CHUNKS).getAll() as IDBRequest<Array<TextChunk | ChunkIndexMeta>>);
  db.close();
  return records.filter((record): record is TextChunk => !("kind" in record) && record.projectId === projectId).sort((a, b) => a.index - b.index);
}

export async function saveChunkMeta(meta: ChunkIndexMeta): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(CHUNKS, "readwrite");
  transaction.objectStore(CHUNKS).put(meta);
  await transactionDone(transaction);
  db.close();
}

export async function loadChunkMeta(projectId: string): Promise<ChunkIndexMeta | null> {
  const db = await openDatabase();
  const transaction = db.transaction(CHUNKS, "readonly");
  const result = await requestToPromise(transaction.objectStore(CHUNKS).get(`meta:${projectId}`) as IDBRequest<ChunkIndexMeta>);
  db.close();
  return result ?? null;
}

export async function saveVectorSpace<T>(key: string, payload: T): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(VECTORS, "readwrite");
  transaction.objectStore(VECTORS).put(payload, key);
  await transactionDone(transaction);
  db.close();
}

export async function loadVectorSpace<T>(key: string): Promise<T | null> {
  const db = await openDatabase();
  const transaction = db.transaction(VECTORS, "readonly");
  const result = await requestToPromise(transaction.objectStore(VECTORS).get(key) as IDBRequest<T>);
  db.close();
  return result ?? null;
}

export async function deleteVectorSpace(key: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(VECTORS, "readwrite");
  transaction.objectStore(VECTORS).delete(key);
  await transactionDone(transaction);
  db.close();
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([PROJECTS, FILES, CHUNKS, VECTORS], "readwrite");
  transaction.objectStore(PROJECTS).delete(projectId);
  const fileStore = transaction.objectStore(FILES);
  fileStore.delete(projectId);
  const fileKeys = await requestToPromise(fileStore.getAllKeys());
  fileKeys
    .filter(
      (key) =>
        typeof key === "string" && key.startsWith(`map:${projectId}:`),
    )
    .forEach((key) => fileStore.delete(key));
  const chunkStore = transaction.objectStore(CHUNKS);
  const chunkRecords = await requestToPromise(chunkStore.getAll() as IDBRequest<Array<TextChunk | ChunkIndexMeta>>);
  chunkRecords.filter((record) => record.projectId === projectId).forEach((record) => chunkStore.delete(record.id));
  const vectorStore = transaction.objectStore(VECTORS);
  const vectorKeys = await requestToPromise(vectorStore.getAllKeys());
  vectorKeys.filter((key) => typeof key === "string" && key.startsWith(`${projectId}:`)).forEach((key) => vectorStore.delete(key));
  await transactionDone(transaction);
  db.close();
}
