import assert from "node:assert/strict";
import test from "node:test";

import {
  bm25Search,
  buildChunks,
  hashPages,
  relationRecall,
  stageQuery,
  tokenize,
} from "../lib/retrieval-core.ts";

function chunk(index, text, startPage = index + 1) {
  return {
    id: `p:${index}`,
    projectId: "p",
    index,
    text,
    startPage,
    endPage: startPage,
  };
}

const chunks = [
  chunk(0, "调查员在图书馆的旧档案室里找到了《旧日手记》第九卷残页。"),
  chunk(1, "市政厅的办公室宽敞明亮，墙上挂着城区地图与几幅建设规划图。"),
  chunk(2, "多米克与他的同伙藏在旧钟表店，等待一个访客到来。"),
  chunk(3, "塞耶是一位继承了祖传药方的医生，他依靠秘制药剂维持生命。"),
];

// ---------------------------------------------------------------- 内容哈希

test("页面内容不变时哈希稳定，内容变化时哈希改变", () => {
  const base = [{ pageNumber: 1, text: "甲" }, { pageNumber: 2, text: "乙" }];
  const same = [{ pageNumber: 1, text: "甲" }, { pageNumber: 2, text: "乙" }];
  const changed = [{ pageNumber: 1, text: "甲" }, { pageNumber: 2, text: "丙" }];

  assert.equal(hashPages(base), hashPages(same));
  assert.notEqual(hashPages(base), hashPages(changed));
});

test("页码变化也会改变哈希，避免复用过期索引", () => {
  assert.notEqual(hashPages([{ pageNumber: 1, text: "甲" }]), hashPages([{ pageNumber: 2, text: "甲" }]));
});

test("空页面集合的哈希是稳定的", () => {
  assert.equal(hashPages([]), hashPages([]));
});

// ---------------------------------------------------------------- 文本分块

test("长文本切成带重叠的块，并标出页码范围", () => {
  const pages = [
    { pageNumber: 1, text: "甲".repeat(800) },
    { pageNumber: 2, text: "乙".repeat(800) },
  ];
  const built = buildChunks(pages, "proj");

  assert.ok(built.length >= 2);
  assert.equal(built[0].id, "proj:0");
  assert.equal(built[0].projectId, "proj");
  assert.equal(built[0].index, 0);
  // 相邻块之间保留 50 字重叠，避免关键句被切断
  assert.equal(built[0].text.slice(-50), built[1].text.slice(0, 50));
  // 跨越两页的块要同时标出起止页
  assert.equal(built[0].startPage, 1);
  assert.equal(built[1].endPage, 2);
});

test("图片为主且文字过少的页面不进入索引", () => {
  const built = buildChunks(
    [
      { pageNumber: 1, text: "短", imageHeavy: true },
      { pageNumber: 2, text: "真正的正文内容" },
    ],
    "proj",
  );
  assert.equal(built.length, 1);
  assert.equal(built[0].text, "真正的正文内容");
  assert.equal(built[0].startPage, 2);
});

test("没有可用文本时返回空数组", () => {
  assert.deepEqual(buildChunks([], "proj"), []);
  assert.deepEqual(buildChunks([{ pageNumber: 1, text: "   " }], "proj"), []);
});

// ---------------------------------------------------------------- 分词

test("中文按二元组切分，英文与数字按词切分", () => {
  assert.deepEqual(tokenize("调查员"), ["调查", "查员"]);
  assert.deepEqual(tokenize("FBI agent 1928"), ["fbi", "agent", "1928"]);
});

test("单个中文字符被保留，不会丢词", () => {
  assert.deepEqual(tokenize("我"), ["我"]);
});

test("大小写与多余空白不影响分词结果", () => {
  assert.deepEqual(tokenize("  FBI  \n  调查员 "), tokenize("fbi 调查员"));
});

test("没有可提取内容时返回空数组", () => {
  assert.deepEqual(tokenize("   "), []);
  assert.deepEqual(tokenize("！！！"), []);
});

// ---------------------------------------------------------------- 关键词检索

test("按相关度返回命中的文本块", () => {
  const results = bm25Search(chunks, "图书馆 旧日手记", 5);
  assert.equal(results[0].chunk.id, "p:0");
});

test("结果按分数从高到低排序，且不超过请求条数", () => {
  const results = bm25Search(chunks, "访客 钟表店 塞耶", 2);
  assert.ok(results.length > 0);
  assert.ok(results.length <= 2);
  for (let index = 1; index < results.length; index += 1) {
    assert.ok(results[index - 1].score >= results[index].score);
  }
});

test("完全没有命中时返回空数组", () => {
  assert.deepEqual(bm25Search(chunks, "量子计算机区块链", 5), []);
});

test("空查询与空索引都返回空数组", () => {
  assert.deepEqual(bm25Search(chunks, "", 5), []);
  assert.deepEqual(bm25Search(chunks, "   ", 5), []);
  assert.deepEqual(bm25Search([], "调查员", 5), []);
});

// ---------------------------------------------------------------- 阶段关键词

test("每个分析阶段都有对应的检索关键词", () => {
  const analysis = { people: [] };
  assert.match(stageQuery("background", analysis), /背景/);
  assert.match(stageQuery("timeplace", analysis), /地点/);
  assert.match(stageQuery("characters", analysis), /人物/);
  assert.match(stageQuery("monsters", analysis), /怪物/);
  assert.match(stageQuery("clues", analysis), /线索/);
  assert.match(stageQuery("acts", analysis), /分支/);
});

test("人物相关阶段带上已确认的人物名以提高召回", () => {
  const analysis = { people: [{ name: "卡伦" }, { name: "多米克" }] };
  assert.match(stageQuery("characterArcs", analysis), /卡伦/);
  assert.match(stageQuery("characterArcs", analysis), /多米克/);
  assert.match(stageQuery("acts", analysis), /卡伦/);
});

test("人物列表为空时不会把 undefined 写进查询", () => {
  assert.doesNotMatch(stageQuery("acts", { people: [] }), /undefined|NaN/);
});

// ---------------------------------------------------------------- 关系召回

test("关系召回同时使用人物名与关系词，并且结果不重复", () => {
  const people = [
    { id: "a", name: "多米克", aliases: ["多"], importance: "core" },
    { id: "b", name: "塞耶", aliases: [], importance: "important" },
    { id: "c", name: "无关人物", aliases: [], importance: "minor" },
  ];
  const results = relationRecall(chunks, people, 10);
  const ids = results.map((result) => result.chunk.id);

  assert.equal(new Set(ids).size, ids.length, "同一个块不应重复出现");
  assert.ok(ids.includes("p:2") || ids.includes("p:3"));
});

test("没有人物时不产生召回结果", () => {
  assert.deepEqual(relationRecall(chunks, [], 10), []);
});

test("召回条数受 limit 限制", () => {
  const people = [
    { id: "a", name: "多米克", aliases: [], importance: "core" },
    { id: "b", name: "塞耶", aliases: [], importance: "core" },
  ];
  assert.ok(relationRecall(chunks, people, 1).length <= 1);
});
