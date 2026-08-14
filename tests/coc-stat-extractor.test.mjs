import assert from "node:assert/strict";
import test from "node:test";

import {
  extractExplicitCoCStats,
  mergeExplicitCoCStats,
} from "../lib/coc-stat-extractor.ts";

const pages = [{
  pageNumber: 29,
  printedPage: "29",
  text: `弗洛里安·穆勒，达尔多夫的病人 / 同盟联络人
力量 65 体质 55 体型 60 敏捷 55 灵感 60 外貌 45 意志 45 教育 55 理智 40 HP 11 DB +1D4 体格 1 移动 7 MP 9
战斗
斗殴 60% (30/12)，伤害 1D3+1D4
闪避 30% (15/6)
技能
恐吓 55%，聆听 40%，母语(德语) 55%，潜行 35%，心理学 20%，速记 50%。`,
}];

test("Chinese CoC stat blocks override generated inference with cited source values", () => {
  const explicit = extractExplicitCoCStats(pages, ["弗洛里安·穆勒"]);
  assert.equal(explicit?.str, 65);
  assert.equal(explicit?.con, 55);
  assert.equal(explicit?.siz, 60);
  assert.equal(explicit?.int, 60);
  assert.equal(explicit?.hp, 11);
  assert.equal(explicit?.damageBonus, "+1D4");
  assert.equal(explicit?.fieldProvenance?.str?.provenance, "source");
  assert.equal(explicit?.fieldProvenance?.str?.sources?.[0].page, 29);

  const merged = mergeExplicitCoCStats({ str: 50, con: 60 }, explicit);
  assert.equal(merged?.str, 65);
  assert.equal(merged?.con, 55);
});
