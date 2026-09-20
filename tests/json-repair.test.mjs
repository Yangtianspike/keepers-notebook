import assert from "node:assert/strict";
import test from "node:test";

import { parseLooseJsonObject } from "../lib/json-repair.ts";

test("解析模型直接返回的干净 JSON", () => {
  assert.deepEqual(parseLooseJsonObject('{"a":1,"b":"x"}'), { a: 1, b: "x" });
});

test("剥离 Markdown 代码围栏与前后说明文字", () => {
  assert.deepEqual(parseLooseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseLooseJsonObject("好的，结果如下：\n```\n{\"a\":1}\n```\n以上。"), { a: 1 });
  assert.deepEqual(parseLooseJsonObject('分析完成。{"a":1}希望有帮助。'), { a: 1 });
});

test("修复尾随逗号", () => {
  assert.deepEqual(parseLooseJsonObject('{"a":1,}'), { a: 1 });
  assert.deepEqual(parseLooseJsonObject('{"a":[1,2,],}'), { a: [1, 2] });
  assert.deepEqual(parseLooseJsonObject('{"a":{"b":2,},}'), { a: { b: 2 } });
});

test("修复被中文弯引号包裹的键与值", () => {
  assert.deepEqual(parseLooseJsonObject('{“a”:“b”}'), { a: "b" });
  assert.deepEqual(
    parseLooseJsonObject('{“人物”:“卡伦”,“地点”:“码头”}'),
    { 人物: "卡伦", 地点: "码头" },
  );
});

test("不擅自替换字符串内容里合法的中文引号", () => {
  // 中文引号出现在字符串内部是合法 JSON，一律替换会破坏原文。
  // 所以只修复「键位置」与「紧跟冒号的完整值」；数组元素里的中文引号不做处理。
  assert.deepEqual(parseLooseJsonObject('{"text":"他说“你好”"}'), { text: "他说“你好”" });
});

test("修复字符串内部的字面换行与制表符", () => {
  assert.deepEqual(parseLooseJsonObject('{"a":"第一行\n第二行"}'), { a: "第一行\n第二行" });
  assert.deepEqual(parseLooseJsonObject('{"a":"前\t后"}'), { a: "前\t后" });
});

test("保留嵌套结构、数组与转义字符", () => {
  assert.deepEqual(parseLooseJsonObject('{"a":{"b":[1,{"c":2}]}}'), { a: { b: [1, { c: 2 }] } });
  assert.deepEqual(parseLooseJsonObject('{"a":"含 \\" 引号"}'), { a: '含 " 引号' });
  assert.deepEqual(parseLooseJsonObject('{"a":null,"b":true,"c":0}'), { a: null, b: true, c: 0 });
});

test("没有 JSON 对象时抛出可读错误，而不是原始位置异常", () => {
  assert.throws(() => parseLooseJsonObject("模型只说了一句话"), /模型没有返回 JSON 对象/);
  assert.throws(() => parseLooseJsonObject(""), /模型没有返回 JSON 对象/);
  assert.throws(() => parseLooseJsonObject("}"), /模型没有返回 JSON 对象/);
});

test("无法修复的内容仍然抛出，不静默返回空对象", () => {
  assert.throws(() => parseLooseJsonObject('{"a": }'));
  assert.throws(() => parseLooseJsonObject('{"a" 1}'));
});
