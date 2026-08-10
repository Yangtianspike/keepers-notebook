import type { AnalysisStage } from "./types";

export type ConfirmMode = "tier1" | "tier2" | "tier3";

export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ModelToolCall[];
};

export type ModelToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type AskUserCall = {
  callId: string;
  question: string;
  options: string[];
  context: string;
};

export type ModelStreamEvent =
  | { type: "ask_user"; askUserCall: AskUserCall; content?: string }
  | { type: "content"; content: string }
  | { type: "complete"; data: unknown; content: string };

export type ModelRawResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ModelToolCall[];
    };
  }>;
};

export type ModelRequest = {
  messages: ModelMessage[];
  tools?: typeof ASK_USER_TOOL_DEF[];
  tool_choice?: "auto";
};

export const ASK_USER_TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "ask_user",
    description:
      "当遇到信息冲突、不确定信息、或需要 KP 裁决时暂停分析并询问 KP。",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "向 KP 提出的问题" },
        options: {
          type: "array",
          items: { type: "string" },
          description: "可选的裁决选项",
        },
        context: {
          type: "string",
          description: "为什么需要询问，以及相关原文依据",
        },
      },
      required: ["question", "context"],
    },
  },
};

export const ASK_USER_JSON_INSTRUCTION = `
当你在人物识别或线索分析中遇到信息冲突、不确定信息或需要 KP 裁决时，立即停止当前输出，并且只输出：
<<ASK_USER>>{"question":"向 KP 提出的问题","options":["选项一","选项二"],"context":"需要裁决的原因与原文依据"}<</ASK_USER>>
收到“KP 裁决”消息后，依据裁决继续完成原定 JSON 输出。不要把 ASK_USER 标记放进最终 JSON。`;

function withTier2Instruction(messages: ModelMessage[]): ModelMessage[] {
  const existingSystem = messages.findIndex((message) => message.role === "system");
  if (existingSystem < 0) {
    return [
      { role: "system", content: ASK_USER_JSON_INSTRUCTION.trim() },
      ...messages,
    ];
  }
  return messages.map((message, index) =>
    index === existingSystem
      ? {
          ...message,
          content: `${message.content ?? ""}\n${ASK_USER_JSON_INSTRUCTION}`.trim(),
        }
      : message,
  );
}

export function buildModelRequest(
  stage: AnalysisStage,
  confirmMode: ConfirmMode,
  previousMessages: ModelMessage[] = [],
): ModelRequest {
  const messages =
    previousMessages.length > 0
      ? previousMessages
      : [{ role: "system" as const, content: `当前分析阶段：${stage}` }];
  if (stage !== "characters" && stage !== "clues") return { messages };
  if (confirmMode === "tier1") {
    return { messages, tools: [ASK_USER_TOOL_DEF], tool_choice: "auto" };
  }
  if (confirmMode === "tier2") {
    return { messages: withTier2Instruction(messages) };
  }
  return { messages };
}

function parseJsonContent(content: string): unknown {
  const withoutFence = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end < start) return content;
  try {
    return JSON.parse(withoutFence.slice(start, end + 1));
  } catch {
    return content;
  }
}

function normalizeAskUser(
  callId: string,
  rawArguments: string,
): AskUserCall | null {
  try {
    const parsed = JSON.parse(rawArguments) as Partial<AskUserCall>;
    if (!parsed.question || !parsed.context) return null;
    return {
      callId,
      question: parsed.question,
      options: Array.isArray(parsed.options) ? parsed.options.map(String) : [],
      context: parsed.context,
    };
  } catch {
    return null;
  }
}

export function parseStreamResponse(
  raw: ModelRawResponse,
  confirmMode: ConfirmMode,
): ModelStreamEvent {
  const message = raw.choices?.[0]?.message;
  const content = message?.content ?? "";
  if (confirmMode === "tier1") {
    const toolCall = message?.tool_calls?.find(
      (call) => call.function.name === "ask_user",
    );
    if (toolCall) {
      const askUserCall = normalizeAskUser(
        toolCall.id,
        toolCall.function.arguments,
      );
      if (askUserCall) return { type: "ask_user", askUserCall, content };
    }
  }
  if (confirmMode === "tier2") {
    const match = content.match(/<<ASK_USER>>([\s\S]*?)<<\/ASK_USER>>/);
    if (match) {
      const askUserCall = normalizeAskUser(
        `json-${crypto.randomUUID()}`,
        match[1],
      );
      if (askUserCall) return { type: "ask_user", askUserCall };
    }
  }
  return { type: "complete", data: parseJsonContent(content), content };
}

export function buildContinueRequest(
  callId: string,
  answer: string,
  previousMessages: ModelMessage[],
  confirmMode: ConfirmMode,
): ModelRequest {
  if (confirmMode === "tier1") {
    return {
      messages: [
        ...previousMessages,
        { role: "tool", tool_call_id: callId, content: answer },
      ],
      tools: [ASK_USER_TOOL_DEF],
      tool_choice: "auto",
    };
  }
  return {
    messages: [
      ...previousMessages,
      { role: "user", content: `KP 裁决：${answer}` },
    ],
  };
}
