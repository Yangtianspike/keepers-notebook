import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChapters,
  buildPageLines,
  collectHeaderNoise,
  detectPrintedPage,
  tocLineIndexesOfPage,
} from "../lib/parser.ts";

const A4_WIDTH = 595;

/** 构造 pdfjs 风格的文本片段。 */
function item(text, x, y, width) {
  return { text, x, y, width: width ?? text.length * 12 };
}

function page(pageNumber, lines) {
  return { pageNumber, text: lines.join("\n") };
}

// ---------------------------------------------------------------- 版面还原

test("双栏页面按「先左栏、后右栏」还原为阅读顺序", () => {
  const segments = [
    item("左栏第一行", 90, 700),
    item("右栏第一行", 320, 700),
    item("左栏第二行", 90, 680),
    item("右栏第二行", 320, 680),
    item("左栏第三行", 90, 660),
    item("右栏第三行", 320, 660),
    item("左栏第四行", 90, 640),
    item("右栏第四行", 320, 640),
  ];

  assert.deepEqual(buildPageLines(segments, A4_WIDTH), [
    "左栏第一行",
    "左栏第二行",
    "左栏第三行",
    "左栏第四行",
    "右栏第一行",
    "右栏第二行",
    "右栏第三行",
    "右栏第四行",
  ]);
});

test("单栏页面保持原顺序，不会被误判成两栏", () => {
  const segments = [
    item("第一行内容", 90, 700),
    item("第二行内容", 90, 680),
    item("第三行内容", 90, 660),
    item("第四行内容", 90, 640),
    item("第五行内容", 90, 620),
  ];

  assert.deepEqual(buildPageLines(segments, A4_WIDTH), [
    "第一行内容",
    "第二行内容",
    "第三行内容",
    "第四行内容",
    "第五行内容",
  ]);
});

test("栏间距小于阈值时不拆分，避免把行内字距当成分栏", () => {
  const segments = [
    item("左甲", 90, 700, 200),
    item("右甲", 298, 700, 200),
    item("左乙", 90, 680, 200),
    item("右乙", 298, 680, 200),
    item("左丙", 90, 660, 200),
    item("右丙", 298, 660, 200),
    item("左丁", 90, 640, 200),
    item("右丁", 298, 640, 200),
  ];

  const lines = buildPageLines(segments, A4_WIDTH);
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "左甲 右甲");
});

test("空页面与单片段页面不会出错", () => {
  assert.deepEqual(buildPageLines([], A4_WIDTH), []);
  assert.deepEqual(buildPageLines([item("只有一行", 90, 700)], A4_WIDTH), ["只有一行"]);
  assert.deepEqual(buildPageLines([item("   ", 90, 700)], A4_WIDTH), []);
});

test("空隙位置偏离页面中部时不判定为分栏", () => {
  // 空隙足够大，但落在页面左侧，属于行内缩进而不是分栏
  const segments = [
    item("短", 20, 700, 12),
    item("后续内容", 120, 700, 48),
    item("短", 20, 680, 12),
    item("后续内容", 120, 680, 48),
    item("短", 20, 660, 12),
    item("后续内容", 120, 660, 48),
    item("短", 20, 640, 12),
    item("后续内容", 120, 640, 48),
  ];

  const lines = buildPageLines(segments, A4_WIDTH);
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "短 后续内容");
});

// ---------------------------------------------------------------- 印刷页码

test("在多数页面顶部重复出现的文本被识别为页眉噪声", () => {
  const pages = Array.from({ length: 10 }, (_, index) =>
    ({ lines: ["1", `正文第${index + 1}页`, String(index + 1)] }),
  );
  assert.deepEqual([...collectHeaderNoise(pages)], ["1"]);
});

test("只在少数页面出现的首行不算噪声", () => {
  const pages = [
    { lines: ["仅此一次", "正文", "1"] },
    { lines: ["另一段", "正文", "2"] },
    { lines: ["第三种", "正文", "3"] },
  ];
  assert.deepEqual([...collectHeaderNoise(pages)], []);
});

test("印刷页码优先取页面底部", () => {
  const noise = new Set(["1"]);
  assert.equal(detectPrintedPage(["1", "正文", "42"], noise), "42");
  assert.equal(detectPrintedPage(["7", "正文"], new Set()), "7");
  assert.equal(detectPrintedPage(["正文", "7"], new Set()), "7");
});

test("首行被判定为页眉噪声后不再当作页码", () => {
  assert.equal(detectPrintedPage(["1", "正文"], new Set(["1"])), undefined);
});

test("页面没有数字行时返回 undefined 而不是错误值", () => {
  assert.equal(detectPrintedPage(["正文", "更多正文"], new Set()), undefined);
  assert.equal(detectPrintedPage([], new Set()), undefined);
});

// ---------------------------------------------------------------- 目录条目

test("连续编号的目录条目被整组排除", () => {
  const lines = [
    "背景和简介",
    "01. 档案检索",
    "02. 人物名录",
    "03. 目击记录",
  ];
  assert.deepEqual([...tocLineIndexesOfPage(lines)].sort((a, b) => a - b), [1, 2, 3]);
});

