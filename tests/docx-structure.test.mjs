import assert from "node:assert/strict";
import test from "node:test";

import { buildChapters, buildDocxStructure } from "../lib/parser.ts";

const docWithToc = [
  "目录",
  "背景和简介……………………………………………1",
  "模组形式………………………………………………3",
  "报纸合集……………………………………12",
  "作者：某人",
  "背景和简介",
  "这是背景内容。",
  "模组形式",
  "这是模组形式内容。",
  "附录：报纸合集",
  "这是报纸内容。",
];

test("Word 文档按目录分节，目录条目本身不进入正文", () => {
  const { pages, outline, hasSections } = buildDocxStructure(docWithToc);

  assert.equal(hasSections, true);
  assert.deepEqual(outline, [
    { title: "背景和简介", page: 2 },
    { title: "模组形式", page: 3 },
    { title: "报纸合集", page: 4 },
  ]);
  assert.equal(pages.length, 4);
  // 第一节之前的内容（目录、作者）单独成一页，交给 buildChapters 补成「开篇」。
  assert.equal(pages[0].text, docWithToc.slice(0, 5).join("\n"));
  assert.equal(pages[1].text, "背景和简介\n这是背景内容。");
  // 目录里的印刷页码要带给正文节，供引用来源显示原文页码。
  assert.deepEqual(
    pages.map((page) => page.printedPage),
    [undefined, "1", "3", "12"],
  );

  const chapters = buildChapters(pages, outline, { useTextHeadings: false });
  assert.deepEqual(
    chapters.map((chapter) => [chapter.title, chapter.startPage, chapter.endPage]),
    [
      ["开篇", 1, 1],
      ["背景和简介", 2, 2],
      ["模组形式", 3, 3],
      ["报纸合集", 4, 4],
    ],
  );
});

test("Word 没有目录时回退成单页，交给正文正则处理", () => {
  const { pages, outline, hasSections } = buildDocxStructure(["简介", "内容", "登场人物", "内容"]);

  assert.equal(hasSections, false);
  assert.deepEqual(outline, []);
  assert.equal(pages.length, 1);

  const chapters = buildChapters(pages, outline, { useTextHeadings: true });
  assert.deepEqual(chapters.map((chapter) => chapter.title), ["简介", "登场人物"]);
});

test("正文标题只接受冒号结尾的极短前缀，避免「最终结局」误匹配目录里的「结局」", () => {
  const { outline } = buildDocxStructure([
    "目录",
    "结局……………………………………………………1",
    "背景和简介…………………………………………2",
    "报纸合集…………………………………………5",
    "最终结局",
    "某段正文",
    "背景和简介",
    "另一段正文",
    "附录：报纸合集",
    "报纸内容",
  ]);

  // 「结局」在正文里没有同名标题行（「最终结局」的前缀不以冒号结尾），因此被忽略。
  assert.deepEqual(outline, [
    { title: "背景和简介", page: 2 },
    { title: "报纸合集", page: 3 },
  ]);
});
