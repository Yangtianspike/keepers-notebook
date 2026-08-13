import type {
  EntityCard,
  EntityFields,
  EntityKind,
  EntityRelation,
  Project,
} from "@/lib/types";

export const ENTITY_KIND_LABELS: Record<EntityKind, string> = {
  person: "人物",
  clue: "线索",
  place: "地点",
  event: "事件",
  custom: "自定义",
};

export const ENTITY_FIELD_LABELS: Record<EntityKind, Array<[string, string]>> = {
  person: [
    ["role", "角色类型"], ["importance", "重要程度"], ["publicIdentity", "公开身份"],
    ["trueIdentity", "真实身份"], ["appearance", "外貌"], ["personality", "性格"],
    ["motivation", "动机"], ["secrets", "秘密"], ["state", "当前状态"],
    ["firstAppearance", "初次登场"], ["performanceHints", "扮演提示"], ["voice", "声音"],
    ["contact", "联系方式"], ["nextAction", "下一步行动"],
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
): EntityCard {
  const ref = entityRef(kind, id);
  const overrides = project.kpNotes?.entityOverrides?.[ref];
  return {
    ref, id, kind, source, confirmed: source !== "inference",
    original: { name, aliases, tags: [], playerVisible: "", keeperPrivate: "", fields },
    overrides,
    appearances: [{ sectionKey }],
    linkBehavior: overrides?.linkBehavior ?? { jump: true, preview: true },
    createdAt: project.createdAt,
    updatedAt: overrides?.updatedAt ?? project.updatedAt,
  };
}

export function buildProjectEntities(project: Project): EntityCard[] {
  const people = project.analysis.people.map((person) => card(
    project, "person", person.id, person.name, person.aliases,
    {
      role: person.role, importance: person.importance, publicIdentity: person.publicIdentity,
      trueIdentity: person.trueIdentity, motivation: person.motivation, secrets: person.secrets,
    },
    "stage-characters", person.provenance === "inference" ? "inference" : "source",
  ));
  const clues = project.analysis.clues.map((clue) => card(
    project, "clue", clue.id, clue.name, [],
    {
      content: clue.summary, source: clue.source, acquisition: clue.acquisition ?? "",
      targets: clue.targets.map((target) => target.label), critical: clue.importance === "key",
      fallback: clue.fallback ?? "", bottleneck: clue.keeperSuggestion ?? "",
    },
    "stage-clues", clue.provenance === "inference" ? "inference" : "source",
  ));
  const projectPlaces = project.analysis.places.length > 0
    ? project.analysis.places
    : project.analysis.timePlace?.places ?? [];
  const places = projectPlaces.map((place) => card(
    project, "place", place.id, place.name, place.aliases,
    { description: place.description || place.summary, region: place.regionHint ?? "" },
    "stage-timeplace", place.provenance === "inference" ? "inference" : "source",
  ));
  const events = project.analysis.acts.flatMap((act) => act.keyEvents.map((event, index) => card(
    project, "event", `${act.id}-${index}`, event.title, [],
    { type: event.type, process: event.description, time: act.time, place: act.placeText ?? "" },
    `acts:${act.id}`,
  )));
  return [...people, ...clues, ...places, ...events, ...(project.kpNotes?.keeperEntities ?? [])];
}

export function buildEntityRelations(project: Project, entities: EntityCard[]): EntityRelation[] {
  const refs = new Set(entities.map((entity) => entity.ref));
  const relations: EntityRelation[] = [...(project.kpNotes?.entityRelations ?? [])];
  const push = (sourceRef: string, targetRef: string, label: string) => {
    if (!refs.has(sourceRef) || !refs.has(targetRef)) return;
    const id = `${sourceRef}>${targetRef}>${label}`;
    if (!relations.some((relation) => relation.id === id)) {
      relations.push({ id, sourceRef, targetRef, label, level: "direct" });
    }
  };
  project.analysis.acts.forEach((act) => {
    act.personIds.forEach((personId) => act.clueIds.forEach((clueId) => {
      push(entityRef("person", personId), entityRef("clue", clueId), `同见于第 ${act.sequence} 幕`);
      push(entityRef("clue", clueId), entityRef("person", personId), `同见于第 ${act.sequence} 幕`);
    }));
  });
  project.analysis.clues.forEach((clue) => clue.targets.forEach((target) => {
    if (target.type === "person" || target.type === "place" || target.type === "event") {
      push(entityRef("clue", clue.id), entityRef(target.type, target.id), target.label);
    }
  }));
  return relations;
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
