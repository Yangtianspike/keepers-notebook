import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptProviderRequest,
  normalizeProviderResponse,
  providerEndpoint,
} from "../lib/provider-adapter.ts";

const messages = [
  { role: "system", content: "system" },
  { role: "user", content: "hello" },
];

test("builds endpoints for the four supported model protocols", () => {
  assert.equal(providerEndpoint({ protocol: "openai", baseUrl: "https://api.example.com/v1", model: "m" }, "k"), "https://api.example.com/v1/chat/completions");
  assert.equal(providerEndpoint({ protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "m" }, "k"), "https://api.anthropic.com/v1/messages");
  assert.match(providerEndpoint({ protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-pro" }, "secret"), /models\/gemini-2.5-pro:generateContent$/);
  assert.equal(providerEndpoint({ protocol: "ollama", baseUrl: "http://localhost:11434/api", model: "qwen" }, ""), "http://localhost:11434/api/chat");
});

test("adapts Anthropic messages and normalizes tool calls", () => {
  const config = { protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude" };
  const request = adaptProviderRequest({ model: "claude", messages, max_tokens: 100 }, config, "tier1");
  assert.equal(request.system, "system");
  assert.deepEqual(request.messages, [{ role: "user", content: "hello" }]);
  const normalized = normalizeProviderResponse({
    content: [{ type: "tool_use", id: "call-1", name: "ask_user", input: { question: "确认？", context: "冲突" } }],
    stop_reason: "tool_use",
  }, config);
  assert.equal(normalized.choices?.[0]?.message?.tool_calls?.[0]?.function.name, "ask_user");
});

test("normalizes Gemini and Ollama text responses", () => {
  const gemini = normalizeProviderResponse({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }] }, { protocol: "gemini", baseUrl: "https://example.com", model: "g" });
  assert.equal(gemini.choices?.[0]?.message?.content, '{"ok":true}');
  const ollama = normalizeProviderResponse({ message: { content: '{"ok":true}' }, done: true }, { protocol: "ollama", baseUrl: "http://localhost:11434/api", model: "q" });
  assert.equal(ollama.choices?.[0]?.message?.content, '{"ok":true}');
});
