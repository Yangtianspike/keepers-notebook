export type Provenance = "source" | "inference" | "keeper" | "conflict";

export type SourceRef = {
  page: number;
  printedPage?: string;
  chapter?: string;
  quote: string;
  verified?: boolean;
};

export type Chapter = {
  id: string;
  title: string;
  startPage: number;
  endPage: number;
  included: boolean;
};

export type DocumentPage = {
  pageNumber: number;
  printedPage?: string;
  text: string;
  imageHeavy?: boolean;
};

export type TextChunk = {
  id: string;
  projectId: string;
  index: number;
  text: string;
  startPage: number;
  endPage: number;
};

export type StoryOverview = {
  oneLine: string;
  cause: string;
  history: string;
  currentState: string;
  plans: Array<{ faction: string; plan: string }>;
  endings: string[];
  externalDependencies: string[];
  conflicts: Array<{
    summary: string;
    options: string[];
    sources: SourceRef[];
  }>;
};

export type Person = {
  id: string;
  name: string;
  aliases: string[];
  role: string;
  importance: "core" | "important" | "minor";
  publicIdentity: string;
  trueIdentity: string;
  motivation: string;
  secrets: string[];
  confidence: number;
  provenance: Provenance;
  sources: SourceRef[];
  organization?: string;
  portrait?: string;
  portraitSource?: "manual" | "extracted" | "generated";
  summary?: string;
  appearance?: string;
  personality?: string;
  state?: string;
  performanceHints?: string;
  cocStats?: PersonCoCStats;
  isBoss?: boolean;
};

export type PersonCoCStatKey =
  | "str" | "con" | "siz" | "dex" | "app" | "int" | "pow" | "edu"
  | "hp" | "mp" | "san" | "luck" | "mov" | "build"
  | "damageBonus" | "armor";

export type CoCValueProvenance = {
  provenance: "source" | "inference";
  sources?: SourceRef[];
};

export type PersonCoCStats = {
  str?: number;
  con?: number;
  siz?: number;
  dex?: number;
  app?: number;
  int?: number;
  pow?: number;
  edu?: number;
  hp?: number;
  mp?: number;
  san?: number;
  luck?: number;
  mov?: number;
  build?: number;
  damageBonus?: string;
  armor?: string;
  skills?: Array<{
    name: string;
    value: number;
    provenance: "source" | "inference" | "keeper";
    sources?: SourceRef[];
  }>;
  attacks?: Array<{
    name: string;
    value?: number;
    damage: string;
    range?: string;
    attacksPerRound?: string;
    provenance: "source" | "inference" | "keeper";
    sources?: SourceRef[];
  }>;
  fieldProvenance?: Partial<Record<PersonCoCStatKey, CoCValueProvenance>>;
};

export type Monster = {
  id: string;
  name: string;
  aliases: string[];
  monsterType: string;
  threatLevel: string;
  summary: string;
  appearance?: string;
  abilities?: string;
  weaknesses?: string;
  tactics?: string;
  rewards?: string;
  keeperPrivate?: string;
  confidence: number;
  provenance: Provenance;
  sources: SourceRef[];
  portrait?: string;
  portraitSource?: "manual" | "extracted" | "generated";
  cocStats?: PersonCoCStats;
};

export type Place = {
  id: string;
  name: string;
  aliases: string[];
  summary: string;
  description?: string;
  regionHint?: string;
  confirmed: boolean;
  provenance: Provenance;
  sources: SourceRef[];
};

export type AtlasMap = {
  id: string;
  name: string;
  imageKey: string;
  width: number;
  height: number;
  createdAt: string;
};

export type MapMarker = {
  id: string;
  mapId: string;
  placeId: string;
  x: number;
  y: number;
};

export type Relation = {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  type: "real" | "hidden";
  confidence: number;
  sources: SourceRef[];
};

export type TimelineEvent = {
  id: string;
  title: string;
  date: string;
  summary: string;
  kind: "history" | "present" | "default" | "branch";
  parentId?: string;
  trigger?: string;
  outcome?: string;
  confidence: number;
  provenance: Provenance;
  sources: SourceRef[];
};

export type ClueTarget = {
  id: string;
  type: "person" | "place" | "event" | "truth";
  label: string;
  priority: "primary" | "secondary";
  confirmed?: boolean;
};

