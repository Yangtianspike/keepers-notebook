import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

/**
 * 存储层跑在 IndexedDB 上，Node 环境没有这个 API，因此依赖 fake-indexeddb
 * 提供的内存实现。依赖缺失时整组测试跳过，不会阻塞 `npm test`。
 *
 *   npm install -D fake-indexeddb
 */
let available = true;
try {
  await import("fake-indexeddb/auto");
} catch {
  available = false;
}

const skip = available ? false : "需要先安装 fake-indexeddb（npm install -D fake-indexeddb）";
const storage = available ? await import("../lib/storage.ts") : null;

function project(id, extra = {}) {
  return {
    id,
    name: `项目 ${id}`,
    fileName: `${id}.pdf`,
    fileType: "pdf",
    fileSize: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "imported",
    documentText: "",
    pages: [],
    chapters: [],
    analysis: { people: [], clues: [], acts: [], stages: {} },
    ...extra,
  };
}

function chunk(projectId, index) {
  return {
    id: `${projectId}:${index}`,
    projectId,
    index,
    text: `第 ${index} 块`,
    startPage: index + 1,
    endPage: index + 1,
  };
}

function image(projectId, page, id) {
  return {
    id,
    projectId,
    page,
    sourceObjectName: "x",
    width: 10,
    height: 10,
    blob: new Blob(["x"]),
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function meta(projectId, chunkCount = 1) {
  return {
    id: `meta:${projectId}`,
    projectId,
    chunkCount,
    textHash: "hash",
    builtAt: "2026-01-01T00:00:00.000Z",
    kind: "meta",
  };
}

async function reset() {
  if (!available) return;
  const projects = await storage.listProjects();
  await Promise.all(projects.map((item) => storage.deleteProject(item.id)));
}

beforeEach(reset);

// ---------------------------------------------------------------- 项目

test("项目可以保存、列出与删除", { skip }, async () => {
  await storage.saveProject(project("p1"));
  assert.equal((await storage.listProjects()).length, 1);

  await storage.deleteProject("p1");
  assert.deepEqual(await storage.listProjects(), []);
});

test("项目列表按更新时间倒序排列", { skip }, async () => {
  await storage.saveProject(project("old", { updatedAt: "2026-01-01T00:00:00.000Z" }));
  await storage.saveProject(project("new", { updatedAt: "2026-06-01T00:00:00.000Z" }));

  assert.deepEqual(
    (await storage.listProjects()).map((item) => item.id),
    ["new", "old"],
  );
});

test("保存同一 id 的项目是覆盖而不是新增", { skip }, async () => {
  await storage.saveProject(project("p1", { name: "第一版" }));
  await storage.saveProject(project("p1", { name: "第二版" }));

  const projects = await storage.listProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, "第二版");
});

test("没有任何项目时返回空数组", { skip }, async () => {
  assert.deepEqual(await storage.listProjects(), []);
});

// ---------------------------------------------------------------- 原始文件

test("原始文件可以保存并重新读取", { skip }, async () => {
  await storage.saveSourceFile("p1", new Blob(["原文内容"], { type: "text/plain" }));

  const loaded = await storage.loadSourceFile("p1");
  assert.ok(loaded);
  assert.equal(await loaded.text(), "原文内容");
});

test("读取不存在的原始文件返回 null", { skip }, async () => {
  assert.equal(await storage.loadSourceFile("不存在"), null);
});

test("原始文件可以单独删除", { skip }, async () => {
  await storage.saveSourceFile("p1", new Blob(["x"]));
  await storage.deleteSourceFile("p1");
  assert.equal(await storage.loadSourceFile("p1"), null);
});

// ---------------------------------------------------------------- 文本块

test("文本块按项目保存与读取，并保持索引顺序", { skip }, async () => {
  await storage.saveChunks("p1", [chunk("p1", 2), chunk("p1", 0), chunk("p1", 1)]);

  const chunks = await storage.loadChunks("p1");
  assert.deepEqual(chunks.map((item) => item.index), [0, 1, 2]);
});

test("重复保存文本块是替换而不是累加", { skip }, async () => {
  await storage.saveChunks("p1", [chunk("p1", 0), chunk("p1", 1)]);
  await storage.saveChunks("p1", [chunk("p1", 0)]);

  assert.equal((await storage.loadChunks("p1")).length, 1);
});

test("重建索引只影响当前项目，其他项目的块保持不动", { skip }, async () => {
  await storage.saveChunks("p1", [chunk("p1", 0), chunk("p1", 1)]);
  await storage.saveChunks("p2", [chunk("p2", 0)]);
  await storage.saveChunks("p1", [chunk("p1", 0)]);

  assert.equal((await storage.loadChunks("p1")).length, 1);
  assert.equal((await storage.loadChunks("p2")).length, 1);
});

test("读取没有索引的项目返回空数组", { skip }, async () => {
  assert.deepEqual(await storage.loadChunks("不存在"), []);
});

// ---------------------------------------------------------------- 索引元数据

test("文本块元数据可以保存与读取", { skip }, async () => {
  const record = meta("p1", 3);
  await storage.saveChunkMeta(record);
  assert.deepEqual(await storage.loadChunkMeta("p1"), record);
});

test("读取不存在的元数据返回 null", { skip }, async () => {
  assert.equal(await storage.loadChunkMeta("不存在"), null);
});

test("元数据不会被当成文本块返回", { skip }, async () => {
  await storage.saveChunks("p1", [chunk("p1", 0)]);
  await storage.saveChunkMeta(meta("p1"));

  const chunks = await storage.loadChunks("p1");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].index, 0);
});

