import assert from "node:assert/strict";
import test from "node:test";

import {
  ASK_USER_JSON_INSTRUCTION,
  ASK_USER_TOOL_DEF,
  buildContinueRequest,
  buildModelRequest,
  parseStreamResponse,
} from "../lib/model-adapter.ts";

const askUserToolCall = {
  id: "call-1",
  type: "function",
  function: {
    name: "ask_user",
    arguments: JSON.stringify({
      question: "冲突如何处理？",
      options: ["按甲处理", "按乙处理"],
      context: "原文两处描述不一致",
    }),
  },
};

// ---------------------------------------------------------------- 请求编排

test("tier1 通过 function calling 提供 ask_user 工具", () => {
  const request = buildModelRequest("background", "tier1", [{ role: "system", content: "系统" }]);
  assert.deepEqual(request.tools, [ASK_USER_TOOL_DEF]);
  assert.equal(request.tool_choice, "auto");
});

test("tier2 把 JSON 标记说明追加到已有的 system 消息", () => {
  const request = buildModelRequest("clues", "tier2", [
    { role: "system", content: "系统提示" },
    { role: "user", content: "正文" },
  ]);
  assert.equal(request.messages.length, 2);
  assert.equal(request.messages[0].role, "system");
  assert.match(request.messages[0].content, /系统提示/);
  assert.match(request.messages[0].content, /ASK_USER/);
  assert.equal(request.tools, undefined);
});

test("tier2 在没有 system 消息时补一条说明", () => {
  const request = buildModelRequest("clues", "tier2", [{ role: "user", content: "正文" }]);
  assert.equal(request.messages.length, 2);
  assert.equal(request.messages[0].content, ASK_USER_JSON_INSTRUCTION.trim());
});

test("tier3 不注入任何额外指令或工具", () => {
  const request = buildModelRequest("clues", "tier3", [{ role: "system", content: "系统提示" }]);
  assert.equal(request.messages.length, 1);
  assert.equal(request.messages[0].content, "系统提示");
  assert.equal(request.tools, undefined);
  assert.equal(request.tool_choice, undefined);
});

test("没有历史消息时生成包含阶段名的默认 system 提示", () => {
  const request = buildModelRequest("monsters", "tier3");
  assert.equal(request.messages.length, 1);
  assert.match(request.messages[0].content, /monsters/);
});

// ---------------------------------------------------------------- 响应解析

test("tier1 识别 ask_user 工具调用并暂停", () => {
  const event = parseStreamResponse(
    { choices: [{ message: { content: "", tool_calls: [askUserToolCall] } }] },
    "tier1",
  );
  assert.equal(event.type, "ask_user");
  assert.equal(event.askUserCall.callId, "call-1");
  assert.equal(event.askUserCall.question, "冲突如何处理？");
  assert.deepEqual(event.askUserCall.options, ["按甲处理", "按乙处理"]);
});

test("tier1 工具参数缺少必填字段时回退成普通完成", () => {
  const incomplete = {
    ...askUserToolCall,
    function: { name: "ask_user", arguments: '{"question":"只有问题"}' },
  };
  const event = parseStreamResponse(
    { choices: [{ message: { content: '{"ok":true}', tool_calls: [incomplete] } }] },
    "tier1",
  );
  assert.equal(event.type, "complete");
  assert.deepEqual(event.data, { ok: true });
});

test("tier1 工具参数不是合法 JSON 时回退成普通完成", () => {
  const broken = { ...askUserToolCall, function: { name: "ask_user", arguments: "not-json" } };
  const event = parseStreamResponse(
    { choices: [{ message: { content: "{}", tool_calls: [broken] } }] },
    "tier1",
  );
  assert.equal(event.type, "complete");
});

test("tier1 没有 ask_user 调用时按完成处理", () => {
  const event = parseStreamResponse({ choices: [{ message: { content: '{"a":1}' } }] }, "tier1");
  assert.equal(event.type, "complete");
  assert.deepEqual(event.data, { a: 1 });
});

