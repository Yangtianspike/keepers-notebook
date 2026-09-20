import assert from "node:assert/strict";
import test from "node:test";

import { parseScenarioFile } from "../lib/parser.ts";

function file(name, content) {
  return new File([content], name, { type: "text/plain" });
}

test("不支持的文件类型给出明确错误，而不是静默失败", async () => {
  await assert.rejects(() => parseScenarioFile(file("模组.txt", "内容")), /目前仅支持/);
  await assert.rejects(() => parseScenarioFile(file("模组.rtf", "内容")), /目前仅支持/);
  await assert.rejects(() => parseScenarioFile(file("没有扩展名", "内容")), /目前仅支持/);
});

test("Markdown 按标题分节，标题行保留在所属节内", async () => {
  const parsed = await parseScenarioFile(
    file("模组.md", ["# 简介", "第一段内容。", "## 时间轴", "第二段内容。"].join("\n")),
  );

  assert.equal(parsed.fileType, "markdown");
  assert.equal(parsed.pages.length, 2);
  assert.deepEqual(parsed.skippedTocPages, []);
  assert.deepEqual(
    parsed.chapters.map((chapter) => [chapter.title, chapter.startPage, chapter.endPage]),
    [["简介", 1, 1], ["时间轴", 2, 2]],
  );
});

test("Markdown 没有任何标题时退化成全文", async () => {
  const parsed = await parseScenarioFile(file("模组.md", "只有一段正文。"));

  assert.equal(parsed.pages.length, 1);
  assert.deepEqual(parsed.chapters.map((chapter) => chapter.title), ["全文"]);
});

test("Markdown 的文档正文保留原始内容", async () => {
  const source = "# 简介\n正文内容";
  const parsed = await parseScenarioFile(file("模组.md", source));
  assert.equal(parsed.documentText, source);
});

test(".markdown 扩展名同样被识别", async () => {
  const parsed = await parseScenarioFile(file("模组.markdown", "# 简介\n内容"));
  assert.equal(parsed.fileType, "markdown");
});

test("扩展名大小写不敏感", async () => {
  const parsed = await parseScenarioFile(file("模组.MD", "# 简介\n内容"));
  assert.equal(parsed.fileType, "markdown");
});

test("空文件不会崩溃，退化成空全文", async () => {
  const parsed = await parseScenarioFile(file("模组.md", ""));

  assert.equal(parsed.pages.length, 1);
  assert.equal(parsed.pages[0].pageNumber, 1);
  assert.deepEqual(parsed.chapters.map((chapter) => chapter.title), ["全文"]);
});

test("只有换行符的文件同样安全", async () => {
  const parsed = await parseScenarioFile(file("模组.md", "\n\n\n"));
  assert.equal(parsed.pages.length, 1);
  assert.deepEqual(parsed.chapters.map((chapter) => chapter.title), ["全文"]);
});