test("同页正文标题与目录条目文字完全相同时，只排除目录那一条", () => {
  // 这是「第一章凭空消失」那个缺陷的回归用例：
  // 目录条目与正文标题文字一致，用文本做标记会把正文标题一起排掉。
  const lines = [
    "01. 档案检索",
    "02. 人物名录",
    "03. 目击记录",
    "01. 档案检索",
    "调查员们可以调阅档案室的全部索引卡片。",
  ];

  const excluded = tocLineIndexesOfPage(lines);
  assert.deepEqual([...excluded].sort((a, b) => a - b), [0, 1, 2]);
  assert.equal(excluded.has(3), false, "正文标题必须保留");
});

test("命中不足三条时不判定为目录，避免误伤正文", () => {
  const lines = ["01. 档案检索", "02. 人物名录", "普通正文"];
  assert.deepEqual([...tocLineIndexesOfPage(lines)], []);
});

test("没有连续编号但标题行紧邻时，整页按目录处理", () => {
  const lines = [
    "简介",
    "守秘人须知",
    "调查员导入",
    "势力与组织",
    "登场人物",
  ];
  assert.deepEqual([...tocLineIndexesOfPage(lines)].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
});

test("正文里分散的标题不会被误判成目录而整组排除", () => {
  // Word 无目录时整篇内容挤在一页，标题数量虽多但中间夹着正文，
  // 这和目录页「条目连续排列」的特征不同，不能一起排除。
  const lines = [
    "一、文档概览",
    "类型：说明文字。",
    "舞台：某年某月，某城市。",
    "风格：叙事化文体。",
    "二、创建要点",
    "创建建议内容。",
    "三、时间线",
    "时间线内容。",
    "四、结局",
    "结局内容。",
    "五、附录",
    "附录内容。",
  ];
  assert.equal(tocLineIndexesOfPage(lines).size, 0);
});

// ---------------------------------------------------------------- 章节构建

test("完全识别不到标题时生成覆盖全文的单一章节", () => {
  const chapters = buildChapters([page(1, ["纯正文"]), page(2, ["更多正文"])]);
  assert.deepEqual(
    chapters.map((chapter) => [chapter.title, chapter.startPage, chapter.endPage]),
    [["全文", 1, 2]],
  );
});

test("首个标题之前的内容补成「开篇」", () => {
  const chapters = buildChapters([
    page(1, ["封面文字"]),
    page(2, ["故事背景介绍"]),
    page(3, ["登场人物"]),
    page(4, ["人物描述"]),
  ]);

  assert.equal(chapters[0].title, "开篇");
  assert.deepEqual([chapters[0].startPage, chapters[0].endPage], [1, 2]);
  assert.equal(chapters[1].title, "登场人物");
});

test("章节范围首尾相接，不产生空隙也不越界", () => {
  const pages = [
    page(1, ["正文"]),
    page(2, ["简介"]),
    page(3, ["正文"]),
    page(4, ["登场人物"]),
    page(5, ["正文"]),
    page(6, ["正文"]),
  ];
  const chapters = buildChapters(pages);

  chapters.forEach((chapter, index) => {
    const next = chapters[index + 1];
    if (next) assert.equal(chapter.endPage, next.startPage - 1);
  });
  assert.equal(chapters.at(-1).endPage, pages.length);
});

test("参考资料与版权类章节默认不勾选", () => {
  const chapters = buildChapters([
    page(1, ["简介"]),
    page(2, ["正文"]),
    page(3, ["版权信息"]),
  ]);
  const byTitle = Object.fromEntries(chapters.map((chapter) => [chapter.title, chapter.included]));
  assert.equal(byTitle["简介"], true);
  assert.equal(byTitle["版权信息"], false);
});

test("同名标题只保留页码最小的一次", () => {
  const chapters = buildChapters([
    page(1, ["登场人物"]),
    page(2, ["正文"]),
    page(3, ["登场人物"]),
  ]);
  const matched = chapters.filter((chapter) => chapter.title === "登场人物");
  assert.equal(matched.length, 1);
  assert.equal(matched[0].startPage, 1);
});

test("提供目录清单并关闭正文扫描时，章节以目录为准", () => {
  const pages = [page(1, ["第一章内容"]), page(2, ["登场人物"]), page(3, ["正文"])];
  const chapters = buildChapters(pages, [{ title: "第一章", page: 1 }], {
    useTextHeadings: false,
  });
  assert.deepEqual(chapters.map((chapter) => chapter.title), ["第一章"]);
  assert.equal(chapters[0].endPage, 3);
});

test("默认开启正文扫描时，标题会被补充进来", () => {
  const pages = [page(1, ["第一章内容"]), page(2, ["登场人物"]), page(3, ["正文"])];
  const chapters = buildChapters(pages, [{ title: "第一章", page: 1 }]);
  assert.deepEqual(chapters.map((chapter) => chapter.title), ["第一章", "登场人物"]);
});

test("中文序号标题被识别为章节", () => {
  const chapters = buildChapters([
    page(1, ["一、文档概览", "类型：说明文字。", "二、创建要点", "创建建议内容。"]),
  ]);
  assert.deepEqual(
    chapters.map((chapter) => chapter.title),
    ["一、文档概览", "二、创建要点"],
  );
});