test("tier2 识别文本形式的 ASK_USER 标记", () => {
  const content = '分析中……\n<<ASK_USER>>{"question":"需要确认","options":["是","否"],"context":"依据不足"}<</ASK_USER>>';
  const event = parseStreamResponse({ choices: [{ message: { content } }] }, "tier2");
  assert.equal(event.type, "ask_user");
  assert.equal(event.askUserCall.question, "需要确认");
  assert.ok(event.askUserCall.callId.startsWith("json-"));
});

test("tier2 缺少 options 时给出空数组而不是崩溃", () => {
  const content = '<<ASK_USER>>{"question":"确认","context":"依据不足"}<</ASK_USER>>';
  const event = parseStreamResponse({ choices: [{ message: { content } }] }, "tier2");
  assert.equal(event.type, "ask_user");
  assert.deepEqual(event.askUserCall.options, []);
});

test("tier2 没有标记时按完成处理并解析 JSON", () => {
  const event = parseStreamResponse({ choices: [{ message: { content: '{"a":1}' } }] }, "tier2");
  assert.equal(event.type, "complete");
  assert.deepEqual(event.data, { a: 1 });
});

test("tier3 忽略工具调用，直接按完成处理", () => {
  const event = parseStreamResponse(
    { choices: [{ message: { content: '{"a":1}', tool_calls: [askUserToolCall] } }] },
    "tier3",
  );
  assert.equal(event.type, "complete");
  assert.deepEqual(event.data, { a: 1 });
});

test("内容带代码围栏或前后说明时仍能取出 JSON", () => {
  const fenced = parseStreamResponse({ choices: [{ message: { content: '```json\n{"a":1}\n```' } }] }, "tier3");
  assert.deepEqual(fenced.data, { a: 1 });
  const wrapped = parseStreamResponse({ choices: [{ message: { content: '结果：{"a":1}（完）' } }] }, "tier3");
  assert.deepEqual(wrapped.data, { a: 1 });
});

test("内容不是 JSON 时把原文作为 data 返回，不抛错", () => {
  const event = parseStreamResponse({ choices: [{ message: { content: "只是一段说明" } }] }, "tier3");
  assert.equal(event.type, "complete");
  assert.equal(event.data, "只是一段说明");
  assert.equal(event.content, "只是一段说明");
});

test("模型没有返回任何 choice 时也能安全处理", () => {
  const event = parseStreamResponse({}, "tier3");
  assert.equal(event.type, "complete");
  assert.equal(event.content, "");
});

// ---------------------------------------------------------------- 继续请求

test("tier1 继续请求把 KP 裁决作为 tool 消息回传", () => {
  const previous = [{ role: "assistant", content: null, tool_calls: [askUserToolCall] }];
  const request = buildContinueRequest("call-1", "按甲处理", previous, "tier1");

  assert.equal(request.messages.length, 2);
  assert.deepEqual(request.messages[1], {
    role: "tool",
    tool_call_id: "call-1",
    content: "按甲处理",
  });
  assert.equal(request.tool_choice, "auto");
});

test("非 tier1 继续请求把 KP 裁决作为普通用户消息", () => {
  const request = buildContinueRequest("call-1", "按甲处理", [{ role: "assistant", content: "？" }], "tier2");
  assert.equal(request.messages.length, 2);
  assert.equal(request.messages[1].role, "user");
  assert.match(request.messages[1].content, /按甲处理/);
  assert.equal(request.tools, undefined);
});

test("继续请求保留原有的历史消息", () => {
  const previous = [
    { role: "system", content: "系统" },
    { role: "user", content: "正文" },
  ];
  const request = buildContinueRequest("c", "答案", previous, "tier2");
  assert.deepEqual(request.messages.slice(0, 2), previous);
});
