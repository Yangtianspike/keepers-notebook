# 守秘人笔记本 项目复习指南

## 一、项目一句话定位

守秘人笔记本是一款面向《克苏鲁的呼唤》（Call of Cthulhu，简称 CoC）TRPG 守秘人（KP）的 **AI 辅助剧本备本工作台**。它把原始 PDF/DOCX 剧本通过多模型 LLM 分析，自动整理成结构化的可编辑模组笔记本，帮助 KP 快速掌握剧情、人物、线索、怪物和幕结构。

---

## 二、为什么做这个项目

- TRPG 主持人备本负担重：一本模组往往几十到上百页，需要手工提取人物、地点、线索、时间线。
- 通用 AI 聊天工具无法针对 TRPG 结构做持久化整理，也不能按幕节展示。
- 现有 PDF 阅读器不能直接把剧本转成可编辑的、带关系图谱的备本。

所以项目核心目标是：**把非结构化的模组文档，自动转成结构化的、可编辑的、带关系图谱的模组笔记本**。

---

## 三、技术栈全景

| 层级 | 技术 |
|---|---|
| 前端框架 | Next.js 14（App Router）+ React 18 + TypeScript |
| 样式 | Tailwind CSS + 自定义 CSS |
| 书页翻页 | turn.js 4 + jQuery |
| 关系图 | React Flow + dagre 自动布局 |
| 本地存储 | IndexedDB（项目、文件、图片、向量） |
| 关系数据库 | SQLite + Drizzle ORM |
| 文档解析 | pdfjs-dist（PDF）、mammoth.js（DOCX） |
| 模型协议 | OpenAI、Anthropic、Gemini、Ollama、DeepSeek |
| 构建工具 | Vite（自定义 sites 插件）+ PostCSS + ESLint |
| Worker | Web Worker 处理部分后台任务 |

---

## 四、核心架构

### 4.1 数据流

```
PDF/DOCX 文件
    ↓
[parser.ts] 解析为 pages[]（text + printedPage + imageHeavy）
    ↓
[retrieval.ts] 分块 → chunks[] + 计算 hash
    ↓
[embedding.ts] 探测模型能力 → 生成向量索引（可选）
    ↓
[api/model] 七阶段 LLM 分析 → analysis 对象
    ↓
[entities.ts] 构建 EntityCard[]（人物、怪物、线索、地点、事件）
    ↓
[markdown-document.tsx] 渲染为翻页书页
    ↓
KP 在 book-editor.tsx 中编辑、在 entity-window.tsx 中查看资料
```

### 4.2 项目数据结构（Project）

```ts
Project {
  id: string;
  name: string;
  fileType: "pdf" | "docx";
  documentText: string;        // 完整原文
  pages: DocumentPage[];       // 每页文本
  chapters: Chapter[];         // 自动/手动识别的章节
  analysis: ProjectAnalysis;   // 七阶段分析结果
  kpNotes: KPNotes;            // KP 覆盖层：sectionMarkdown + entityOverrides + decisions
  modelConfig: ModelConfig;    // 模型配置
  createdAt / updatedAt
}
```

### 4.3 七阶段分析

1. **background**：故事背景、起因、历史、当前状态、可能结局、外部依赖、矛盾点。
2. **timeplace**：时间线与地点列表。
3. **characters**：人物识别与 CoC 属性补全。
4. **monsters**：怪物与 Boss 识别与属性补全。
5. **characterArcs**：人物经历、动机变化、人物关系。
6. **clues**：关键线索、获取方式、卡关补救。
7. **acts**：幕章节、关键节点、分支结局。

每个阶段都会返回 `reviewItems`（需要 KP 裁决的冲突或不确定项）。

---

## 五、关键技术难点与解决方案

### 5.1 大模型输出不稳定

**问题**：模型经常不按要求输出 JSON，或 JSON 不完整。

**解决**：
- 提示词明确阶段任务和字段约束。
- `model-adapter.ts` 实现工具调用 + 文本标记两种确认模式（tier1/tier2/tier3）。
- `json-repair.ts` 实现 `parseLooseJsonObject`：去掉代码围栏、提取最后一个 `{}`、容忍多余文本。
- 服务端对 DeepSeek 等模型做特殊适配。

