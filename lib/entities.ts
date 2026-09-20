import type {
  EntityCard,
  EntityFields,
  EntityKind,
  EntityRelation,
  Person,
  Project,
} from "@/lib/types";

export const ENTITY_KIND_LABELS: Record<EntityKind, string> = {
  person: "人物",
  monster: "怪物 / Boss",
  clue: "线索",
  place: "地点",
  event: "事件",
  custom: "自定义",
};

export const ENTITY_FIELD_LABELS: Record<EntityKind, Array<[string, string]>> = {
  person: [
    ["summary", "人物摘要"], ["role", "角色类型"], ["importance", "重要程度"],
    ["organization", "所属组织"], ["publicIdentity", "公开身份"],
    ["trueIdentity", "真实身份"], ["appearance", "外貌"], ["personality", "性格"],
    ["motivation", "动机"], ["secrets", "秘密"], ["state", "当前状态"],
    ["firstAppearance", "初次登场"], ["performanceHints", "扮演提示"], ["voice", "声音"],
    ["contact", "联系方式"], ["nextAction", "下一步行动"],
  ],
  monster: [
    ["summary", "摘要"], ["monsterType", "类型"], ["threatLevel", "威胁等级"],
    ["appearance", "外貌"], ["abilities", "特殊能力"], ["weaknesses", "弱点"],
    ["tactics", "战术"], ["rewards", "奖励"],
  ],
  clue: [
    ["type", "线索类型"], ["content", "内容"], ["source", "来源"], ["location", "位置"],
    ["holder", "持有者"], ["acquisition", "获取方式"], ["difficulty", "难度"],
    ["targets", "指向"], ["critical", "关键/易错过"], ["truthStatus", "真相状态"],
    ["fallback", "替代获取"], ["misreadHint", "误读提示"], ["bottleneck", "卡关补救"],
    ["downstream", "后续变化"],
  ],
  place: [
    ["type", "地点类型"], ["region", "区域"], ["description", "描述"],
    ["firstImpression", "第一印象"], ["areas", "内部区域"], ["state", "当前状态"],
    ["access", "进入条件"], ["senses", "感官细节"], ["hazards", "危险"],
    ["clues", "相关线索"], ["people", "相关人物"], ["hiddenAreas", "隐藏区域"],
    ["entrances", "出入口"],
  ],
  event: [
    ["type", "事件类型"], ["time", "时间"], ["place", "地点"], ["people", "人物"],
    ["cause", "起因"], ["process", "经过"], ["result", "结果"], ["occurred", "是否发生"],
    ["source", "依据"], ["triggers", "触发条件"], ["ifIntervene", "介入结果"],
    ["ifNot", "不介入结果"], ["clues", "相关线索"], ["consequences", "后果"],
  ],
  custom: [
    ["category", "类别"], ["summary", "摘要"], ["body", "正文"],
    ["status", "状态"], ["customFields", "自定义字段"],
  ],
};

export function entityName(entity: EntityCard) {
  return entity.overrides?.name?.trim() || entity.original.name;
}

export function entityAliases(entity: EntityCard) {
  return entity.overrides?.aliases ?? entity.original.aliases;
}

export function entityFields(entity: EntityCard): EntityFields {
  return { ...entity.original.fields, ...(entity.overrides?.fields ?? {}) };
}

export function entityImage(entity: EntityCard) {
  if (entity.overrides && "image" in entity.overrides) {
    return entity.overrides.image || undefined;
  }
  return entity.original.image;
}

export function entityRef(kind: EntityKind, id: string) {
  return `${kind}:${id}`;
}

export function keeperEntityUri(ref: string, behavior = { jump: true, preview: true }) {
  return `keeper://${ref}?jump=${behavior.jump ? "1" : "0"}&preview=${behavior.preview ? "1" : "0"}`;
}

