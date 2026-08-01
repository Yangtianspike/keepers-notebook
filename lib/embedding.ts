"use client";

import { ensureChunkIndex } from "./retrieval";
import { loadVectorSpace, saveVectorSpace } from "./storage";
import type { EmbeddingCapability, ModelConfig, Project } from "./types";

type VectorRecord = { chunkId: string; vector: number[] };

function namespace(projectId: string, capability: EmbeddingCapability) {
  return `${projectId}:${capability.model}:${capability.dimensions}`;
}

async function embeddingRequest(
  config: ModelConfig,
  apiKey: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, apiKey, config }),
    signal,
  });
  if (!response.ok) throw new Error("向量接口不可用。");
  return response.json() as Promise<Record<string, unknown>>;
}

export async function probeEmbedding(
  config: ModelConfig,
  apiKey: string,
): Promise<EmbeddingCapability | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const result = await embeddingRequest(
      config,
      apiKey,
      {
        action: "embedTest",
        embeddingModel: config.capabilities?.embedding?.model,
      },
      controller.signal,
    );
    if (
      !result.supported ||
      typeof result.model !== "string" ||
      typeof result.dimensions !== "number"
    )
      return null;
    return {
      model: result.model,
      dimensions: result.dimensions,
      testedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function ensureVectorIndex(
  project: Project,
  capability: EmbeddingCapability,
  config: ModelConfig,
  apiKey: string,
): Promise<void> {
  const key = namespace(project.id, capability);
  if (await loadVectorSpace<VectorRecord[]>(key)) return;
  const chunks = await ensureChunkIndex(project);
  const records: VectorRecord[] = [];
  for (let index = 0; index < chunks.length; index += 32) {
    const batch = chunks.slice(index, index + 32);
    const response = await embeddingRequest(config, apiKey, {
      action: "embed",
      embeddingModel: capability.model,
      texts: batch.map((chunk) => chunk.text),
    });
    const vectors = response.vectors as number[][] | undefined;
    if (!vectors || vectors.length !== batch.length)
      throw new Error("向量返回数量不匹配。");
    batch.forEach((chunk, vectorIndex) =>
      records.push({ chunkId: chunk.id, vector: vectors[vectorIndex] }),
    );
  }
  await saveVectorSpace(key, records);
}

export async function vectorSearch(
  project: Project,
  capability: EmbeddingCapability,
  queryVector: number[],
  k: number,
) {
  const records = await loadVectorSpace<VectorRecord[]>(
    namespace(project.id, capability),
  );
  if (!records?.length) return [];
  const chunks = await ensureChunkIndex(project);
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const norm = (vector: number[]) =>
    Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  const queryNorm = norm(queryVector);
  return records
    .map((record) => ({
      chunk: chunkById.get(record.chunkId),
      score:
        record.vector.reduce(
          (sum, value, index) => sum + value * (queryVector[index] ?? 0),
          0,
        ) /
        (norm(record.vector) * queryNorm),
    }))
    .filter(
      (
        result,
      ): result is { chunk: NonNullable<typeof result.chunk>; score: number } =>
        Boolean(result.chunk),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export async function embedQuery(
  config: ModelConfig,
  apiKey: string,
  capability: EmbeddingCapability,
  text: string,
): Promise<number[]> {
  const response = await embeddingRequest(config, apiKey, {
    action: "embed",
    embeddingModel: capability.model,
    texts: [text],
  });
  const vector = (response.vectors as number[][] | undefined)?.[0];
  if (!vector) throw new Error("未能生成检索向量。");
  return vector;
}