### 5.2 长文档无法一次性塞进模型上下文

**问题**：剧本可能上百页，超出模型上下文窗口。

**解决**：
- `retrieval.ts` 把文档切成 500 字符的块，重叠 50 字符。
- 先用 skeleton 阶段生成人物/怪物索引，再按每批最多 6 个分批请求 detail。
- 使用 BM25 + 向量检索做混合搜索，按阶段动态检索相关块。
- `stageQuery()` 根据当前分析阶段构造不同查询。

### 5.3 书页排版与翻页

**问题**：HTML 内容高度不固定，要切成固定尺寸的书页，且不能切断文字、表格、卡片。

**解决**：
- `stage-view.tsx` 实现块级测量 + 分页：`measureBlock` 计算每个 React 块高度，`protectedRanges` 标识不可切分的范围。
- `markdown-document.tsx` 把 Markdown 解析成 `MarkdownBlock[]`，每个 block 作为一个分页单元。
- 固定书页尺寸 1750×1200（双页），单页 680×1150，按比例缩放。
- 早期每个阶段独立 turn.js 实例，后统一为**单个全局 turn.js 实例**，实现跨阶段连续翻页。
- turn.js 做 3D 翻页，ResizeObserver 监听容器尺寸变化重建。

### 5.4 实体链接不被书页裁切

**问题**：实体 hover menu 在 overflow hidden 的书页内会被裁掉。

**解决**：用 `createPortal` 把菜单渲染到 `document.body`，基于 trigger 的 `getBoundingClientRect()` 计算位置，自动调整左右/上下避免超出视口。

### 5.5 多实体资料窗口管理

**问题**：打开多个资料窗口会重叠、难管理。

**解决**：
- `page.tsx` 维护 `entityWindows[]` 数组。
- 每个窗口独立位置、z-index、历史栈。
- `entity-window.tsx` 内部用 `ResizeObserver` 自动缩放，支持拖拽，点击标题栏置顶。
- V1.0.1 后核心人物编辑窗升级为**非模态自由浮动窗口**，可拖动、可缩放，不阻塞书页操作。

### 5.6 CoC 数值来源校验

**问题**：模型容易把推断数值伪装成原文数据。

**解决**：
- `coc-stat-extractor.ts` 从原文中直接匹配属性块，标记为 `source`。
- 每个数值字段记录 `fieldProvenance`，区分 source/inference/keeper/conflict。
- `quote-check.ts` 校验 `SourceRef` 的 quote 是否真实存在于 pages 中。

### 5.7 图片处理

**问题**：PDF/DOCX 中有调查员资料图片、地图等，需要提取给 KP 使用。

**解决**：
- PDF 用 pdfjs-dist 提取页面图片对象。
- DOCX 用 mammoth.js 提取内嵌图片。
- 图片压缩后存 IndexedDB（最大边 1600px，体积 ≤ 1MB）。
- 支持打包成 ZIP 下载（手写 ZIP 结构，不依赖 JSZip）。

### 5.8 H1–H6 统一目录模型

**问题**：编辑器目录和书页目录分别推断，层级不一致。

**解决**：
- Markdown 编辑器和书页阅读共用同一套标题解析与层级规则。
- H1 为一级目录，H2–H6 按文档顺序归入最近的更浅一级标题。
- 重复标题使用稳定且互不冲突的定位标识。
- "幕"固定为一级目录，每一幕是其二级目录，幕内标题从 H3 开始。

### 5.9 编辑会话状态保持

**问题**：编辑时离开书页（如进入前期准备），草稿和位置丢失。

**解决**：
- 编辑会话在当前页面运行期间保存在内存中，不随组件卸载丢失。
- 返回模组笔记本后恢复活动章节、目录展开状态、编辑模式、滚动位置和未保存草稿。
- 保存后根据最后修改的章节/标题定位到对应书页；取消则回到进入编辑器前的位置。
- 未保存时刷新或返回首页提示用户。

