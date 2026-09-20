/**
 * 真实模组文档解析回归。
 *
 * 模组文件受版权保护、体积也大，不会进入仓库，因此本脚本不参与 `npm test`，
 * 需要用本地文件手动运行：
 *
 *   node scripts/verify-real-docs.mjs [模组目录]
 *
 * 默认目录为 桌面/跑团文件/模组。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mammoth from "mammoth";
import { buildChapters, buildDocxStructure, parseScenarioFile } from "../lib/parser.ts";

const root = process.argv[2] ?? path.join(os.homedir(), "Desktop", "跑团文件", "模组");

function collect(directory) {
  const found = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(pdf|docx)$/i.test(entry.name)) found.push(full);
    }
  }
  return found.sort();
}

async function parse(file) {
  const buffer = fs.readFileSync(file);
  if (/\.pdf$/i.test(file)) {
    const parsed = await parseScenarioFile(new File([buffer], path.basename(file)));
    return { parsed, tocPages: parsed.skippedTocPages };
  }
  // Node 无法解析 mammoth 的浏览器入口（无扩展名 ESM 路径），
  // 这里直接调用解析器的纯函数部分，覆盖的逻辑与 parseDocx 一致。
  const raw = await mammoth.extractRawText({ buffer });
  const lines = raw.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const { pages, outline, hasSections } = buildDocxStructure(lines);
  return {
    parsed: {
      pages,
      chapters: buildChapters(pages, outline, { useTextHeadings: !hasSections }),
    },
    tocPages: hasSections ? ["目录"] : [],
  };
}

const files = collect(root);
if (files.length === 0) {
  console.log(`未在 ${root} 找到 PDF 或 DOCX 文件。`);
  process.exit(0);
}

console.log(`扫描目录: ${root}`);
console.log(`找到 ${files.length} 个文档`);

let failures = 0;

for (const file of files) {
  const size = (fs.statSync(file).size / 1024 / 1024).toFixed(2);
  console.log(`\n=== ${path.basename(file)}  (${size} MB) ===`);
  const started = Date.now();

  try {
    const { parsed, tocPages } = await parse(file);
    const covered = new Set();
    parsed.chapters.forEach((chapter) => {
      for (let page = chapter.startPage; page <= chapter.endPage; page += 1) covered.add(page);
    });
    const missing = [];
    for (let page = 1; page <= parsed.pages.length; page += 1) {
      if (!covered.has(page)) missing.push(page);
    }

    console.log(
      `  单位数 ${parsed.pages.length}   章节数 ${parsed.chapters.length}   用时 ${Date.now() - started} ms`,
    );
    if (tocPages.length > 0) console.log(`  目录标记: ${tocPages.join("、")}`);
    console.log(
      missing.length === 0
        ? `  页覆盖: 完整（${parsed.pages.length}/${parsed.pages.length}）`
        : `  页覆盖: 缺失 ${missing.length} 个 → ${missing.slice(0, 12).join("、")}${missing.length > 12 ? " …" : ""}`,
    );

    for (const [index, chapter] of parsed.chapters.entries()) {
      const flag = chapter.included ? "" : "  [默认不勾选]";
      console.log(
        `    ${String(index + 1).padStart(2, "0")}  ${chapter.title.slice(0, 32).padEnd(34)} ${String(chapter.startPage).padStart(4)} - ${String(chapter.endPage).padStart(4)}${flag}`,
      );
    }

    if (parsed.chapters.length <= 1) {
      console.log("  文本预览（前 12 行），用于判断是否真的没有目录或标题结构:");
      parsed.pages[0].text
        .split("\n")
        .slice(0, 12)
        .forEach((line) => console.log(`    | ${line.slice(0, 68)}`));
    }

    const warnings = [];
    if (parsed.chapters.length <= 1) {
      warnings.push("只识别出一个章节，请确认文档是否包含目录或标题结构");
    }
    if (missing.length > 0) {
      warnings.push("存在没有归属章节的内容，这部分不会进入分析");
    }
    warnings.forEach((warning) => console.log(`  [!] ${warning}`));
  } catch (error) {
    failures += 1;
    console.log(`  解析失败: ${error.message}`);
  }
}

console.log(`\n完成：${files.length - failures} 个成功，${failures} 个失败。`);