export function parseKeeperEntityUri(uri: string) {
  if (!uri.startsWith("keeper://")) return null;
  const [ref, query = ""] = uri.slice("keeper://".length).split("?");
  const params = new URLSearchParams(query);
  return {
    ref,
    behavior: {
      jump: params.get("jump") !== "0",
      preview: params.get("preview") !== "0",
    },
  };
}

function card(
  project: Project,
  kind: EntityKind,
  id: string,
  name: string,
  aliases: string[],
  fields: EntityFields,
  sectionKey: string,
  source: EntityCard["source"] = "source",
  cocStats?: EntityCard["original"]["cocStats"],
  image?: string,
  imageSource?: EntityCard["original"]["imageSource"],
): EntityCard {
  const ref = entityRef(kind, id);
  const overrides = project.kpNotes?.entityOverrides?.[ref];
  return {
    ref, id, kind, source, confirmed: source !== "inference",
    original: {
      name, aliases, tags: [], playerVisible: "", keeperPrivate: "", fields,
      cocStats, image, imageSource,
    },
    overrides,
    appearances: [{ sectionKey }],
    linkBehavior: overrides?.linkBehavior ?? { jump: true, preview: true },
    createdAt: project.createdAt,
    updatedAt: overrides?.updatedAt ?? project.updatedAt,
  };
}

export function buildProjectEntities(project: Project): EntityCard[] {
  const actAppearances = (predicate: (act: Project["analysis"]["acts"][number]) => boolean) =>
    project.analysis.acts.filter(predicate).map((act) => ({
      sectionKey: `acts:${act.id}`,
      label: `第 ${act.sequence} 幕 · ${act.title}`,
    }));
  const people = project.analysis.people.map((person) => ({ ...card(
    project, "person", person.id, person.name, person.aliases,
    {
      role: person.role, importance: person.importance, publicIdentity: person.publicIdentity,
      trueIdentity: person.trueIdentity, motivation: person.motivation, secrets: person.secrets,
      organization: person.organization ?? "", summary: person.summary ?? "",
      appearance: person.appearance ?? "", personality: person.personality ?? "",
      state: person.state ?? "", performanceHints: person.performanceHints ?? "",
    },
    "stage-characters", person.provenance === "inference" ? "inference" : "source",
    person.cocStats, person.portrait,
    person.portraitSource === "manual" || person.portraitSource === "extracted"
      ? person.portraitSource
      : undefined,
  ), appearances: [
    { sectionKey: "stage-characters", label: "人物" },
    ...actAppearances((act) => act.personIds.includes(person.id)),
  ] }));
  const monsters = (project.analysis.monsters ?? []).map((monster) => {
    const fields = {
      summary: monster.summary, monsterType: monster.monsterType,
      threatLevel: monster.threatLevel, appearance: monster.appearance ?? "",
      abilities: monster.abilities ?? "", weaknesses: monster.weaknesses ?? "",
      tactics: monster.tactics ?? "", rewards: monster.rewards ?? "",
    };
    const imageSource = monster.portraitSource === "manual" || monster.portraitSource === "extracted"
      ? monster.portraitSource
      : undefined;
    const monsterCard = card(
      project, "monster", monster.id, monster.name, monster.aliases, fields,
      "stage-monsters", monster.provenance === "inference" ? "inference" : "source",
      monster.cocStats, monster.portrait, imageSource,
    );
    return {
      ...monsterCard,
      original: {
        ...monsterCard.original,
        playerVisible: monster.summary,
        keeperPrivate: monster.keeperPrivate ?? "",
      },
      appearances: [
        { sectionKey: "stage-monsters", label: "怪物与 Boss" },
        ...actAppearances((act) => (act.monsterIds ?? []).includes(monster.id)),
      ],
    };
  });
  const clues = project.analysis.clues.map((clue) => ({ ...card(
    project, "clue", clue.id, clue.name, [],
    {
      content: clue.summary, source: clue.source, acquisition: clue.acquisition ?? "",
      targets: clue.targets.map((target) => target.label), critical: clue.importance === "key",
      fallback: clue.fallback ?? "", bottleneck: clue.keeperSuggestion ?? "",
    },
    "stage-clues", clue.provenance === "inference" ? "inference" : "source",
  ), appearances: [
    { sectionKey: "stage-clues", label: "关键线索安排" },
    ...actAppearances((act) => act.clueIds.includes(clue.id)),
  ] }));
  const projectPlaces = project.analysis.places.length > 0
    ? project.analysis.places
    : project.analysis.timePlace?.places ?? [];
  const places = projectPlaces.map((place) => ({ ...card(
    project, "place", place.id, place.name, place.aliases,
    { description: place.description || place.summary, region: place.regionHint ?? "" },
    "stage-timeplace", place.provenance === "inference" ? "inference" : "source",
  ), appearances: [
    { sectionKey: "stage-timeplace", label: "时间地点" },
    ...actAppearances((act) => act.placeId === place.id || (!act.placeId && act.placeText === place.name)),
  ] }));
  const events = project.analysis.acts.flatMap((act) => act.keyEvents.map((event, index) => ({ ...card(
    project, "event", `${act.id}-${index}`, event.title, [],
    { type: event.type, process: event.description, time: act.time, place: act.placeText ?? "" },
    `acts:${act.id}`,
  ), appearances: [{ sectionKey: `acts:${act.id}`, label: `第 ${act.sequence} 幕 · ${act.title}` }] })));
  return [...people, ...monsters, ...clues, ...places, ...events, ...(project.kpNotes?.keeperEntities ?? [])];
}

