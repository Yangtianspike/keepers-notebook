import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActMarkdown,
  buildActTitle,
  buildCharacterMarkdown,
  buildMonsterMarkdown,
  buildOpeningHookMarkdown,
  buildPrologueMarkdown,
  buildProjectEntities,
  getRelatedEntities,
  normalizeActMarkdownHierarchy,
} from "../lib/entities.ts";

const project = {
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  analysis: {
    people: [
      { id: "core", name: "林墨", aliases: [], importance: "core", motivation: "追查真相" },
      { id: "minor", name: "老张", aliases: [], importance: "minor", motivation: "自保" },
    ],
    openingHook: "旧版开场摘要",
    clues: [{ id: "ledger", name: "账本", summary: "被涂改的账本", source: "咖啡馆", importance: "key", targets: [], provenance: "source" }],
    places: [],
    openingHookDetails: { readAloud: "雨落在窗沿。", initialSituation: "调查员同处咖啡馆。" },
    personRelations: [{
      id: "core-leads-minor",
      sourcePersonId: "core",
      targetPersonId: "minor",
      label: "指挥调查",
      summary: "林墨要求老张监视咖啡馆。",
      importance: "primary",
      provenance: "source",
      sources: [{ page: 12, quote: "林墨让老张留在门口" }],
    }],
    acts: [{
      id: "act-1",
      title: "咖啡馆",
      sequence: 1,
      placeText: "罗马式咖啡馆",
      time: "深夜",
      personIds: ["core", "minor"],
      clueIds: ["ledger"],
      branches: [],
      keyEvents: [],
      description: "林墨翻看账本。老张没有采取行动。",
      personActions: [{
        personId: "core",
        summary: "翻看账本并发现涂改。",
        provenance: "source",
        sources: [{ page: 12, quote: "林墨翻开账本" }],
      }],
    }],
  },
};

test("act titles preserve explicit prefixes and never infer a prologue from position", () => {
  assert.equal(buildActTitle("序幕 · 来信", 1), "序幕 · 来信");
  assert.equal(buildActTitle("第 1 幕 · 咖啡馆", 1), "第 1 幕 · 咖啡馆");
  assert.equal(buildActTitle("终幕", 9), "终幕");
  assert.equal(buildActTitle("咖啡馆", 1), "第 1 幕 · 咖啡馆");
  assert.equal(buildActTitle("", 2), "第 2 幕");
});

test("character template stores entity references instead of duplicated fields", () => {
  const markdown = buildCharacterMarkdown(project);
  assert.match(markdown, /person:core/);
  assert.match(markdown, /person:minor/);
  assert.equal(markdown.match(/:::character-card/g)?.length, 1);
  assert.match(markdown, /## 全部人物索引/);
  assert.doesNotMatch(markdown, /追查真相|自保/);
});

test("opening and act templates use structured analysis with legacy fallbacks", () => {
  const opening = buildOpeningHookMarkdown(project);
  assert.match(opening, /## GM 开场朗读文本\n雨落在窗沿。/);
  assert.match(opening, /## 导入技巧\n待补充/);
  const prologue = buildPrologueMarkdown(project);
  assert.match(prologue, /^# 幕\n\n## 序幕/m);
  assert.match(prologue, /### GM 开场朗读文本\n雨落在窗沿。/);
  assert.doesNotMatch(prologue, /^# 开篇钩子/m);

  const act = buildActMarkdown(project, "act-1", true);
  assert.match(act, /^# 幕\n\n## 第 1 幕 · 咖啡馆/m);
  assert.match(act, /林墨.*翻看账本并发现涂改.*剧本资料，第 12 页/);
  assert.match(act, /老张.*没有采取行动.*模型归纳/);
  assert.match(act, /### 本幕剧情/);
});

test("human bosses are referenced while monsters use the same core-card directive", () => {
  const monsterProject = structuredClone(project);
  monsterProject.analysis.people[0].isBoss = true;
  monsterProject.analysis.monsters = [{
    id: "hound",
    name: "无名猎兽",
    aliases: [],
    monsterType: "神话生物",
    threatLevel: "极高",
    summary: "从裂隙中现身。",
    confidence: 1,
    provenance: "source",
    sources: [],
    cocStats: { str: 90, attacks: [{ name: "撕咬", value: 70, damage: "1D8", provenance: "source" }] },
  }];
  monsterProject.analysis.acts[0].monsterIds = ["hound"];
  const markdown = buildMonsterMarkdown(monsterProject);
  assert.match(markdown, /person:core/);
  assert.match(markdown, /monster:hound/);
  assert.equal(markdown.match(/:::character-card/g)?.length, 2);
  const entities = buildProjectEntities(monsterProject);
  assert.equal(entities.filter((entity) => entity.ref === "person:core").length, 1);
  assert.deepEqual(
    entities.find((entity) => entity.ref === "monster:hound")?.appearances.map((item) => item.sectionKey),
    ["stage-monsters", "acts:act-1"],
  );
});

test("legacy saved act markdown is grouped below one acts heading", () => {
  assert.equal(
    normalizeActMarkdownHierarchy("# 第 1 幕 · 旧标题\n\n## 场景", true),
    "# 幕\n\n## 第 1 幕 · 旧标题\n\n### 场景",
  );
  assert.equal(
    normalizeActMarkdownHierarchy("# 第二幕 · 后续\n\n正文", false),
    "## 第二幕 · 后续\n\n正文",
  );
  assert.equal(
    normalizeActMarkdownHierarchy("# 幕\n\n## 第 1 幕 · 新标题", true),
    "# 幕\n\n## 第 1 幕 · 新标题",
  );
});

test("entity appearances use semantic person relations without same-act labels", () => {
  const entities = buildProjectEntities(project);
  const core = entities.find((entity) => entity.ref === "person:core");
  assert.deepEqual(core?.appearances.map((appearance) => appearance.sectionKey), ["stage-characters", "acts:act-1"]);
  const related = getRelatedEntities("person:core", project);
  const relatedRefs = related.map((item) => item.entity.ref);
  assert.ok(relatedRefs.includes("person:minor"));
  assert.ok(relatedRefs.includes("clue:ledger"));
  assert.equal(related.find((item) => item.entity.ref === "person:minor")?.relation.label, "指挥调查");
  assert.ok(!related.some((item) => item.entity.kind === "person" && item.relation.label?.includes("同见于")));
});