export type Clue = {
  id: string;
  name: string;
  summary: string;
  source: string;
  acquisition?: string;
  missCondition?: string;
  importance: "key" | "secondary" | "other";
  targets: ClueTarget[];
  fallback?: string;
  risk?: string;
  keeperSuggestion?: string;
  confidence: number;
  provenance: Provenance;
  sources: SourceRef[];
};

export type TimePlace = {
  timeline: string;
  places: Place[];
};

export type CharacterArc = {
  personId: string;
  experience: string;
  motivation: string;
  motivationChanges?: {
    initial: string;
    turningPoints: string[];
    final: string;
  };
  mainlineRelation?: string;
};

export type OpeningHookDetails = {
  readAloud?: string;
  initialSituation?: string;
  firstConflict?: string;
  atmosphere?: string;
  introductionTips?: string;
};

export type CoCStats = {
  str?: number;
  con?: number;
  dex?: number;
  int?: number;
  pow?: number;
  hp?: number;
  sanLoss?: string;
  mp?: number;
};

export type KeyEvent = {
  title: string;
  type: "boss" | "death" | "revelation" | "checkpoint";
  description: string;
  stats?: CoCStats;
};

export type ActBranch = {
  id: string;
  condition: string;
  nextActId?: string;
  isEnding?: boolean;
  endingType?: "good" | "bad" | "neutral";
};

export type Act = {
  id: string;
  title: string;
  sequence: number;
  placeId?: string;
  placeText?: string;
  time: string;
  personIds: string[];
  monsterIds?: string[];
  clueIds: string[];
  branches: ActBranch[];
  keyEvents: KeyEvent[];
  description: string;
  personActions?: ActPersonAction[];
};

export type ActPersonAction = {
  personId: string;
  summary: string;
  provenance: "source" | "inference" | "none";
  sources: SourceRef[];
};

export type PersonRelation = {
  id: string;
  sourcePersonId: string;
  targetPersonId: string;
  label: string;
  summary: string;
  importance: "primary" | "secondary";
  provenance: "source" | "inference";
  sources: SourceRef[];
};

export type ChapterSummary = {
  chapterId: string;
  background: string;
  timeAndPlace: string;
  coreCharacters: string;
  characterArcs: string;
  openingHook: string;
  clueArrangements: Array<{
    name: string;
    acquisition: string;
    leadsTo: string;
  }>;
  acts: Array<{ actId: string; title: string; summary: string }>;
  keyEvents: KeyEvent[];
};

export type ReviewItem = {
  id: string;
  type: "merge" | "relation" | "event" | "conflict" | "external" | "quote" | "place";
  severity: "warning" | "critical";
  title: string;
  description: string;
  candidateNames?: string[];
  status: "pending" | "accepted" | "rejected";
  sources: SourceRef[];
  keeperNote?: string;
  applyToAnalysis?: boolean;
  appliedAt?: string;
  proposal?:
    | { kind: "clueTruth"; clueId: string; targetId: string }
    | { kind: "placeConfirm"; placeId: string };
  stage?: AnalysisStage;
};

export type AnalysisStage =
  | "background"
  | "timeplace"
  | "characters"
  | "characterArcs"
  | "clues"
  | "acts";

export type StageState = {
  status: "idle" | "running" | "paused" | "complete" | "error";
  error?: string;
  updatedAt?: string;
};

export type AnalysisLogEntry = {
  id: string;
  stage: AnalysisStage;
  kind: "started" | "progress" | "checkpoint" | "paused" | "completed" | "error";
  message: string;
  createdAt: string;
};

export type ProjectAnalysis = {
  overview?: StoryOverview;
  timePlace?: TimePlace;
  people: Person[];
  monsters?: Monster[];
  unresolvedRelationCount: number;
  characterArcs?: CharacterArc[];
  personRelations?: PersonRelation[];
  openingHook?: string;
  openingHookDetails?: OpeningHookDetails;
  clues: Clue[];
  acts: Act[];
  chapterSummaries: ChapterSummary[];
  places: Place[];
  maps: AtlasMap[];
  markers: MapMarker[];
  reviewItems: ReviewItem[];
  activityLog: AnalysisLogEntry[];
  stages: Record<AnalysisStage, StageState>;
  pendingAskUserCall?: {
    stage: AnalysisStage;
    callId: string;
    question: string;
    options: string[];
    context: string;
    previousMessages: Array<{
      role: "system" | "user" | "assistant" | "tool";
      content: string | null;
      tool_call_id?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }>;
  };
};