export function entityCoCStats(entity: EntityCard) {
  if (entity.kind !== "person" && entity.kind !== "monster") return undefined;
  const original = entity.original.cocStats;
  const override = entity.overrides?.cocStats;
  if (!original && !override) return undefined;
  return {
    ...original,
    ...override,
    skills: override?.skills ?? original?.skills,
    attacks: override?.attacks ?? original?.attacks,
    fieldProvenance: {
      ...(original?.fieldProvenance ?? {}),
      ...(override?.fieldProvenance ?? {}),
    },
  };
}

export function buildEntityRelations(project: Project, entities: EntityCard[]): EntityRelation[] {
  const refs = new Set(entities.map((entity) => entity.ref));
  const savedRelations = project.kpNotes?.entityRelations ?? [];
  const replacements = new Map(
    savedRelations.filter((relation) => relation.replacesId).map((relation) => [relation.replacesId!, relation]),
  );
  const relations: EntityRelation[] = savedRelations.filter(
    (relation) => !relation.replacesId && !relation.hidden && refs.has(relation.sourceRef) && refs.has(relation.targetRef),
  );
  const push = (
    id: string,
    sourceRef: string,
    targetRef: string,
    label: string,
    level: EntityRelation["level"] = "direct",
    details: Pick<EntityRelation, "summary" | "importance" | "sources" | "provenance"> = {},
  ) => {
    if (!refs.has(sourceRef) || !refs.has(targetRef)) return;
    const replacement = replacements.get(id);
    if (replacement?.hidden) return;
    const candidate = replacement
      ? { ...replacement, sourceRef: replacement.sourceRef || sourceRef, targetRef: replacement.targetRef || targetRef }
      : { id, sourceRef, targetRef, label, level, ...details };
    if (!relations.some((relation) => relation.id === candidate.id)) {
      relations.push(candidate);
    }
  };
  const semanticPairs = new Set<string>();
  [...(project.analysis.personRelations ?? [])]
    .sort((left, right) => Number(right.importance === "primary") - Number(left.importance === "primary"))
    .forEach((relation) => {
      const sourceRef = entityRef("person", relation.sourcePersonId);
      const targetRef = entityRef("person", relation.targetPersonId);
      const pairKey = [sourceRef, targetRef].sort().join("|");
      if (semanticPairs.has(pairKey)) return;
      semanticPairs.add(pairKey);
      push(
        `model:person-pair:${pairKey}`,
        sourceRef,
        targetRef,
        relation.label,
        relation.provenance === "source" ? "direct" : "inference",
        {
          summary: relation.summary,
          importance: relation.importance,
          sources: relation.sources,
          provenance: relation.provenance,
        },
      );
    });
  project.analysis.acts.forEach((act) => {
    const actRefs = [
      ...act.personIds.map((id) => entityRef("person", id)),
      ...act.clueIds.map((id) => entityRef("clue", id)),
      ...(act.placeId ? [entityRef("place", act.placeId)] : []),
      ...act.keyEvents.map((_, index) => entityRef("event", `${act.id}-${index}`)),
    ].filter((ref, index, all) => refs.has(ref) && all.indexOf(ref) === index);
    actRefs.forEach((sourceRef, sourceIndex) => actRefs.slice(sourceIndex + 1).forEach((targetRef) => {
      if (sourceRef.startsWith("person:") && targetRef.startsWith("person:")) return;
      push(`derived:act:${act.id}:${sourceRef}:${targetRef}`, sourceRef, targetRef, `同见于第 ${act.sequence} 幕`, "indirect", { provenance: "derived" });
    }));
  });
  project.analysis.clues.forEach((clue) => clue.targets.forEach((target) => {
    if (target.type === "person" || target.type === "place" || target.type === "event") {
      push(`derived:clue:${clue.id}:${target.type}:${target.id}`, entityRef("clue", clue.id), entityRef(target.type, target.id), target.label, "direct", { provenance: clue.provenance === "source" ? "source" : "inference" });
    }
  }));
  return relations;
}