### 5.10 关系数据统一驱动

**问题**：模型分析、KP 资料卡、Markdown 编辑器创建的关系来源不同，关系图不一致。

**解决**：
- 所有来源的关系写入同一套规范化关系数据源。
- 新增/修改/删除关系后，两端实体的个人关系图立即同步。
- 重新分析只更新模型关系，不覆盖 KP 手动关系。
- 核心人物关系图只展示人物 ↔ 人物关系，且同一对人物只显示最重要的一条。

---

## 六、关键模块职责

| 文件 | 职责 |
|---|---|
| `app/page.tsx` | 主应用状态、左侧导航、分析流程、实体窗口栈、编辑器弹窗 |
| `app/components/stage-view.tsx` | 统一书页渲染、turn.js 生命周期、块级分页 |
| `app/components/markdown-document.tsx` | Markdown 解析、实体链接、人物卡/怪物卡渲染 |
| `app/components/book-editor.tsx` | 可视化 Markdown 编辑器、目录、图片压缩 |
| `app/components/entity-window.tsx` | 浮动实体资料窗口、编辑、关联实体、拖拽 |
| `app/components/core-character-relations.tsx` | 核心人物关系图（React Flow + dagre） |
| `app/components/source-image-extractor.tsx` | 提取并打包 PDF/DOCX 图片 |
| `app/components/confirm-wizard.tsx` | AI 确认流程 UI |
| `lib/parser.ts` | PDF/DOCX 解析、章节识别 |
| `lib/retrieval.ts` | 文本分块、BM25 检索 |
| `lib/embedding.ts` | 向量索引构建与检索 |
| `lib/entities.ts` | 实体构建、Markdown 生成、实体关系 |
| `lib/markdown.ts` | Markdown ↔ HTML 转换、安全校验 |
| `lib/storage.ts` | IndexedDB 封装、数据迁移 |
| `lib/model-adapter.ts` | 模型请求构建、确认模式 |
| `lib/provider-adapter.ts` | 多模型协议适配 |
| `lib/coc-stat-extractor.ts` | CoC 数值原文提取 |
| `lib/json-repair.ts` | JSON 容错解析 |
| `app/api/model/route.ts` | 服务端模型代理、提示词 |

---

## 七、容易被问到的问题

### Q1：项目最大的技术挑战是什么？

**答**：**把非结构化的剧本文档转成结构化、可分页、可编辑的书页式笔记本**。具体难点包括：
- LLM 输出不稳定，需要多层 JSON 容错。
- 长文档需要分块、检索、分批分析。
- 动态 HTML 内容要切成固定尺寸书页，不能切断卡片和表格。
- 多模型协议适配（OpenAI/Anthropic/Gemini/Ollama/DeepSeek）。

### Q2：为什么要用 turn.js？

**答**：项目目标是还原实体书阅读体验，turn.js 提供 3D 翻页动画和双页展开模式，能营造 TRPG 模组笔记本的氛围。缺点是它依赖 jQuery，和现代 React 集成需要生命周期管理，但视觉收益大于改造成本。

### Q3：怎么处理 LLM 输出不稳定？

**答**：
1. 提示词明确阶段任务、输出格式和字段约束。
2. 工具调用 + 文本标记两种确认模式（`tier1/tier2/tier3`）。
3. `parseLooseJsonObject` 去掉 Markdown 代码围栏、提取最后一个 JSON 对象、容忍尾部文本。
4. 对 DeepSeek 等模型做特殊适配。
5. 每个关键字段带 `provenance` 和 `SourceRef`，方便 KP 校验。

### Q4：长文档怎么处理的？

**答**：
1. 文档切成 500 字符的块，重叠 50 字符，保留 `sourcePage` 溯源。
2. 先用 skeleton 阶段生成人物/怪物索引。
3. 按每批最多 6 个实体请求 detail，减少单次上下文压力。
4. 使用 BM25 + 可选向量检索做混合搜索，按阶段动态检索相关块。

### Q5：书页分页怎么实现的？

