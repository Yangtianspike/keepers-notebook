"use client";

import type {
  Act,
  AnalysisStage,
  Project,
  StageState,
  TextChunk,
} from "./types";

const DB_NAME = "keeper-atlas";
const DB_VERSION = 5;
const PROJECTS = "projects";
const FILES = "files";
const CHUNKS = "chunks";
const VECTORS = "vectors";
const EXTRACTED_IMAGES = "extractedImages";

export type ExtractedImageRecord = {
  id: string;
  projectId: string;
  page: number;
  sourceObjectName: string;
  width: number;
  height: number;
  blob: Blob;
  createdAt: string;
  origin?: "pdf" | "docx" | "upload";
  fileName?: string;
  title?: string;
  inPack?: boolean;
  packOrder?: number;
};

type LegacyAnalysis = Record<string, unknown> & {
  relations?: Array<Record<string, unknown>>;
  timeline?: Array<Record<string, unknown>>;
  places?: Project["analysis"]["places"];
  acts?: Act[];
};

function idleStages(): Record<AnalysisStage, StageState> {
  return {
    background: { status: "idle" },
    timeplace: { status: "idle" },
    characters: { status: "idle" },
    monsters: { status: "idle" },
    characterArcs: { status: "idle" },
    clues: { status: "idle" },
    acts: { status: "idle" },
  };
}

export function migrateAnalysisToV4(analysis: LegacyAnalysis): LegacyAnalysis {
  const acts = [...(analysis.acts ?? [])];
  const relations = analysis.relations ?? [];
  const timeline = analysis.timeline ?? [];

  if (relations.length > 0) {
    const personIds = Array.from(
      new Set(
        relations.flatMap((relation) =>
          [relation.sourceId, relation.targetId].filter(
            (value): value is string => typeof value === "string",
          ),
        ),
      ),
    );
    acts.push({
      id: crypto.randomUUID(),
      title: "迁移幕",
      sequence: acts.length + 1,
      time: "未知",
      personIds,
      clueIds: [],
      branches: [],
      keyEvents: [],
      description: `从 v0.4 迁移的 ${relations.length} 条人物关系`,
    });
  }

  timeline.forEach((event) => {
    const title = typeof event.title === "string" ? event.title : "迁移事件";
    const summary = typeof event.summary === "string" ? event.summary : "";
    acts.push({
      id: crypto.randomUUID(),
      title,
      sequence: acts.length + 1,
      time: typeof event.date === "string" && event.date ? event.date : "未知",
      personIds: [],
      clueIds: [],
      branches: [],
      keyEvents: [
        {
          title,
          type: "checkpoint",
          description: summary,
        },
      ],
      description: summary,
    });
  });

  analysis.acts = acts;
  analysis.chapterSummaries = Array.isArray(analysis.chapterSummaries)
    ? analysis.chapterSummaries
    : [];
  analysis.timePlace = analysis.timePlace ?? {
    timeline: "",
    places: analysis.places ?? [],
  };
  analysis.characterArcs = Array.isArray(analysis.characterArcs)
    ? analysis.characterArcs
    : [];
  analysis.openingHook =
    typeof analysis.openingHook === "string" ? analysis.openingHook : "";
  analysis.stages = idleStages();

  delete analysis.relations;
  delete analysis.timeline;
  delete analysis.relationshipLayout;
  delete analysis.clueLayout;

  return analysis;
}

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
      if (!db.objectStoreNames.contains(EXTRACTED_IMAGES)) {
        const images = db.createObjectStore(EXTRACTED_IMAGES, { keyPath: "id" });
        images.createIndex("projectId", "projectId", { unique: false });
      }

      if (event.oldVersion < 4 && request.transaction) {
        const projects = request.transaction.objectStore(PROJECTS);
        const cursorRequest = projects.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;

          const project = cursor.value as { analysis: LegacyAnalysis };

          if (event.oldVersion < 3 && project.analysis.relations) {
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
          }

          migrateAnalysisToV4(project.analysis);
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

export async function loadExtractedImages(projectId: string): Promise<ExtractedImageRecord[]> {
  const db = await openDatabase();
  const transaction = db.transaction(EXTRACTED_IMAGES, "readonly");
  const records = await requestToPromise(
    transaction.objectStore(EXTRACTED_IMAGES).index("projectId").getAll(projectId) as IDBRequest<ExtractedImageRecord[]>,
  );
  db.close();
  return records.sort((left, right) => left.page - right.page || left.id.localeCompare(right.id));
}

export async function saveExtractedImages(records: ExtractedImageRecord[]): Promise<void> {
  if (records.length === 0) return;
  const db = await openDatabase();
  const transaction = db.transaction(EXTRACTED_IMAGES, "readwrite");
  const store = transaction.objectStore(EXTRACTED_IMAGES);
  records.forEach((record) => store.put(record));
  await transactionDone(transaction);
  db.close();
}

export async function deleteExtractedImages(
  projectId: string,
  pageRange?: { start: number; end: number },
): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(EXTRACTED_IMAGES, "readwrite");
  const store = transaction.objectStore(EXTRACTED_IMAGES);
  const records = await requestToPromise(
    store.index("projectId").getAll(projectId) as IDBRequest<ExtractedImageRecord[]>,
  );
  records
    .filter((record) => !pageRange || (record.page >= pageRange.start && record.page <= pageRange.end))
    .forEach((record) => store.delete(record.id));
  await transactionDone(transaction);
  db.close();
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([PROJECTS, FILES, CHUNKS, VECTORS, EXTRACTED_IMAGES], "readwrite");
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
  const imageStore = transaction.objectStore(EXTRACTED_IMAGES);
  const imageRecords = await requestToPromise(
    imageStore.index("projectId").getAll(projectId) as IDBRequest<ExtractedImageRecord[]>,
  );
  imageRecords.forEach((record) => imageStore.delete(record.id));
  await transactionDone(transaction);
  db.close();
}