// ---------------------------------------------------------------- 向量空间

test("向量空间可以保存、读取与删除", { skip }, async () => {
  await storage.saveVectorSpace("p1:vectors", { dims: 3, data: [1, 2, 3] });
  assert.deepEqual(await storage.loadVectorSpace("p1:vectors"), { dims: 3, data: [1, 2, 3] });

  await storage.deleteVectorSpace("p1:vectors");
  assert.equal(await storage.loadVectorSpace("p1:vectors"), null);
});

test("读取不存在的向量空间返回 null", { skip }, async () => {
  assert.equal(await storage.loadVectorSpace("不存在"), null);
});

// ---------------------------------------------------------------- 提取的图片

test("提取的图片按项目读取并按页码排序", { skip }, async () => {
  await storage.saveExtractedImages([image("p1", 3, "c"), image("p1", 1, "a"), image("p1", 2, "b")]);

  assert.deepEqual(
    (await storage.loadExtractedImages("p1")).map((item) => item.page),
    [1, 2, 3],
  );
});

test("保存空图片列表不会出错", { skip }, async () => {
  await storage.saveExtractedImages([]);
  assert.deepEqual(await storage.loadExtractedImages("p1"), []);
});

test("按页码范围删除图片时只影响该范围", { skip }, async () => {
  await storage.saveExtractedImages([image("p1", 1, "a"), image("p1", 2, "b"), image("p1", 3, "c")]);
  await storage.deleteExtractedImages("p1", { start: 2, end: 2 });

  assert.deepEqual(
    (await storage.loadExtractedImages("p1")).map((item) => item.page),
    [1, 3],
  );
});

test("不传范围时删除该项目的全部图片，其他项目不受影响", { skip }, async () => {
  await storage.saveExtractedImages([image("p1", 1, "a"), image("p2", 1, "b")]);
  await storage.deleteExtractedImages("p1");

  assert.deepEqual(await storage.loadExtractedImages("p1"), []);
  assert.equal((await storage.loadExtractedImages("p2")).length, 1);
});

// ---------------------------------------------------------------- 级联删除

test("删除项目时一并清理原文、文本块、索引、向量与图片", { skip }, async () => {
  await storage.saveProject(project("p1"));
  await storage.saveSourceFile("p1", new Blob(["原文"]));
  await storage.saveChunks("p1", [chunk("p1", 0)]);
  await storage.saveChunkMeta(meta("p1"));
  await storage.saveVectorSpace("p1:vectors", [1, 2, 3]);
  await storage.saveExtractedImages([image("p1", 1, "a")]);

  await storage.deleteProject("p1");

  assert.deepEqual(await storage.listProjects(), []);
  assert.equal(await storage.loadSourceFile("p1"), null);
  assert.deepEqual(await storage.loadChunks("p1"), []);
  assert.equal(await storage.loadChunkMeta("p1"), null);
  assert.equal(await storage.loadVectorSpace("p1:vectors"), null);
  assert.deepEqual(await storage.loadExtractedImages("p1"), []);
});

test("删除项目会清掉该项目的地图文件，但不碰其他项目", { skip }, async () => {
  await storage.saveSourceFile("map:p1:map-1", new Blob(["地图"]));
  await storage.saveSourceFile("p1", new Blob(["原文"]));
  await storage.saveSourceFile("map:p2:map-1", new Blob(["别人的地图"]));

  await storage.deleteProject("p1");

  assert.equal(await storage.loadSourceFile("map:p1:map-1"), null);
  assert.equal(await storage.loadSourceFile("p1"), null);
  assert.ok(await storage.loadSourceFile("map:p2:map-1"), "其他项目的地图不应被删除");
});

test("删除项目不会影响其他项目的数据", { skip }, async () => {
  await storage.saveProject(project("p1"));
  await storage.saveProject(project("p2"));
  await storage.saveSourceFile("p2", new Blob(["p2 原文"]));
  await storage.saveChunks("p2", [chunk("p2", 0)]);
  await storage.saveVectorSpace("p2:vectors", [9]);
  await storage.saveExtractedImages([image("p2", 1, "b")]);

  await storage.deleteProject("p1");

  assert.deepEqual((await storage.listProjects()).map((item) => item.id), ["p2"]);
  assert.ok(await storage.loadSourceFile("p2"));
  assert.equal((await storage.loadChunks("p2")).length, 1);
  assert.deepEqual(await storage.loadVectorSpace("p2:vectors"), [9]);
  assert.equal((await storage.loadExtractedImages("p2")).length, 1);
});

test("删除不存在的项目不会抛错", { skip }, async () => {
  await assert.doesNotReject(() => storage.deleteProject("不存在"));
});
