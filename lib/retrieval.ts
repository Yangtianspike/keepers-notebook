"use client";

import {
  loadChunkMeta,
  loadChunks,
  saveChunkMeta,
  saveChunks,
  type ChunkIndexMeta,
} from "./storage";
import { embedQuery, ensureVectorIndex, vectorSearch } from "./embedding";
import {
  bm25Search,
  buildChunks,
  hashPages,
  relationRecall,
  type ScoredChunk,
} from "./retrieval-core";
import type { ModelConfig, Project, TextChunk } from "./types";

// 纯计算部分（分块、分词、BM25、阶段关键词、关系召回）放在 retrieval-core，
// 这里只负责需要 IndexedDB 与向量服务的部分。
export * from "./retrieval-core";

export async function ensureChunkIndex(project: Project): Promise<TextChunk[]> {
  const textHash = hashPages(project.pages);
  const existingMeta = await loadChunkMeta(project.id);
  if (existingMeta?.textHash === textHash) return loadChunks(project.id);
  const chunks = buildChunks(project.pages, project.id);
  await saveChunks(project.id, chunks);
  const meta: ChunkIndexMeta = {
    id: `meta:${project.id}`,
    projectId: project.id,
    chunkCount: chunks.length,
    textHash,
    builtAt: new Date().toISOString(),
    kind: "meta",
  };
  await saveChunkMeta(meta);
  return chunks;
}

export async function relationSearch(project: Project): Promise<ScoredChunk[]> {
  const chunks = await ensureChunkIndex(project);
  return relationRecall(chunks, project.analysis.people, 30);
}

export async function hybridSearch(
  project: Project,
  query: string,
  k: number,
  config?: ModelConfig,
  apiKey?: string,
): Promise<ScoredChunk[]> {
  const chunks = await ensureChunkIndex(project);
  const keyword = bm25Search(chunks, query, k);
  const capability = config?.capabilities?.embedding;
  if (!capability || !apiKey) return keyword;
  try {
    await ensureVectorIndex(project, capability, config, apiKey);
    const queryVector = await embedQuery(config, apiKey, capability, query);
    const semantic = await vectorSearch(project, capability, queryVector, k);
    const scores = new Map<string, number>();
    [keyword, semantic].forEach((results) =>
      results.forEach((result, index) => {
        scores.set(
          result.chunk.id,
          (scores.get(result.chunk.id) ?? 0) + 1 / (60 + index + 1),
        );
      }),
    );
    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    return [...scores.entries()]
      .map(([id, score]) => ({ chunk: chunkById.get(id)!, score }))
      .filter((item) => item.chunk)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  } catch {
    return keyword;
  }
}
