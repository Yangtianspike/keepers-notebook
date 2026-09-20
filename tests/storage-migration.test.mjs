import assert from "node:assert/strict";
import test from "node:test";

import { migrateAnalysisToV4 } from "../lib/storage.ts";

test("把 v0.4 的人物关系迁移成一条「迁移幕」", () => {
  const migrated = migrateAnalysisToV4({
    relations: [
      { sourceId: "a", targetId: "b", label: "领导" },
      { sourceId: "b", targetId: "c", label: "雇佣" },
    ],
  });

  assert.equal(migrated.acts.length, 1);
  assert.equal(migrated.acts[0].title, "迁移幕");
  assert.deepEqual([...migrated.acts[0].personIds].sort(), ["a", "b", "c"]);
  assert.equal(migrated.relations, undefined, "旧字段应被清除");
});

test("时间轴事件逐条转换成幕，并保留标题、时间与说明", () => {
  const migrated = migrateAnalysisToV4({
    timeline: [
      { title: "开幕", date: "2024-03-15", summary: "教授死亡" },
      { summary: "缺少标题的事件" },
    ],
  });

  assert.equal(migrated.acts.length, 2);
  assert.equal(migrated.acts[0].title, "开幕");
  assert.equal(migrated.acts[0].time, "2024-03-15");
  assert.equal(migrated.acts[0].keyEvents[0].description, "教授死亡");
  assert.equal(migrated.acts[1].title, "迁移事件", "缺少标题时使用兜底名称");
  assert.equal(migrated.acts[1].time, "未知");
  assert.equal(migrated.timeline, undefined);
});

test("已有的幕被保留，迁移内容追加在后面", () => {
  const migrated = migrateAnalysisToV4({
    acts: [{
      id: "act-1", title: "原有幕", sequence: 1, time: "",
      personIds: [], clueIds: [], branches: [], keyEvents: [], description: "",
    }],
    timeline: [{ title: "新事件" }],
  });

  assert.equal(migrated.acts.length, 2);
  assert.equal(migrated.acts[0].title, "原有幕");
  assert.equal(migrated.acts[1].sequence, 2);
});

test("旧地点被搬进 timePlace，places 字段本身仍然保留", () => {
  const migrated = migrateAnalysisToV4({
    places: [{ id: "p", name: "码头", aliases: [], summary: "", confirmed: true, provenance: "source", sources: [] }],
  });

  assert.equal(migrated.timePlace.places.length, 1);
  assert.equal(migrated.timePlace.places[0].name, "码头");
  // places 是现役字段（实体系统仍在读取），迁移时不清除
  assert.equal(migrated.places.length, 1);
});

test("已有 timePlace 时不会被覆盖", () => {
  const migrated = migrateAnalysisToV4({ timePlace: { timeline: "已有时间线", places: [] } });
  assert.equal(migrated.timePlace.timeline, "已有时间线");
});

test("缺失的章节摘要、人物弧光与开场钩子补成安全默认值", () => {
  const migrated = migrateAnalysisToV4({});

  assert.deepEqual(migrated.chapterSummaries, []);
  assert.deepEqual(migrated.characterArcs, []);
  assert.equal(migrated.openingHook, "");
  assert.equal(migrated.acts.length, 0);
});

test("已存在的章节摘要与开场钩子不会被覆盖", () => {
  const migrated = migrateAnalysisToV4({
    chapterSummaries: [{ chapterId: "c1" }],
    characterArcs: [{ personId: "p1" }],
    openingHook: "已有开场",
  });

  assert.equal(migrated.chapterSummaries.length, 1);
  assert.equal(migrated.characterArcs.length, 1);
  assert.equal(migrated.openingHook, "已有开场");
});

test("阶段状态统一重置为 idle，避免显示成仍在分析", () => {
  const migrated = migrateAnalysisToV4({ stages: { background: { status: "running" } } });

  assert.equal(migrated.stages.background.status, "idle");
  assert.equal(migrated.stages.acts.status, "idle");
  assert.equal(Object.keys(migrated.stages).length, 7);
});

test("清除不再使用的布局字段", () => {
  const migrated = migrateAnalysisToV4({
    relationshipLayout: { a: 1 },
    clueLayout: { b: 2 },
  });

  assert.equal(migrated.relationshipLayout, undefined);
  assert.equal(migrated.clueLayout, undefined);
});

test("空对象与空数组输入都不会抛错", () => {
  assert.doesNotThrow(() => migrateAnalysisToV4({}));
  assert.doesNotThrow(() => migrateAnalysisToV4({ relations: [], timeline: [] }));
  assert.doesNotThrow(() => migrateAnalysisToV4({ acts: [], places: [] }));
});
