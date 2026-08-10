"use client";

import {
  loadChunkMeta,
  loadChunks,
  saveChunkMeta,
  saveChunks,
  type ChunkIndexMeta,
} from "./storage";
import { embedQuery, ensureVectorIndex, vectorSearch } from "./embedding";
import type {
  AnalysisStage,
  DocumentPage,
  ModelConfig,
  Person,
  Project,
  ProjectAnalysis,
  TextChunk,
} from "./types";

export type ScoredChunk = { chunk: TextChunk; score: number };

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

export function hashPages(pages: DocumentPage[]): string {
  let hash = 0x811c9dc5;
  for (const page of pages) {
    const value = `${page.pageNumber}\u0000${page.text}\u0000`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16);
}

export function buildChunks(
  pages: DocumentPage[],
  projectId: string,
): TextChunk[] {
  const usablePages = pages.filter(
    (page) => !page.imageHeavy || page.text.trim().length >= 100,
  );
  const entries = usablePages
    .map((page) => ({ page: page.pageNumber, text: page.text.trim() }))
    .filter((entry) => entry.text);
  const joined = entries.map((entry) => entry.text).join("\n\n");
  if (!joined) return [];
  const pageAt = (offset: number) => {
    let cursor = 0;
    for (const entry of entries) {
      const next = cursor + entry.text.length;
      if (offset <= next) return entry.page;
      cursor = next + 2;
    }
    return entries.at(-1)?.page ?? 1;
  };
  const chunks: TextChunk[] = [];
  for (
    let start = 0, index = 0;
    start < joined.length;
    start += CHUNK_SIZE - CHUNK_OVERLAP, index += 1
  ) {
    const end = Math.min(joined.length, start + CHUNK_SIZE);
    chunks.push({
      id: `${projectId}:${index}`,
      projectId,
      index,
      text: joined.slice(start, end),
      startPage: pageAt(start),
      endPage: pageAt(Math.max(start, end - 1)),
    });
    if (end === joined.length) break;
  }
  return chunks;
}

export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  const terms: string[] = [];
  for (const word of normalized.match(/[a-z0-9]+|[\u3400-\u9fff]+/g) ?? []) {
    if (/^[\u3400-\u9fff]+$/.test(word)) {
      if (word.length === 1) terms.push(word);
      for (let index = 0; index < word.length - 1; index += 1)
        terms.push(word.slice(index, index + 2));
    } else {
      terms.push(word);
    }
  }
  return terms;
}

export function bm25Search(
  chunks: TextChunk[],
  query: string,
  k: number,
): ScoredChunk[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (!queryTerms.length || !chunks.length) return [];
  const documents = chunks.map((chunk) => tokenize(chunk.text));
  const averageLength =
    documents.reduce((sum, terms) => sum + terms.length, 0) /
      documents.length || 1;
  const documentFrequency = new Map<string, number>();
  documents.forEach((terms) =>
    new Set(terms).forEach((term) =>
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1),
    ),
  );
  const k1 = 1.5;
  const b = 0.75;
  return chunks
    .map((chunk, index) => {
      const terms = documents[index];
      const counts = new Map<string, number>();
      terms.forEach((term) => counts.set(term, (counts.get(term) ?? 0) + 1));
      const score = queryTerms.reduce((total, term) => {
        const tf = counts.get(term) ?? 0;
        if (!tf) return total;
        const df = documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
        return (
          total +
          idf *
            ((tf * (k1 + 1)) /
              (tf + k1 * (1 - b + (b * terms.length) / averageLength)))
        );
      }, 0);
      return { chunk, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

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

export function stageQuery(
  stage: AnalysisStage,
  analysis: ProjectAnalysis,
): string {
  switch (stage) {
    case "background":
      return "故事 背景 起因 阴谋 历史 结局";
    case "timeplace":
      return "时间 日期 先后 地点 场景 区域 方位";
    case "characters":
      return "人物 角色 姓名 身份 动机 组织";
    case "characterArcs":
      return `人物 经历 动机 目标 行动 变化 秘密 ${analysis.people.map((person) => person.name).join(" ")}`;
    case "openingHook":
      return "开篇 开场 委托 邀请 失踪 事件 调查员 钩子";
    case "clues":
      return "线索 物品 发现 指向 地点 场景";
    case "acts":
      return `场景 章节 事件 分支 结局 人物 线索 地点 ${analysis.people.map((person) => person.name).join(" ")}`;
  }
}

const RELATION_TERMS =
  "关系 联盟 敌对 秘密 刺杀 谋杀 阴谋 计划 意图 勒索 跟踪 背叛 献祭 威胁 监视 仇恨 保护 利用";

export function relationRecall(
  chunks: TextChunk[],
  people: Person[],
  limit = 30,
): ScoredChunk[] {
  const importantPeople = people
    .filter((person) => person.importance !== "minor")
    .slice(0, 30);
  const corePeople = importantPeople.length > 0 ? importantPeople : people.slice(0, 30);
  const recalled: ScoredChunk[] = [];

  corePeople.forEach((person) => {
    const names = [person.name, ...person.aliases].filter(Boolean).join(" ");
    recalled.push(...bm25Search(chunks, `${names} ${RELATION_TERMS}`, 3));
  });
  for (let left = 0; left < corePeople.length; left += 1) {
    for (let right = left + 1; right < corePeople.length; right += 1) {
      recalled.push(
        ...bm25Search(
          chunks,
          `${corePeople[left].name} ${corePeople[right].name}`,
          2,
        ),
      );
    }
  }

  const byChunk = new Map<string, ScoredChunk>();
  recalled.forEach((result) => {
    const previous = byChunk.get(result.chunk.id);
    if (!previous || result.score > previous.score) {
      byChunk.set(result.chunk.id, result);
    }
  });
  return [...byChunk.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(30, limit));
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