**答**：
1. `markdown-document.tsx` 把 Markdown 解析成 `MarkdownBlock[]`。
2. `stage-view.tsx` 在隐藏容器里真实渲染每个 block，测量高度。
3. 按固定书页高度累加 block，遇到不可切分范围（`protectedRanges`）整段推进。
4. 单页超高时做兜底切片，但优先保证卡片/表格完整。
5. 所有阶段/幕合并为**单个 pages 数组**，turn.js 单实例管理，实现连续翻页。
6. ResizeObserver 监听容器变化重建。

### Q6：实体资料窗口为什么不做成弹窗而是浮动便利贴？

**答**：KP 需要同时对比多个人物/线索资料，弹窗只能看一个。浮动窗口支持多开、拖拽、历史栈，像桌面便利贴一样随时参考，同时不阻塞书页阅读。V1.0.1 后核心人物编辑窗也升级为可拖动、可缩放的非模态自由浮动窗口。

### Q7：怎么保证 CoC 数值准确？

**答**：
1. 先通过正则从原文中直接匹配属性块，标记为 `source`。
2. LLM 补全时标记为 `inference`。
3. KP 修改后标记为 `keeper`。
4. `quote-check.ts` 校验 quote 是否真实存在。
5. UI 用不同颜色/标签展示来源。

### Q8：为什么选择 IndexedDB + SQLite 两种存储？

**答**：IndexedDB 存大对象（项目、文件、图片、向量），SQLite + Drizzle 存结构化关系数据。浏览器端 SQLite 便于做关系查询和导出，IndexedDB 适合 Blob 和二进制数据。

### Q9：图片资料包怎么做的？

**答**：
1. PDF 通过 pdfjs-dist 的 `getOperatorList` + `IRF` 提取内嵌图片对象。
2. DOCX 通过 mammoth.js 的 transform 钩子提取内嵌图片。
3. 图片压缩（最大边 1600px，质量 0.8，目标 ≤ 1MB）。
4. 手写 ZIP 打包逻辑（不用 JSZip），减少依赖体积。

### Q10：多模型适配怎么做？

**答**：
1. `provider-adapter.ts` 把不同厂商的 SDK 差异封装成统一接口。
2. `model-adapter.ts` 构建请求体，支持 `tool_calls` 和纯文本两种确认模式。
3. `api/model/route.ts` 做服务端代理，统一处理流式/非流式响应。
4. 每个模型配置独立保存 API key、base URL、模型名称。

### Q11：统一目录模型是怎么设计的？

**答**：
- Markdown 编辑器和书页阅读共用同一套标题解析逻辑。
- H1 为一级目录，H2–H6 按文档顺序归入最近的更浅一级标题。
- 中间层级缺失时不生成虚构标题，例如 H2 后接 H4，H4 归入该 H2。
- "幕"固定为一级目录，每一幕作为二级目录，幕内标题从三级开始。
- 重复标题使用稳定定位标识，避免同名跳错。

### Q12：编辑会话跨页面保留怎么实现？

**答**：
- 编辑状态保存在 React 顶层状态（内存）中，组件卸载不丢失。
- 离开书页进入前期准备等页面时只隐藏编辑器，不结束会话。
- 返回后恢复活动章节、目录展开、编辑模式、滚动位置和未保存草稿。
- 草稿不会自动覆盖正式内容，只有点击保存才写入 IndexedDB。
- 未保存时刷新或返回首页提示用户。

### Q13：主动创建实体和关系同步怎么做？

**答**：
- Markdown 编辑器工具栏新增"新建实体"按钮，无需预先选择文字。
- 创建时可选择类型、输入名称、选择一个或多个已有实体作为关联对象。
- 关系保存后，两端实体的个人关系图立即更新，不重新调用模型。
- 所有关系（模型分析、KP 资料卡、编辑器创建）进入同一套规范化数据源。
- 核心人物关系图只取人物 ↔ 人物关系，且同一对人物只显示最重要的一条。

### Q14：核心人物编辑窗为什么改成自由浮动窗口？

