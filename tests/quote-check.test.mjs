import assert from "node:assert/strict";
import test from "node:test";

import {
  flagUnverifiedSourceRefs,
  normalizeQuote,
  verifySourceRefs,
} from "../lib/quote-check.ts";

const pages = [
  { pageNumber: 1, text: "调查员在图书馆找到了《旧日手记》第九卷的残页。" },
  { pageNumber: 2, text: "卡伦·韦德的尸体被发现于雾角号上一间完全封闭的房间内。" },
  { pageNumber: 3, text: "警方认定死因疑似为大型猛兽袭击，船上却找不到任何大型动物。" },
];

test("规范化引用时忽略空白、标点、大小写与全角差异", () => {
  assert.equal(normalizeQuote("卡伦 · 韦德"), normalizeQuote("卡伦韦德"));
  assert.equal(normalizeQuote("ＡＢＣ１２３"), "abc123");
  assert.equal(normalizeQuote("ABC-123"), "abc123");
  assert.equal(normalizeQuote("“你好，”"), normalizeQuote("你好"));
});

test("命中原文的引用不产生问题", () => {
  const data = { sources: [{ quote: "尸体被发现于雾角号上一间完全封闭的房间内", page: 2 }] };
  assert.deepEqual(verifySourceRefs(data, pages), []);
});

test("引文与原文只差标点或空格时仍然命中", () => {
  const data = { sources: [{ quote: "警方认定死因疑似为大型猛兽袭击！！", page: 3 }] };
  assert.deepEqual(verifySourceRefs(data, pages), []);
});

test("允许页码存在一页误差", () => {
  const data = { sources: [{ quote: "尸体被发现于雾角号上一间完全封闭的房间内", page: 1 }] };
  assert.deepEqual(verifySourceRefs(data, pages), []);
});

test("引文与原文不符时报告问题，并带出所在路径", () => {
  const data = {
    people: [
      { name: "甲", sources: [{ quote: "这段文字在剧本里根本没有出现过", page: 2 }] },
    ],
  };
  const issues = verifySourceRefs(data, pages);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].page, 2);
  assert.equal(issues[0].path, "$.people[0]");
});

test("递归检查嵌套结构中的全部来源", () => {
  const data = {
    people: [{ sources: [{ quote: "大型猛兽袭击", page: 3 }] }],
    acts: [
      { clues: [{ sources: [{ quote: "这一句也不存在于原文任何位置", page: 1 }] }] },
    ],
  };
  const issues = verifySourceRefs(data, pages);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].path, "$.acts[0].clues[0]");
});

test("空引文直接跳过，不产生误报", () => {
  assert.deepEqual(verifySourceRefs({ sources: [{ quote: "   ", page: 1 }] }, pages), []);
  assert.deepEqual(verifySourceRefs({ sources: [{ quote: "", page: 1 }] }, pages), []);
});

test("缺少 quote 或 page 字段的来源不会被当成引用处理", () => {
  assert.deepEqual(verifySourceRefs({ sources: [{ page: 1 }, { quote: "无页码" }] }, pages), []);
});

test("没有来源的数据不报错", () => {
  assert.deepEqual(verifySourceRefs({ a: 1, b: "文本" }, pages), []);
  assert.deepEqual(verifySourceRefs(null, pages), []);
  assert.deepEqual(verifySourceRefs([], pages), []);
});

test("空页面集合下，任何非空引文都会被标记为未通过", () => {
  const issues = verifySourceRefs({ sources: [{ quote: "任意内容", page: 1 }] }, []);
  assert.equal(issues.length, 1);
});

test("把未通过校验的来源标记为 verified:false，不动其他来源", () => {
  const data = {
    sources: [
      { quote: "完全不存在的一句话内容", page: 2 },
      { quote: "大型猛兽袭击", page: 3 },
    ],
  };
  const issues = verifySourceRefs(data, pages);
  flagUnverifiedSourceRefs(data, issues);
  assert.equal(data.sources[0].verified, false);
  assert.equal(data.sources[1].verified, undefined);
});

test("在同一引用重复出现时，只标记实际未通过的那一条", () => {
  const data = {
    a: { sources: [{ quote: "完全不存在的一句话内容", page: 2 }] },
    b: { sources: [{ quote: "大型猛兽袭击", page: 3 }] },
  };
  flagUnverifiedSourceRefs(data, verifySourceRefs(data, pages));
  assert.equal(data.a.sources[0].verified, false);
  assert.equal(data.b.sources[0].verified, undefined);
});