export function getRelatedEntities(entityReference: string, project: Project) {
  const entities = buildProjectEntities(project);
  const relatedByRef = new Map(entities.map((entity) => [entity.ref, entity]));
  const sourceEntity = relatedByRef.get(entityReference);
  const candidates = buildEntityRelations(project, entities).flatMap((relation) => {
    if (relation.sourceRef !== entityReference && relation.targetRef !== entityReference) return [];
    const relatedRef = relation.sourceRef === entityReference ? relation.targetRef : relation.sourceRef;
    const entity = relatedByRef.get(relatedRef);
    return entity ? [{ relation, entity }] : [];
  });
  if (sourceEntity?.kind !== "person") return candidates;
  const rank = (relation: EntityRelation) =>
    ({ keeper: 5, direct: 4, inference: 3, indirect: 2 }[relation.level] ?? 0) +
    (relation.importance === "primary" ? 1 : 0);
  const bestByPerson = new Map<string, (typeof candidates)[number]>();
  const others: typeof candidates = [];
  candidates.forEach((candidate) => {
    if (candidate.entity.kind !== "person") {
      others.push(candidate);
      return;
    }
    const previous = bestByPerson.get(candidate.entity.ref);
    if (!previous || rank(candidate.relation) > rank(previous.relation)) {
      bestByPerson.set(candidate.entity.ref, candidate);
    }
  });
  return [...bestByPerson.values(), ...others];
}

export function createKeeperEntity(kind: EntityKind, name: string, sectionKey: string): EntityCard {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  return {
    ref: entityRef(kind, id), id, kind, source: "keeper", confirmed: true,
    original: { name, aliases: [], tags: [], playerVisible: "", keeperPrivate: "", fields: {} },
    appearances: [{ sectionKey }], linkBehavior: { jump: true, preview: true },
    createdAt: now, updatedAt: now,
  };
}

function markdownText(value: string | undefined) {
  return (value ?? "").replace(/\r?\n/g, " ").trim();
}

