import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptProviderRequest,
  normalizeProviderResponse,
  providerEndpoint,
  providerError,
  providerHeaders,
} from "../lib/provider-adapter.ts";

const messages = [
  { role: "system", content: "system" },
  { role: "user", content: "hello" },
];

const anthropicConfig = { protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude" };
const geminiConfig = { protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-pro" };
const ollamaConfig = { protocol: "ollama", baseUrl: "http://localhost:11434/api", model: "qwen" };
const openaiConfig = { protocol: "openai", baseUrl: "https://api.example.com/v1", model: "m" };

// ---------------------------------------------------------------- 端点构造

test("builds endpoints for the four supported model protocols", () => {
  assert.equal(providerEndpoint({ protocol: "openai", baseUrl: "https://api.example.com/v1", model: "m" }, "k"), "https://api.example.com/v1/chat/completions");
  assert.equal(providerEndpoint({ protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "m" }, "k"), "https://api.anthropic.com/v1/messages");
  assert.match(providerEndpoint({ protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-pro" }, "secret"), /models\/gemini-2.5-pro:generateContent$/);
  assert.equal(providerEndpoint({ protocol: "ollama", baseUrl: "http://localhost:11434/api", model: "qwen" }, ""), "http://localhost:11434/api/chat");
});

test("末尾斜杠不会产生双斜杠", () => {
  assert.equal(providerEndpoint({ ...openaiConfig, baseUrl: "https://api.example.com/v1/" }, "k"), "https://api.example.com/v1/chat/completions");
  assert.equal(providerEndpoint({ ...anthropicConfig, baseUrl: "https://api.anthropic.com/v1/" }, "k"), "https://api.anthropic.com/v1/messages");
});

test("已经带完整路径的地址不会重复拼接", () => {
  assert.equal(
    providerEndpoint({ ...openaiConfig, baseUrl: "https://api.example.com/v1/chat/completions" }, "k"),
    "https://api.example.com/v1/chat/completions",
  );
});

test("向量检索使用 embeddings 路径，且 Gemini 用 embedContent", () => {
  assert.equal(providerEndpoint(openaiConfig, "k", true), "https://api.example.com/v1/embeddings");
  assert.match(providerEndpoint(geminiConfig, "k", true), /:embedContent$/);
  assert.equal(providerEndpoint(ollamaConfig, "", true), "http://localhost:11434/api/embed");
});

test("拒绝非本机的 HTTP 地址", () => {
  assert.throws(
    () => providerEndpoint({ ...openaiConfig, baseUrl: "http://api.example.com/v1" }, "k"),
    /必须使用 HTTPS/,
  );
});

test("允许本机 HTTP 地址，便于连接本地模型", () => {
  assert.equal(providerEndpoint({ ...ollamaConfig, baseUrl: "http://127.0.0.1:11434/api" }, ""), "http://127.0.0.1:11434/api/chat");
});

// ---------------------------------------------------------------- 请求头

test("各协议使用各自的鉴权方式", () => {
  const anthropic = providerHeaders(anthropicConfig, "sk-a");
  assert.equal(anthropic["x-api-key"], "sk-a");
  assert.equal(anthropic["anthropic-version"], "2023-06-01");
  assert.equal(anthropic.Authorization, undefined);

  assert.equal(providerHeaders(geminiConfig, "sk-g")["x-goog-api-key"], "sk-g");

  const ollama = providerHeaders(ollamaConfig, "");
  assert.equal(ollama.Authorization, undefined);
  assert.equal(ollama["Content-Type"], "application/json");

  assert.equal(providerHeaders(openaiConfig, "sk-o").Authorization, "Bearer sk-o");
});

// ---------------------------------------------------------------- 请求适配

test("adapts Anthropic messages and normalizes tool calls", () => {
  const request = adaptProviderRequest({ model: "claude", messages, max_tokens: 100 }, anthropicConfig, "tier1");
  assert.equal(request.system, "system");
  assert.deepEqual(request.messages, [{ role: "user", content: "hello" }]);
  const normalized = normalizeProviderResponse({
    content: [{ type: "tool_use", id: "call-1", name: "ask_user", input: { question: "确认？", context: "冲突" } }],
    stop_reason: "tool_use",
  }, anthropicConfig);
  assert.equal(normalized.choices?.[0]?.message?.tool_calls?.[0]?.function.name, "ask_user");
});

test("Anthropic 把 function 工具改写成 input_schema", () => {
  const request = adaptProviderRequest({
    messages: [{ role: "user", content: "x" }],
    tools: [{ type: "function", function: { name: "ask_user", description: "提问", parameters: { type: "object" } } }],
  }, anthropicConfig, "tier1");

  assert.deepEqual(request.tools, [{ name: "ask_user", description: "提问", input_schema: { type: "object" } }]);
  assert.deepEqual(request.tool_choice, { type: "auto" });
});

test("Anthropic 把工具调用与工具结果转成对应的内容块", () => {
  const request = adaptProviderRequest({
    messages: [
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "ask_user", arguments: '{"question":"q"}' } }] },
      { role: "tool", tool_call_id: "t1", content: "答案" },
    ],
  }, anthropicConfig, "tier1");

  assert.deepEqual(request.messages[0].content, [
    { type: "tool_use", id: "t1", name: "ask_user", input: { question: "q" } },
  ]);
  assert.deepEqual(request.messages[1].content, [
    { type: "tool_result", tool_use_id: "t1", content: "答案" },
  ]);
});

test("Anthropic 工具参数不是合法 JSON 时降级成空对象，不抛错", () => {
  const request = adaptProviderRequest({
    messages: [
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "ask_user", arguments: "{坏" } }] },
    ],
  }, anthropicConfig, "tier1");

  assert.deepEqual(request.messages[0].content[0].input, {});
});