export type KPNotes = {
  stageViewOverrides?: Record<string, Record<string, string>>;
  actViewOverrides?: Record<string, Record<string, string>>;
  sectionNotes?: Record<string, KPNoteBlock[]>;
  sectionMarkdown?: Record<string, string>;
  entityOverrides?: Record<string, EntityOverrides>;
  keeperEntities?: EntityCard[];
  entityRelations?: EntityRelation[];
  sectionTemplateVersion?: number;
};

export type EntityKind = "person" | "monster" | "clue" | "place" | "event" | "custom";
export type EntitySource = "source" | "inference" | "keeper";
export type EntityRelationLevel = "direct" | "indirect" | "inference" | "keeper";

export type EntityLinkBehavior = {
  jump: boolean;
  preview: boolean;
};

export type EntityAppearance = {
  sectionKey: string;
  label?: string;
};

export type EntityRelation = {
  id: string;
  sourceRef: string;
  targetRef: string;
  label?: string;
  level: EntityRelationLevel;
  summary?: string;
  importance?: "primary" | "secondary";
  sources?: SourceRef[];
};

export type EntityFields = Record<string, string | string[] | boolean>;

export type EntityOverrides = {
  name?: string;
  aliases?: string[];
  tags?: string[];
  playerVisible?: string;
  keeperPrivate?: string;
  fields?: EntityFields;
  cocStats?: Partial<PersonCoCStats>;
  image?: string;
  imageSource?: "manual" | "extracted";
  linkBehavior?: EntityLinkBehavior;
  updatedAt: string;
};

export type EntityCard = {
  ref: string;
  id: string;
  kind: EntityKind;
  source: EntitySource;
  confirmed: boolean;
  original: {
    name: string;
    aliases: string[];
    tags: string[];
    playerVisible: string;
    keeperPrivate: string;
    fields: EntityFields;
    cocStats?: PersonCoCStats;
    image?: string;
    imageSource?: "manual" | "extracted";
  };
  overrides?: EntityOverrides;
  appearances: EntityAppearance[];
  linkBehavior: EntityLinkBehavior;
  createdAt: string;
  updatedAt: string;
};

export type KPNoteBlock = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type ReadingPosition = {
  sectionKey: string;
  page: number;
  updatedAt: string;
};

export type Project = {
  id: string;
  name: string;
  fileName: string;
  fileType: "pdf" | "docx" | "markdown";
  fileSize: number;
  createdAt: string;
  updatedAt: string;
  status: "imported" | "structured" | "analyzing" | "ready";
  documentText: string;
  pages: DocumentPage[];
  chapters: Chapter[];
  analysis: ProjectAnalysis;
  kpNotes?: KPNotes;
  lastReadingPosition?: ReadingPosition;
};

export type ModelConfig = {
  protocol?: "openai" | "anthropic" | "gemini" | "ollama";
  baseUrl: string;
  model: string;
  confirmMode?: "tier1" | "tier2" | "tier3";
  capabilities?: ModelCapabilities;
};

export type EmbeddingCapability = {
  model: string;
  dimensions: number;
  testedAt: string;
};

export type ModelCapabilities = {
  chat: { model: string };
  embedding?: EmbeddingCapability;
};

export const emptyAnalysis = (): ProjectAnalysis => ({
  people: [],
  monsters: [],
  unresolvedRelationCount: 0,
  characterArcs: [],
  personRelations: [],
  openingHook: "",
  openingHookDetails: undefined,
  clues: [],
  acts: [],
  chapterSummaries: [],
  places: [],
  maps: [],
  markers: [],
  reviewItems: [],
  activityLog: [],
  stages: {
    background: { status: "idle" },
    timeplace: { status: "idle" },
    characters: { status: "idle" },
    characterArcs: { status: "idle" },
    clues: { status: "idle" },
    acts: { status: "idle" },
  },
});
