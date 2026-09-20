import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectEntities,
  entityAliases,
  entityCoCStats,
  entityFields,
  entityImage,
  entityName,
  entityRef,
  keeperEntityUri,
  parseKeeperEntityUri,
} from "../lib/entities.ts";
import { emptyAnalysis } from "../lib/types.ts";

function card(overrides) {
  return {
    ref: "person:a",
    id: "a",
    kind: "person",
    source: "source",
    confirmed: true,
    original: {
      name: "原名",
      aliases: ["旧称"],
      tags: [],
      playerVisible: "",
      keeperPrivate: "",
      fields: { role: "调查员" },
    },
    appearances: [],
    linkBehavior: { jump: true, preview: true },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function person(id, extra = {}) {
  return {
    id,
    name: id,
    aliases: [],
    role: "",
    importance: "important",
    publicIdentity: "",
    trueIdentity: "",
    motivation: "",
    secrets: [],
    confidence: 1,
    provenance: "source",
    sources: [],
    ...extra,
  };
}

function project({ analysis = {}, kpNotes } = {}) {
  return {
    id: "p1",
    name: "测试模组",
    fileName: "test.pdf",
    fileType: "pdf",
    fileSize: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    status: "ready",
    documentText: "",
    pages: [],
    chapters: [],
    analysis: { ...emptyAnalysis(), ...analysis },
    kpNotes,
  };
}

// ---------------------------------------------------------------- 引用与链接

test("实体引用格式为 kind:id", () => {
  assert.equal(entityRef("person", "a"), "person:a");
  assert.equal(entityRef("monster", "hounds"), "monster:hounds");
});

test("keeper 链接可以往返解析并保留行为开关", () => {
  const uri = keeperEntityUri("person:a", { jump: false, preview: true });
  assert.equal(uri, "keeper://person:a?jump=0&preview=1");
  assert.deepEqual(parseKeeperEntityUri(uri), {
    ref: "person:a",
    behavior: { jump: false, preview: true },
  });
});

test("缺少行为参数时默认全部开启", () => {
  assert.deepEqual(parseKeeperEntityUri("keeper://person:a"), {
    ref: "person:a",
    behavior: { jump: true, preview: true },
  });
});

test("非 keeper 协议返回 null，不会被误当成实体链接", () => {
  assert.equal(parseKeeperEntityUri("https://example.com/a"), null);
  assert.equal(parseKeeperEntityUri("person:a"), null);
  assert.equal(parseKeeperEntityUri(""), null);
});

// ---------------------------------------------------------------- 字段合并

test("名称与别名优先取 KP 修订值", () => {
  assert.equal(entityName(card()), "原名");
  assert.equal(entityName(card({ overrides: { name: "新名", updatedAt: "t" } })), "新名");
  assert.equal(
    entityName(card({ overrides: { name: "   ", updatedAt: "t" } })),
    "原名",
    "空白修订不应该覆盖原名",
  );
  assert.deepEqual(entityAliases(card()), ["旧称"]);
  assert.deepEqual(entityAliases(card({ overrides: { aliases: ["新别名"], updatedAt: "t" } })), ["新别名"]);
});

test("字段按「原始值 + 修订值」合并，修订优先", () => {
  assert.deepEqual(entityFields(card()), { role: "调查员" });
  assert.deepEqual(
    entityFields(card({ overrides: { fields: { role: "教授", state: "受伤" }, updatedAt: "t" } })),
    { role: "教授", state: "受伤" },
  );
});

test("图片修订可以显式清空，也可以只改其他字段而保留原图", () => {
  const withImage = card({
    original: { ...card().original, image: "data:image/png;base64,AAA" },
  });
  assert.equal(entityImage(withImage), "data:image/png;base64,AAA");
  assert.equal(
    entityImage({ ...withImage, overrides: { image: "", updatedAt: "t" } }),
    undefined,
    "修订里出现 image 键表示 KP 主动移除图片",
  );
  assert.equal(
    entityImage({ ...withImage, overrides: { name: "新名", updatedAt: "t" } }),
    "data:image/png;base64,AAA",
  );
});

// ---------------------------------------------------------------- CoC 属性

test("CoC 属性逐字段合并，技能与攻击整体以修订为准", () => {
  const base = card({
    original: {
      ...card().original,
      cocStats: { str: 50, con: 60, skills: [{ name: "侦查", value: 40 }], attacks: [] },
    },
  });
  const original = entityCoCStats(base);
  assert.equal(original.str, 50);
  assert.equal(original.con, 60);

  const merged = entityCoCStats({ ...base, overrides: { cocStats: { str: 90 }, updatedAt: "t" } });
  assert.equal(merged.str, 90);
  assert.equal(merged.con, 60, "未修订的字段应保留原值");
});

test("线索与地点没有 CoC 属性，双方都为空时返回 undefined", () => {
  assert.equal(entityCoCStats(card({ kind: "clue" })), undefined);
  assert.equal(entityCoCStats(card()), undefined);
});

// ---------------------------------------------------------------- 实体构建

test("把分析结果转换成实体卡，带上出处与登场位置", () => {
  const entities = buildProjectEntities(
    project({
      analysis: {
        people: [person("arthur", { name: "卡伦", aliases: ["韦德"], role: "受害者", importance: "core" })],
      },
    }),
  );
  const arthur = entities.find((entity) => entity.ref === "person:arthur");

  assert.ok(arthur);
  assert.equal(arthur.kind, "person");
  assert.equal(arthur.original.name, "卡伦");
  assert.deepEqual(arthur.original.aliases, ["韦德"]);
  assert.equal(arthur.original.fields.role, "受害者");
  assert.deepEqual(arthur.appearances.map((item) => item.sectionKey), ["stage-characters"]);
});

test("模型推断产生的实体标记为未确认", () => {
  const entities = buildProjectEntities(
    project({ analysis: { people: [person("x", { provenance: "inference" })] } }),
  );
  const target = entities.find((entity) => entity.ref === "person:x");
  assert.equal(target.source, "inference");
  assert.equal(target.confirmed, false);
});

test("KP 修订按 ref 挂到对应实体上", () => {
  const entities = buildProjectEntities(
    project({
      analysis: { people: [person("x")] },
      kpNotes: { entityOverrides: { "person:x": { name: "改名", updatedAt: "t" } } },
    }),
  );
  const target = entities.find((entity) => entity.ref === "person:x");
  assert.equal(entityName(target), "改名");
  assert.deepEqual(target.linkBehavior, { jump: true, preview: true });
});

test("人物在幕中的出场会作为额外登场位置", () => {
  const entities = buildProjectEntities(
    project({
      analysis: {
        people: [person("arthur")],
        acts: [{
          id: "act-1", title: "开场", sequence: 1, time: "", personIds: ["arthur"],
          clueIds: [], branches: [], keyEvents: [], description: "",
        }],
      },
    }),
  );
  const arthur = entities.find((entity) => entity.ref === "person:arthur");
  assert.deepEqual(
    arthur.appearances.map((item) => item.sectionKey),
    ["stage-characters", "acts:act-1"],
  );
});

test("没有怪物时不会因为分析结果缺字段而报错", () => {
  const entities = buildProjectEntities(project());
  assert.deepEqual(entities, []);
});

test("KP 新建的实体一并包含在结果里", () => {
  const keeper = card({ ref: "custom:note", id: "note", kind: "custom", source: "keeper" });
  const entities = buildProjectEntities(
    project({ analysis: { people: [person("x")] }, kpNotes: { keeperEntities: [keeper] } }),
  );
  assert.ok(entities.some((entity) => entity.ref === "custom:note"));
});