test("Gemini 把 system 拆成 systemInstruction，assistant 映射成 model", () => {
  const request = adaptProviderRequest({
    model: "ignored",
    messages: [
      { role: "system", content: "系统提示" },
      { role: "user", content: "问题" },
      { role: "assistant", content: "回答" },
    ],
    temperature: 0.2,
    max_tokens: 100,
  }, geminiConfig, "tier3");

  assert.deepEqual(request.systemInstruction, { parts: [{ text: "系统提示" }] });
  assert.deepEqual(request.contents, [
    { role: "user", parts: [{ text: "问题" }] },
    { role: "model", parts: [{ text: "回答" }] },
  ]);
  assert.equal(request.generationConfig.temperature, 0.2);
  assert.equal(request.generationConfig.maxOutputTokens, 100);
});

test("Gemini 只在 tier3 强制 JSON 输出", () => {
  const base = { messages: [{ role: "user", content: "x" }] };
  assert.equal(adaptProviderRequest(base, geminiConfig, "tier3").generationConfig.responseMimeType, "application/json");
  assert.equal(adaptProviderRequest(base, geminiConfig, "tier1").generationConfig.responseMimeType, undefined);
});

test("Gemini 没有 system 消息时不生成 systemInstruction", () => {
  const request = adaptProviderRequest({ messages: [{ role: "user", content: "x" }] }, geminiConfig, "tier3");
  assert.equal(request.systemInstruction, undefined);
});

test("Ollama 使用 chat 格式并把 tool 消息降级成 user", () => {
  const request = adaptProviderRequest({
    messages: [
      { role: "user", content: "问题" },
      { role: "tool", content: "工具结果", tool_call_id: "c1" },
    ],
    temperature: 0.3,
    max_tokens: 50,
  }, ollamaConfig, "tier3");

  assert.equal(request.model, "qwen");
  assert.equal(request.stream, false);
  assert.equal(request.options.temperature, 0.3);
  assert.equal(request.options.num_predict, 50);
  assert.equal(request.format, "json");
  assert.deepEqual(request.messages, [
    { role: "user", content: "问题" },
    { role: "user", content: "工具结果" },
  ]);
});

test("Ollama 在非 tier3 模式不强制 JSON 格式", () => {
  const request = adaptProviderRequest({ messages: [{ role: "user", content: "x" }] }, ollamaConfig, "tier1");
  assert.equal(request.format, undefined);
});

test("OpenAI 兼容协议的请求原样传出", () => {
  const payload = { model: "m", messages: [{ role: "user", content: "x" }] };
  assert.deepEqual(adaptProviderRequest(payload, openaiConfig, "tier3"), payload);
});

// ---------------------------------------------------------------- 响应归一化

test("normalizes Gemini and Ollama text responses", () => {
  const gemini = normalizeProviderResponse({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }] }, { protocol: "gemini", baseUrl: "https://example.com", model: "g" });
  assert.equal(gemini.choices?.[0]?.message?.content, '{"ok":true}');
  const ollama = normalizeProviderResponse({ message: { content: '{"ok":true}' }, done: true }, { protocol: "ollama", baseUrl: "http://localhost:11434/api", model: "q" });
  assert.equal(ollama.choices?.[0]?.message?.content, '{"ok":true}');
});

test("Anthropic 的多个文本块被拼接，并保留结束原因", () => {
  const normalized = normalizeProviderResponse({
    content: [{ type: "text", text: "第一段" }, { type: "text", text: "第二段" }],
    stop_reason: "end_turn",
  }, anthropicConfig);

  assert.equal(normalized.choices[0].message.content, "第一段\n第二段");
  assert.equal(normalized.choices[0].finish_reason, "end_turn");
});

test("Anthropic 没有文本块时内容为 null，而不是空字符串", () => {
  const normalized = normalizeProviderResponse({ content: [] }, anthropicConfig);
  assert.equal(normalized.choices[0].message.content, null);
});

test("Gemini 与 Ollama 缺少关键字段时不会抛错", () => {
  assert.equal(normalizeProviderResponse({}, geminiConfig).choices[0].message.content, null);
  assert.equal(normalizeProviderResponse({}, ollamaConfig).choices[0].message.content, null);
});

test("OpenAI 协议的响应原样返回", () => {
  const raw = { choices: [{ message: { content: "x" } }] };
  assert.equal(normalizeProviderResponse(raw, openaiConfig), raw);
});

// ---------------------------------------------------------------- 错误提取

test("从各种上游错误结构里提取消息", () => {
  assert.equal(providerError({ error: "rate limited" }), "rate limited");
  assert.equal(providerError({ error: { message: "Invalid API key" } }), "Invalid API key");
  assert.equal(providerError({}), "模型服务请求失败。");
  assert.equal(providerError({ error: {} }), "模型服务请求失败。");
  assert.equal(providerError({ error: { message: null } }), "模型服务请求失败。");
});