export function buildCharacterMarkdown(project: Project) {
  const corePeople = project.analysis.people.filter((person) => person.importance === "core");
  const coreCards = corePeople.map((person) => `:::character-card${JSON.stringify({
    ref: entityRef("person", person.id),
    importance: "core",
  })}`);
  const groups: Array<{ importance: Person["importance"]; title: string }> = [
    { importance: "core", title: "核心人物" },
    { importance: "important", title: "重要人物" },
    { importance: "minor", title: "次要人物" },
  ];
  const indexSections = groups.flatMap((group) => {
    const people = project.analysis.people.filter((person) => person.importance === group.importance);
    if (people.length === 0) return [];
    return [
      `### ${group.title}`,
      ...people.map((person) => `- [${markdownText(person.name)}](${keeperEntityUri(entityRef("person", person.id))})${person.role ? `：${markdownText(person.role)}` : ""}`),
    ].join("\n");
  });
  return [
    "# 人物",
    "## 核心人物",
    ...(coreCards.length > 0 ? coreCards : ["暂无核心人物。"]),
    "## 全部人物索引",
    ...indexSections,
  ].join("\n\n");
}

export function buildMonsterMarkdown(project: Project) {
  const bossPeople = project.analysis.people.filter((person) => person.isBoss);
  const refs = [
    ...bossPeople.map((person) => entityRef("person", person.id)),
    ...(project.analysis.monsters ?? []).map((monster) => entityRef("monster", monster.id)),
  ];
  return [
    "# 怪物与 Boss",
    ...(refs.length > 0
      ? refs.map((ref) => `:::character-card${JSON.stringify({ ref, importance: "core" })}`)
      : ["本模组暂无怪物或 Boss。"]),
  ].join("\n\n");
}

export function buildCharacterArcsMarkdown(project: Project) {
  const people = project.analysis.people.filter((person) => person.importance === "core");
  const sections = people.map((person) => {
    const arc = project.analysis.characterArcs?.find((candidate) => candidate.personId === person.id);
    const changes = arc?.motivationChanges;
    const turningPoints = changes?.turningPoints?.length
      ? changes.turningPoints.map((point) => `- ${point}`).join("\n")
      : "待补充";
    return `## ${markdownText(person.name)}

### 成长弧线
${arc?.experience || "待补充"}

### 动机变化
- **初始动机**：${changes?.initial || arc?.motivation || person.motivation || "待补充"}
- **变化节点**：
${turningPoints}
- **最终动机**：${changes?.final || "待补充"}

### 与主线关系
${arc?.mainlineRelation || "待补充"}`;
  });
  return ["# 人物经历与动机", ...sections].join("\n\n");
}

export function buildOpeningHookMarkdown(project: Project) {
  const details = project.analysis.openingHookDetails;
  return `# 开篇钩子

## GM 开场朗读文本
${details?.readAloud || project.analysis.openingHook || "待补充"}

## 玩家初始处境
${details?.initialSituation || "待补充"}

## 第一个冲突触发方式
${details?.firstConflict || "待补充"}

## 氛围与感官描写建议
${details?.atmosphere || "待补充"}

## 导入技巧
${details?.introductionTips || "待补充"}`;
}

