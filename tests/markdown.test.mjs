import assert from "node:assert/strict";
import test from "node:test";

import {
  isSafeImageUrl,
  isSafeLinkUrl,
  markdownToEditableHtml,
  parseMarkdown,
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
  assert.equal(isSafeImageUrl("data:image/png;base64,aGVsbG8="), true);
  assert.equal(isSafeImageUrl("blob:http://localhost/id"), false);
  assert.equal(isSafeImageUrl("data:text/html;base64,PHNjcmlwdD4="), false);
});