**答**：
- 全屏模态框会阻断书页和其他资料窗口操作，KP 经常需要对照书页修改人物卡。
- 改为非模态浮动窗口后，可以拖动位置、调整大小，同时继续翻页和查看其他资料。
- 切换工作台页面不会自动关闭，未保存草稿继续保留。
- 窗口标题栏可拖动，输入区不触发拖动，且不能完全拖出视口。

### Q15：V0.7 书页重构经历了几个阶段？

**答**：
- V0.7.0：统一书页尺寸、排版规范、turn.js 翻页动画。
- V0.7.1–0.7.2：修正阶段子视图结构，让 `StageView` 统一注入标题，保证 `contentBlocks` 能正确切片。
- V0.7.3：固定 1750×1200 尺寸、空白封面页、连续页码。
- V0.7.4：移除空白封面，统一为**单个 turn.js 实例**，真实 680×1150 文本框。
- V0.7.5：卡片不分页截断、分析流程 UI 优化、KP 书页文字覆盖层。

---

## 八、项目亮点（面试加分点）

1. **完整 AI + 编辑器闭环**：不是简单对话，而是分析 → 结构化 → 可视化编辑 → 覆盖层保存。
2. **复杂前端排版**：固定尺寸书页 + 块级分页 + 单实例 turn.js 3D 翻页，类似电子书阅读器。
3. **RAG 实践**：分块、BM25、向量检索、混合搜索都用到了。
4. **多模型工程化**：提示词、协议适配、JSON 容错、模型降级策略。
5. **数据溯源思想**：每个字段都有来源标记，AI 结果和 KP 修改分层管理。
6. **浏览器端工程能力**：IndexedDB、SQLite、Web Worker、自定义 ZIP 打包、图片压缩。
7. **真实业务场景**：面向 TRPG 这一具体领域，有明确的用户（KP）和价值（备本效率）。
8. **状态管理深度**：编辑会话跨页面保持、浮动窗口栈、关系图实时同步。

---

## 九、如果面试官让你挑一个模块细讲

推荐三个最有料的模块，任选其一深入：

1. **书页分页与 turn.js 集成**：
   - 可以讲 block 测量、protected ranges、单实例 turn.js、ResizeObserver、连续翻页。

2. **多模型 LLM 分析流程**：
   - 可以讲七阶段、提示词工程、JSON 容错、确认流程、source/inference/keeper 分层。

3. **实体资料系统与多浮动窗口**：
   - 可以讲 entity windows 栈、拖拽、Portal、z-index 管理、相关实体导航、非模态编辑窗。

---

## 十、需要避免的说法

- 不要只说"用了 AI"，要讲清楚 **AI 在流程中的位置和边界**。
- 不要只说"用了 Next.js"，要讲清楚 **为什么选择 App Router 或具体解决了什么问题**。
- 不要回避 turn.js + jQuery 的老旧，要说明 **这是为了视觉体验做的技术权衡**。
- 不要夸大完成度，V1.0.0 是 RC2 候选版，V1.0.1 已实现待验收，最终发布需要真实模组回归。

---

## 十一、版本演进（简要）

| 版本 | 主要进展 |
|---|---|
| v0.7.x | 统一书页、可视化编辑、实体资料系统、整体分析 |
| v0.8.x | 人物 CoC 召回、语义关系、多实体工作台、核心人物卡、幕树 |
| v0.9.0 | 序幕统一、怪物/Boss 章节、书页自适应、核心卡编辑 |
| v0.9.1 | 多模型适配、确认流程整合 |
| v0.9.2 | 幕树地图化、PDF 图片提取、调查员资料包、人物关系图 |
| v0.9.3 | 人物关系工作台、分页式实体编辑、编辑器目录 |
| v0.9.4 | PDF 书签、DOCX 原文/图片兼容、JSON 容错 |
| v0.9.5 | 非阻塞实时确认、怪物独立分析阶段、v1.0.0-RC1 |
| v1.0.0 | H1–H6 统一目录、幕稳定一级目录、编辑会话保持、主动创建实体、关系统一驱动 |
| v1.0.1 | 编辑器空引用修复、编辑入口定位、核心人物非模态自由编辑窗 |