export function buildPrologueMarkdown(project: Project) {
  const savedLegacy = project.kpNotes?.sectionMarkdown?.["stage-openingHook"]?.trim();
  const legacy = savedLegacy || buildOpeningHookMarkdown(project);
  const body = legacy
    .replace(/^\s*#\s+开篇钩子\s*/m, "")
    .replace(/^(#{2,6})(\s+)/gm, (_match, marks: string, whitespace: string) =>
      `${"#".repeat(Math.min(6, marks.length + 1))}${whitespace}`,
    )
    .trim();
  return `# 幕\n\n## 序幕\n\n${body || "待补充"}`;
}

export function buildActTitle(originalTitle: string, sequence: number) {
  const title = markdownText(originalTitle);
  if (/^(?:第\s*[一二三四五六七八九十百\d]+\s*幕|序幕|终幕)/.test(title)) return title;
  const safeSequence = Number.isFinite(sequence) && sequence > 0 ? Math.floor(sequence) : 1;
  return title ? `第 ${safeSequence} 幕 · ${title}` : `第 ${safeSequence} 幕`;
}

export function normalizeActMarkdownHierarchy(markdown: string, includeActsHeading: boolean) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
    .filter((line) => !/^#\s+幕\s*$/.test(line.trim()));
  const headingIndexes = lines.flatMap((line, index) => /^#{1,6}\s+\S/.test(line.trim()) ? [index] : []);
  headingIndexes.forEach((lineIndex, headingIndex) => {
    const match = lines[lineIndex].match(/^(#{1,6})(\s+\S.*)$/);
    if (!match) return;
    const level = headingIndex === 0 ? 2 : Math.max(3, match[1].length);
    lines[lineIndex] = `${"#".repeat(Math.min(6, level))}${match[2]}`;
  });
  while (lines[0]?.trim() === "") lines.shift();
  const body = lines.join("\n").replace(/^\s+/, "");
  return `${includeActsHeading ? "# 幕\n\n" : ""}${body}`.trim();
}

function legacyPersonAction(project: Project, actId: string, personId: string) {
  const act = project.analysis.acts.find((candidate) => candidate.id === actId);
  const person = project.analysis.people.find((candidate) => candidate.id === personId);
  if (!act || !person) return null;
  const names = [person.name, ...person.aliases].filter(Boolean);
  const sentences = act.description
    .split(/(?<=[。！？!?])|\r?\n/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && names.some((name) => sentence.includes(name)));
  if (sentences.length === 0) return null;
  return sentences.slice(0, 2).join("");
}

export function buildActMarkdown(project: Project, actId: string, includeActsHeading = false) {
  const act = project.analysis.acts.find((candidate) => candidate.id === actId);
  if (!act) return "# 幕\n\n暂无内容";
  const peopleById = new Map(project.analysis.people.map((person) => [person.id, person]));
  const actions = act.personIds.map((personId) => {
    const person = peopleById.get(personId);
    const explicit = act.personActions?.find((action) => action.personId === personId);
    const legacy = explicit ? null : legacyPersonAction(project, act.id, personId);
    const summary = explicit?.summary || legacy || "本幕无明确行动";
    const provenance = explicit?.provenance ?? (legacy ? "inference" : "none");
    const sourcePages = explicit?.sources.map((source) => source.printedPage || String(source.page)).join("、");
    const provenanceLabel = provenance === "source"
      ? `剧本资料${sourcePages ? `，第 ${sourcePages} 页` : ""}`
      : provenance === "inference" ? "模型归纳" : "无明确行动";
    const name = person?.name || personId;
    const link = person ? `[${name}](${keeperEntityUri(entityRef("person", person.id))})` : name;
    return `- ${link}：${summary}（${provenanceLabel}）`;
  }).join("\n") || "暂无明确人物行动";
  const keyEvents = act.keyEvents.map((event) => `#### ${markdownText(event.title)}\n${event.description}`).join("\n\n") || "暂无关键节点";
  const branches = act.branches.map((branch) => {
    const next = branch.nextActId
      ? project.analysis.acts.find((candidate) => candidate.id === branch.nextActId)?.title || branch.nextActId
      : branch.isEnding ? "结局" : "待定";
    return `- ${branch.condition || "条件待补充"} → ${next}`;
  }).join("\n") || "暂无分支";
  return `${includeActsHeading ? "# 幕\n\n" : ""}## ${buildActTitle(act.title, act.sequence)}

${act.placeText || "地点未定"} · ${act.time || "时间未定"}

### 本幕剧情

${actions}

#### 主要剧情
${act.description || "待补充"}

#### 关键节点
${keyEvents}

#### 分支与结局
${branches}`;
}
