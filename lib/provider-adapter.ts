import type { ConfirmMode, ModelMessage, ModelRawResponse } from "./model-adapter";
import type { ModelConfig } from "./types";

type OpenAIRequest = {
  model: string;
  messages?: ModelMessage[];
  tools?: Array<{
    type: "function";
    function: { name: string; description: string; parameters: unknown };
  }>;
  tool_choice?: "auto";
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
};

export type ProviderProtocol = NonNullable<ModelConfig["protocol"]>;

export function protocolFor(config: ModelConfig): ProviderProtocol {
  return config.protocol ?? "openai";
}

function safeBaseUrl(baseUrl: string) {
  const parsed = new URL(baseUrl);
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
    throw new Error("接口地址必须使用 HTTPS；本机模型可以使用 localhost。");
  }
  return baseUrl.replace(/\/+$/, "");
}

export function providerEndpoint(
  config: ModelConfig,
  apiKey: string,
  embedding = false,
) {
  const protocol = protocolFor(config);
  const base = safeBaseUrl(config.baseUrl);
  if (protocol === "anthropic") {
    return `${base.replace(/\/messages$/, "")}/messages`;
  }
  if (protocol === "gemini") {
    const root = base.replace(/\/models(?:\/.*)?$/, "");
    const operation = embedding ? "embedContent" : "generateContent";
    return `${root}/models/${encodeURIComponent(config.model)}:${operation}`;
  }
  if (protocol === "ollama") {
    const root = base.replace(/\/(?:chat|embed|embeddings)$/, "");
    return `${root}/${embedding ? "embed" : "chat"}`;
  }
  const path = embedding ? "/embeddings" : "/chat/completions";
  return base.endsWith(path)
    ? base
    : `${base.replace(/\/(?:chat\/completions|embeddings)$/, "")}${path}`;
}

export function providerHeaders(config: ModelConfig, apiKey: string) {
  const protocol = protocolFor(config);
  if (protocol === "anthropic") {
    return {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    } as Record<string, string>;
  }
  if (protocol === "gemini") {
    return { "Content-Type": "application/json", "x-goog-api-key": apiKey } as Record<string, string>;
  }
  if (protocol === "ollama") {
    return { "Content-Type": "application/json" } as Record<string, string>;
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  } as Record<string, string>;
}

function anthropicMessages(messages: ModelMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content ?? "")
    .filter(Boolean)
    .join("\n\n");
  const converted: Array<Record<string, unknown>> = [];
  for (const message of messages.filter((item) => item.role !== "system")) {
    if (message.role === "tool") {
      converted.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: message.tool_call_id, content: message.content ?? "" }],
      });
      continue;
    }
    const content: Array<Record<string, unknown>> = [];
    if (message.content) content.push({ type: "text", text: message.content });
    message.tool_calls?.forEach((call) => {
      let input: unknown = {};
      try { input = JSON.parse(call.function.arguments); } catch { input = {}; }
      content.push({ type: "tool_use", id: call.id, name: call.function.name, input });
    });
    converted.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: content.length === 1 && content[0].type === "text"
        ? content[0].text
        : content,
    });
  }
  return { system, messages: converted };
}

export function adaptProviderRequest(
  request: OpenAIRequest,
  config: ModelConfig,
  confirmMode: ConfirmMode,
) {
  const protocol = protocolFor(config);
  if (protocol === "anthropic") {
    const converted = anthropicMessages(request.messages ?? []);
    return {
      model: config.model,
      system: converted.system || undefined,
      messages: converted.messages,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      tools: request.tools?.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      })),
      tool_choice: request.tools?.length ? { type: "auto" } : undefined,
    };
  }
  if (protocol === "gemini") {
    const messages = request.messages ?? [];
    const system = messages.filter((item) => item.role === "system").map((item) => item.content ?? "").join("\n\n");
    return {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: messages.filter((item) => item.role !== "system").map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content ?? "" }],
      })),
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.max_tokens,
        ...(confirmMode === "tier3" ? { responseMimeType: "application/json" } : {}),
      },
    };
  }
  if (protocol === "ollama") {
    return {
      model: config.model,
      messages: (request.messages ?? []).map((message) => ({
        role: message.role === "tool" ? "user" : message.role,
        content: message.content ?? "",
      })),
      stream: false,
      options: { temperature: request.temperature, num_predict: request.max_tokens },
      ...(confirmMode === "tier3" ? { format: "json" } : {}),
    };
  }
  return request;
}

export function normalizeProviderResponse(raw: Record<string, unknown>, config: ModelConfig): ModelRawResponse & Record<string, unknown> {
  const protocol = protocolFor(config);
  if (protocol === "anthropic") {
    const blocks = Array.isArray(raw.content) ? raw.content as Array<Record<string, unknown>> : [];
    const text = blocks.filter((block) => block.type === "text").map((block) => String(block.text ?? "")).join("\n");
    const toolCalls = blocks.filter((block) => block.type === "tool_use").map((block) => ({
      id: String(block.id ?? crypto.randomUUID()),
      type: "function" as const,
      function: { name: String(block.name ?? ""), arguments: JSON.stringify(block.input ?? {}) },
    }));
    return {
      ...raw,
      choices: [{
        finish_reason: raw.stop_reason ? String(raw.stop_reason) : null,
        message: { content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      }],
    };
  }
  if (protocol === "gemini") {
    const candidates = Array.isArray(raw.candidates) ? raw.candidates as Array<Record<string, unknown>> : [];
    const content = (candidates[0]?.content ?? {}) as Record<string, unknown>;
    const parts = Array.isArray(content.parts) ? content.parts as Array<Record<string, unknown>> : [];
    return {
      ...raw,
      choices: [{
        finish_reason: candidates[0]?.finishReason ? String(candidates[0].finishReason) : null,
        message: { content: parts.map((part) => String(part.text ?? "")).join("\n") || null },
      }],
    };
  }
  if (protocol === "ollama") {
    const message = (raw.message ?? {}) as Record<string, unknown>;
    return {
      ...raw,
      choices: [{
        finish_reason: raw.done ? "stop" : null,
        message: { content: String(message.content ?? "") || null },
      }],
    };
  }
  return raw as ModelRawResponse & Record<string, unknown>;
}

export function providerError(raw: Record<string, unknown>) {
  const error = raw.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "模型服务请求失败。");
  }
  return "模型服务请求失败。";
}
