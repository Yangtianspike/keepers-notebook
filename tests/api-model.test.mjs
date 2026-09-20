import assert from "node:assert/strict";
import test from "node:test";

let workerPromise;

function loadWorker() {
  if (!workerPromise) {
    const url = new URL("../dist/server/index.js", import.meta.url);
    url.searchParams.set("test", `${process.pid}-${Date.now()}`);
    workerPromise = import(url.href).then((module) => module.default);
  }
  return workerPromise;
}

const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function post(body) {
  const worker = await loadWorker();
  return worker.fetch(
    new Request("http://localhost/api/model", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
    ctx,
  );
}

/** 临时替换全局 fetch，用来模拟上游模型服务。 */
async function withUpstream(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function upstreamJson(payload, status = 200) {
  return async () => new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const openAiConfig = { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" };

// ---------------------------------------------------------------- 参数校验

test("缺少接口地址或模型名时返回 400", async () => {
  const response = await post({ action: "test", apiKey: "k", config: { baseUrl: "", model: "" } });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /接口地址和模型名称/);
});

test("OpenAI 兼容协议缺少 API Key 时返回 400", async () => {
  const response = await post({
    action: "test",
    apiKey: "   ",
    config: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /API Key/);
});

test("本地 Ollama 不需要 API Key", async () => {
  await withUpstream(
    upstreamJson({ message: { content: '{"ok":true}' } }),
    async () => {
      const response = await post({
        action: "test",
        apiKey: "",
        config: { protocol: "ollama", baseUrl: "http://localhost:11434/api", model: "llama3" },
      });
      assert.equal(response.status, 200);
    },
  );
});

test("分析阶段缺少文档时返回 400", async () => {
  const response = await post({
    action: "analyze",
    apiKey: "k",
    stage: "background",
    config: openAiConfig,
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /缺少分析阶段或文档/);
});

test("继续分析缺少必要字段时返回 400", async () => {
  const response = await post({
    action: "continue",
    apiKey: "k",
    stage: "background",
    callId: "c1",
    config: openAiConfig,
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /缺少分析阶段或文档/);
});

test("请求体不是合法 JSON 时返回 500 而不是崩溃", async () => {
  const response = await post("这不是 JSON");
  assert.equal(response.status, 500);
});

test("远程 HTTP 地址被拒绝并给出明确提示", async () => {
  const response = await post({
    action: "test",
    apiKey: "k",
    config: { baseUrl: "http://api.example.com/v1", model: "m" },
  });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /HTTPS/);
});

// ---------------------------------------------------------------- 上游交互

test("连接测试成功时返回解析后的 JSON", async () => {
  await withUpstream(
    upstreamJson({ choices: [{ message: { content: '{"ok":true}' } }] }),
    async () => {
      const response = await post({ action: "test", apiKey: "k", config: openAiConfig });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { data: { ok: true } });
    },
  );
});

test("上游返回错误状态时原样透传错误消息", async () => {
  await withUpstream(
    upstreamJson({ error: { message: "Invalid API key provided" } }, 401),
    async () => {
      const response = await post({ action: "test", apiKey: "bad", config: openAiConfig });
      assert.equal(response.status, 401);
      assert.match((await response.json()).error, /Invalid API key provided/);
    },
  );
});

test("上游返回字符串形式的错误也能读出", async () => {
  await withUpstream(upstreamJson({ error: "rate limited" }, 429), async () => {
    const response = await post({ action: "test", apiKey: "k", config: openAiConfig });
    assert.equal(response.status, 429);
    assert.match((await response.json()).error, /rate limited/);
  });
});

test("网络层异常转成可照做的提示，并附上实际请求地址", async () => {
  await withUpstream(
    async () => { throw new TypeError("fetch failed"); },
    async () => {
      const response = await post({ action: "test", apiKey: "k", config: openAiConfig });
      assert.equal(response.status, 500);
      const payload = await response.json();
      assert.match(payload.error, /无法连接到模型服务地址/);
      assert.match(payload.error, /chat\/completions/);
    },
  );
});

test("模型没有返回可用内容时给出 502 与可读说明", async () => {
  await withUpstream(
    upstreamJson({ choices: [{ finish_reason: "length", message: { content: "" } }] }),
    async () => {
      const response = await post({ action: "test", apiKey: "k", config: openAiConfig });
      assert.equal(response.status, 502);
    },
  );
});

test("模型返回非法 JSON 内容时返回可读错误，而不是当成成功", async () => {
  await withUpstream(
    upstreamJson({ choices: [{ message: { content: "这里没有对象" } }] }),
    async () => {
      const response = await post({ action: "test", apiKey: "k", config: openAiConfig });
      assert.equal(response.status, 500);
      assert.match((await response.json()).error, /JSON/);
    },
  );
});

// ---------------------------------------------------------------- 向量接口

test("Anthropic 与 Gemini 协议直接回不支持向量检索", async () => {
  const anthropic = await post({
    action: "embedTest",
    apiKey: "k",
    embeddingModel: "m",
    config: { protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-3" },
  });
  assert.deepEqual(await anthropic.json(), { supported: false });

  const gemini = await post({
    action: "embedTest",
    apiKey: "k",
    embeddingModel: "m",
    config: { protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-pro" },
  });
  assert.deepEqual(await gemini.json(), { supported: false });
});

test("向量接口不可用时返回 supported:false，不抛错", async () => {
  await withUpstream(upstreamJson({ error: "no embedding" }, 404), async () => {
    const response = await post({
      action: "embedTest",
      apiKey: "k",
      embeddingModel: "text-embedding-3-small",
      config: openAiConfig,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { supported: false });
  });
});

test("向量接口可用时返回维度信息", async () => {
  await withUpstream(
    upstreamJson({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    async () => {
      const response = await post({
        action: "embedTest",
        apiKey: "k",
        embeddingModel: "text-embedding-3-small",
        config: openAiConfig,
      });
      const payload = await response.json();
      assert.equal(payload.supported, true);
      assert.equal(payload.dimensions, 3);
    },
  );
});

test("向量化请求缺少文本时返回 400", async () => {
  const response = await post({
    action: "embed",
    apiKey: "k",
    config: openAiConfig,
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /缺少待向量化文本/);
});
