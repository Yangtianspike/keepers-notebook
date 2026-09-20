import assert from "node:assert/strict";
import test from "node:test";

import {
  isSafeImageUrl,
  isSafeLinkUrl,
  markdownToEditableHtml,
  parseMarkdown,
  splitLongText,
} from "../lib/markdown.ts";

test("parses v0.8 Markdown blocks without dropping rich content", () => {
  const blocks = parseMarkdown(`# 标题

###### 六级标题

| 人物 | DEX |
| --- | --- |
| 林墨 | 60 |

![地图](https://example.com/map.png)

:::character-card{"ref":"person:lin-mo","importance":"core"}`);

  assert.deepEqual(blocks.map((block) => block.kind), [
    "heading",
    "heading",
    "table",
    "image",
    "character-card",
  ]);
  assert.equal(blocks[1].level, 6);
  assert.equal(blocks[2].table?.rows[0][1], "60");
  assert.equal(blocks[4].character?.ref, "person:lin-mo");
});

test("editable HTML generation keeps only whitelisted formatting", () => {
  const html = markdownToEditableHtml(
    `**粗体** *斜体* ~~删除~~ <u>下划线</u> <span data-font="kai">楷体</span>\n\n[危险](javascript:alert(1))`,
  );
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<del>删除<\/del>/);
  assert.match(html, /<u>下划线<\/u>/);
  assert.match(html, /data-font="kai"/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("URL allowlists reject active content and transient blob URLs", () => {
  assert.equal(isSafeLinkUrl("keeper://person:lin-mo?jump=1"), true);
  assert.equal(isSafeLinkUrl("javascript:alert(1)"), false);
  assert.equal(isSafeImageUrl("https://example.com/a.png"), true);
  assert.equal(isSafeImageUrl("/relative-image.png"), false);
  assert.equal(isSafeImageUrl("data:image/png;base64,aGVsbG8="), true);
  assert.equal(isSafeImageUrl("blob:http://localhost/id"), false);
  assert.equal(isSafeImageUrl("data:text/html;base64,PHNjcmlwdD4="), false);
});

test("keeps monster and boss card directives instead of leaking them as page text", () => {
  const blocks = parseMarkdown(`:::character-card{"ref":"monster:hounds-of-tindalos","importance":"core"}

:::character-card{"ref":"person:lin-mo","importance":"important"}

普通段落`);

  assert.deepEqual(blocks.map((block) => block.kind), [
    "character-card",
    "character-card",
    "paragraph",
  ]);
  assert.equal(blocks[0].character?.ref, "monster:hounds-of-tindalos");
  assert.equal(blocks[0].character?.importance, "core");
  assert.equal(blocks[1].character?.ref, "person:lin-mo");
});

test("解析有序列表、无序列表、引用与分割线", () => {
  const blocks = parseMarkdown(
    ["- 甲", "- 乙", "", "1. 第一", "2. 第二", "", "> 引用内容", "", "---"].join("\n"),
  );

  assert.deepEqual(blocks.map((block) => block.kind), [
    "unordered-list",
    "ordered-list",
    "quote",
    "divider",
  ]);
  assert.deepEqual(blocks[0].items, ["甲", "乙"]);
  assert.deepEqual(blocks[1].items, ["第一", "第二"]);
  assert.equal(blocks[2].text, "引用内容");
});

test("超长段落被自动拆成多个段落块，避免单块过大", () => {
  const blocks = parseMarkdown("甲".repeat(1200));

  assert.ok(blocks.length > 1);
  blocks.forEach((block) => assert.equal(block.kind, "paragraph"));
  assert.equal(blocks.map((block) => block.text).join(""), "甲".repeat(1200));
});

test("链接白名单只放行 keeper 协议与 http(s)", () => {
  assert.equal(isSafeLinkUrl("keeper://person:a?jump=1"), true);
  assert.equal(isSafeLinkUrl("https://example.com/a"), true);
  assert.equal(isSafeLinkUrl("http://example.com/a"), true);
  assert.equal(isSafeLinkUrl("javascript:alert(1)"), false);
  assert.equal(isSafeLinkUrl("data:text/html;base64,PHNjcmlwdD4="), false);
  assert.equal(isSafeLinkUrl("#相对锚点"), false);
  assert.equal(isSafeLinkUrl(""), false);
});

test("拆长文本优先在标点处断开，拼回后与原文一致", () => {
  const text = "第一句。".repeat(200);
  const parts = splitLongText(text, 100);

  assert.ok(parts.length > 1);
  assert.ok(parts[0].endsWith("。"), "应尽量在句号处断开");
  assert.equal(parts.join(""), text, "切分不应丢失内容");
});

test("短文本不做拆分", () => {
  assert.deepEqual(splitLongText("短文本", 100), ["短文本"]);
  assert.deepEqual(splitLongText("甲".repeat(100), 100), ["甲".repeat(100)]);
});

test("没有可用标点时按长度硬切，仍然不丢内容", () => {
  const text = "甲".repeat(300);
  const parts = splitLongText(text, 100);

  assert.equal(parts.length, 3);
  assert.equal(parts.join(""), text);
});

test("可编辑 HTML 覆盖列表、图片、人物卡与段落", () => {
  const html = markdownToEditableHtml(
    [
      "- 甲",
      "- 乙",
      "",
      "![图](https://example.com/a.png)",
      "",
      ':::character-card{"ref":"person:x","importance":"core"}',
      "",
      "普通段落",
    ].join("\n"),
  );

  assert.match(html, /<ul><li>甲<\/li><li>乙<\/li><\/ul>/);
  assert.match(html, /<img src="https:\/\/example\.com\/a\.png" alt="图">/);
  assert.match(html, /data-keeper-block="character-card"/);
  assert.match(html, /data-ref="person:x"/);
  assert.match(html, /<p>普通段落<\/p>/);
});

test("卡片指令里的 JSON 损坏时退化成普通段落，不影响其他内容", () => {
  const blocks = parseMarkdown(":::character-card{坏掉的 JSON}\n\n正常段落");
  assert.deepEqual(blocks.map((block) => block.kind), ["paragraph", "paragraph"]);
});

