import type {
  DocumentPage,
  PersonCoCStatKey,
  PersonCoCStats,
  SourceRef,
} from "./types";

const NUMERIC_LABELS: Array<[PersonCoCStatKey, string[]]> = [
  ["str", ["力量", "STR"]],
  ["con", ["体质", "CON"]],
  ["siz", ["体型", "SIZ"]],
  ["dex", ["敏捷", "DEX"]],
  ["app", ["外貌", "APP"]],
  ["int", ["灵感", "智力", "INT"]],
  ["pow", ["意志", "POW"]],
  ["edu", ["教育", "EDU"]],
  ["san", ["理智", "SAN"]],
  ["hp", ["HP", "生命值"]],
  ["mp", ["MP", "魔法值"]],
  ["luck", ["幸运", "Luck"]],
  ["mov", ["移动", "MOV"]],
  ["build", ["体格", "Build"]],
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceFor(page: DocumentPage, quote: string): SourceRef {
  return {
    page: page.pageNumber,
    printedPage: page.printedPage,
    quote: quote.replace(/\s+/g, " ").trim().slice(0, 120),
    verified: true,
  };
}

function findStatBlock(page: DocumentPage, names: string[]) {
  const text = page.text.replace(/\u00a0/g, " ");
  let best: { start: number; statStart: number } | null = null;
  names.filter(Boolean).forEach((name) => {
    let start = text.indexOf(name);
    while (start >= 0) {
      const tail = text.slice(start, start + 600);
      const statOffset = tail.search(/(?:力量|STR)\s*[:：]?\s*\d{1,3}/i);
      if (statOffset >= 0 && (!best || statOffset < best.statStart - best.start)) {
        best = { start, statStart: start + statOffset };
      }
      start = text.indexOf(name, start + name.length);
    }
  });
  if (!best) return null;
  const candidate = best as { start: number; statStart: number };
  const remaining = text.slice(candidate.statStart + 10, candidate.start + 2600);
  const nextPerson = remaining.search(/\n[^\n]{2,100}\n\s*(?:力量|STR)\s*[:：]?\s*\d{1,3}/i);
  const end = nextPerson >= 0
    ? candidate.statStart + 10 + nextPerson
    : Math.min(text.length, candidate.start + 2600);
  return text.slice(candidate.start, end);
}

function parsePercentLines(text: string) {
  const values: Array<{ name: string; value: number; damage?: string }> = [];
  const pattern = /([^\n，。；;]{1,32}?)\s*(\d{1,3})\s*%?(?:\s*\([^)]*\))?(?:\s*[，,：:]?\s*伤害\s*([^\n，。；;]+))?/g;
  for (const match of text.matchAll(pattern)) {
    const name = match[1].replace(/^[\s•·\-]+/, "").trim();
    const value = Number(match[2]);
    if (!name || !Number.isFinite(value) || value > 100) continue;
    values.push({ name, value, damage: match[3]?.trim() });
  }
  return values;
}

export function extractExplicitCoCStats(
  pages: DocumentPage[],
  names: string[],
): PersonCoCStats | undefined {
  const matches = pages.flatMap((page) => {
    const block = findStatBlock(page, names);
    return block ? [{ page, block }] : [];
  });
  if (matches.length === 0) return undefined;
  const { page, block } = matches[0];
  const stats: PersonCoCStats = {};
  const fieldProvenance: NonNullable<PersonCoCStats["fieldProvenance"]> = {};
  const mark = (key: PersonCoCStatKey, quote: string) => {
    fieldProvenance[key] = { provenance: "source", sources: [sourceFor(page, quote)] };
  };

  NUMERIC_LABELS.forEach(([key, labels]) => {
    const match = block.match(new RegExp(`(?:${labels.map(escapeRegExp).join("|")})\\s*[:：]?\\s*(-?\\d{1,3})`, "i"));
    if (!match) return;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return;
    (stats as Record<string, unknown>)[key] = value;
    mark(key, match[0]);
  });
  const damageBonus = block.match(/(?:DB|伤害加值)\s*[:：]?\s*([+\-]?\d*D\d+|[+\-]?\d+)/i);
  if (damageBonus) {
    stats.damageBonus = damageBonus[1].toUpperCase();
    mark("damageBonus", damageBonus[0]);
  }
  const armor = block.match(/(?:护甲|Armor)\s*[:：]?\s*([^\s，。；;]+)/i);
  if (armor) {
    stats.armor = armor[1];
    mark("armor", armor[0]);
  }

  const combatStart = block.search(/(?:^|\n)\s*战斗\s*(?:\n|$)/);
  const skillsStart = block.search(/(?:^|\n)\s*技能\s*(?:\n|$)/);
  if (combatStart >= 0) {
    const combatText = block.slice(combatStart, skillsStart > combatStart ? skillsStart : undefined);
    stats.attacks = parsePercentLines(combatText).flatMap((entry) => {
      if (/闪避/.test(entry.name) || !entry.damage) return [];
      return [{
        name: entry.name,
        value: entry.value,
        damage: entry.damage,
        provenance: "source" as const,
        sources: [sourceFor(page, entry.name)],
      }];
    }).slice(0, 8);
    const dodge = parsePercentLines(combatText).find((entry) => /闪避/.test(entry.name));
    if (dodge) {
      stats.skills = [{
        name: "闪避",
        value: dodge.value,
        provenance: "source",
        sources: [sourceFor(page, "闪避")],
      }];
    }
  }
  if (skillsStart >= 0) {
    const skills = parsePercentLines(block.slice(skillsStart)).map((entry) => ({
      name: entry.name,
      value: entry.value,
      provenance: "source" as const,
      sources: [sourceFor(page, entry.name)],
    }));
    stats.skills = [...(stats.skills ?? []), ...skills]
      .filter((skill, index, all) => all.findIndex((candidate) => candidate.name === skill.name) === index)
      .slice(0, 12);
  }
  stats.fieldProvenance = fieldProvenance;
  return Object.keys(fieldProvenance).length > 0 ? stats : undefined;
}

export function mergeExplicitCoCStats(
  generated: PersonCoCStats | undefined,
  explicit: PersonCoCStats | undefined,
): PersonCoCStats | undefined {
  if (!explicit) return generated;
  return {
    ...generated,
    ...explicit,
    skills: explicit.skills?.length ? explicit.skills : generated?.skills,
    attacks: explicit.attacks?.length ? explicit.attacks : generated?.attacks,
    fieldProvenance: {
      ...(generated?.fieldProvenance ?? {}),
      ...(explicit.fieldProvenance ?? {}),
    },
  };
}
