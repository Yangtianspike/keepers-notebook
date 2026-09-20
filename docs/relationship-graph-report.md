# 关系图问题综合诊断与改进报告

本文合并两份调研：**关系漏抽**（如"X 意图刺杀 Y"缺失）与**连线观感差**。两者同属关系图问题，且在"平行边"和"18 人截断"两处互相交织，统一给出改进路线。

涉及代码：`app/api/model/route.ts`（prompt）、`lib/retrieval.ts`（检索）、`app/page.tsx`（过滤与渲染）、`lib/graph-layout.ts`（布局）。

---

# 第一部分：关系漏抽 —— "X 意图刺杀 Y"为什么不在图上

## 1.1 漏损链路全景

一条关系从原文到图上要过 5 道关卡，每道都可能丢：

```
原文描述刺杀计划
  → ① BM25 检索 Top12 块（召回失败：块根本没喂给模型）
  → ② 模型单轮抽取（范畴偏差：不把"意图/计划"当关系输出）
  → ③ max_tokens 截断（finish_reason=length：整阶段失败）
  → ④ 前端 validPeople 过滤（端点不在人物列表：静默丢弃）
  → ⑤ 前端 seen 去重 + 18人截断（同对人只留第一条边 / 节点被裁）
```

## 1.2 各环节诊断（按嫌疑度排序）

### ① Prompt 范畴偏差 —— 最大嫌疑

`route.ts` 95–112 的 relations 指令只有三行：提取"人物关系"、用列表 id、分 truth/public/belief 三层。

问题：**没有定义"关系"的范畴**。模型的默认理解是稳态社会/血缘/情感关系（父女、同事、恋人、雇佣）。而"意图刺杀"是**单向的计划/意图/敌对行动**，不是稳态关系——prompt 没让它找，它就压根不输出。CoC 模组里大量关键关系恰恰是动态的：刺杀、勒索、跟踪、献祭、背叛、误导、保护、监视。

### ② 检索召回失败 —— 并列主因

`retrieval.ts` 163 行 relations 阶段 query：`人物 关系 联盟 敌对 秘密 + 所有人名拼接`

- **"刺杀/谋杀/阴谋/计划/勒索"等词不在检索词里**。BM25 是纯词面匹配，描述刺杀计划的块若写成"他决心在满月之夜动手除掉那个女孩"（无关键词命中、人物用代称），得分≈0，进不了 Top 12。
- Top 12 块 × 500 字 ≈ 6000 字，几百页模组占比极小，漏块是常态。
- 30 个人名拼进 query，二元组分词 + IDF 稀释，人名权重趋近于零。

### ⑤a 前端 seen 去重 —— 确定的代码级丢边

`app/page.tsx` 1340–1347：

```ts
const seen = new Set<string>();
.filter(({ sourceId, targetId }) => {
  const key = `${sourceId}\0${targetId}`;
  if (seen.has(key)) return false;  // 同一对人只保留第一条！
  ...
})
```

同一对人物之间的**多条关系只渲染第一条**。模型输出了 (A→B "雇主") 和 (A→B "意图刺杀") 两条时，后者被去重直接丢弃。这是"模型抽到了但图上没有"的确定 bug。

### ⑤b 画布 18 人硬截断

`page.tsx` 1128 `.slice(0, 18)`：次要人物节点消失后，1256–1258 的 filter 会把端点不在图上的边一起滤掉。刺杀关系任一端重要性低，整条边消失，且界面没有"还有 N 人未显示"的提示。

### ④ validPeople 静默过滤

`page.tsx` 3389–3398：sourceId/targetId 不在人物列表的边直接丢弃，无记录、无提示。两个高发场景：

- **刺杀目标是"调查员"（PC）**——CoC 模组最常见的敌对指向，但 PC 不在 people 阶段产出的列表里
- 模型用了名称变体/新 id（重跑 people 阶段后 id 全变，旧关系整批失效）

### ③ max_tokens 档位偏低

`route.ts` 39–43：relations 走默认档 **12000**（people/timeline/clues 是 16000）。人物多时单轮长 JSON 容易截断，`finish_reason=length` 时整个阶段失败——不是漏一条，是全丢。

---

# 第二部分：连线观感差 —— 4 类根因叠加

| 症状 | 根因 | 当前实现对应点 |
|---|---|---|
| 线穿过节点 | 边只在起止节点间走 smoothstep，不做绕障 | 自定义 smoothstep 边无避障逻辑 |
| 边交叉多、走向乱 | 布局阶段没做交叉最小化；两套布局混用 | dagre(LR) 和 ELK 双轨并存，坐标不一致 |
| 同一对人之间多条线重叠 | truth/public/belief 三层 = 平行边，无偏移处理 | 每条 Relation 直接渲染成一条边 |
| 标签压线、互相遮挡 | SVG text 居中放边上，无背景、无避让、无截断 | 边标签无 pill 背景、无长度限制 |

**关键认知：ELK 在布局阶段就能算边路由**，返回的每条边带 `sections`（折点数组），直接拿这些点画 polyline 就是绕好障的正交线。当前只用了 ELK 的节点位置，把算好的边路径扔了，再自己用 smoothstep 重连——这是最大的浪费。

---

# 第三部分：改进方案

## 3.1 立即见效（一行/小改动）

| # | 改动 | 解决 |
|---|---|---|
| 1 | relations 检索词扩充敌对动词：`刺杀 谋杀 阴谋 计划 意图 勒索 跟踪 背叛 献祭 威胁 监视 仇恨 保护 利用` | 漏抽② |
| 2 | seen 去重 key 加 layer（`source\0target\0layer`），或按 3.4 合并渲染 | 漏抽⑤a / 平行边 |
| 3 | relations 的 max_tokens 提到 16000 | 漏抽③ |
| 4 | 去掉 18 人硬截断，或显示"还有 N 人未显示" | 漏抽⑤b |

## 3.2 Prompt 扩展关系范畴（解决漏抽①）

在 relations 指令中显式定义关系类型清单，并声明单向意图也算关系：

```
关系类型包括但不限于：
- 身份/血缘：亲属、同族、化身……
- 社会/组织：雇佣、上下级、成员、同盟……
- 情感/态度：爱慕、仇恨、信任、畏惧……
- 行动/意图（单向，最容易漏）：计划杀害、监视、勒索、
  误导、献祭目标、保护、利用、追查……
- 秘密/把柄：握有对方秘密、知道对方真实身份……
单向的意图和计划也是关系，方向为 意图持有者 → 目标。
原文出现"打算/计划/意图/决心/准备 + 针对某人的行动"时必须提取。
```

## 3.3 检索改为按人/按人物对召回（解决漏抽②的根因）

- **按人召回**：每个人名（含别名）单独 BM25 取 Top 3~5 块，合并去重。保证每个核心人物的上下文都在，不受人名稀释影响
- **按共现召回**：核心人物对用 `名A 名B` 双词检索取共现块——两人同框的块几乎必然含关系信息
- 块预算从 12 提到 20~30（6000 字 → 1.5 万字，主流模型上下文都吃得下）

## 3.4 平行边：合并渲染（同时解决漏抽⑤a 和连线重叠）

同一对人物最多 3 条边（truth/public/belief），三种处理可组合：

1. **合并成一条边，标签写成多行/多个 pill**：`对外：同事 / 真相：父女` —— 信息不丢，画布最干净（推荐）
2. 沿法线方向加偏移弧度（G6 quadratic 模式思路）
3. 默认只显示 truth 层，hover/筛选时展开其他层（把已有层级过滤设为默认行为）

参考：G6 v5 内置 ProcessParallelEdges transform（bundle/quadratic 两种模式）
https://g6.antv.antgroup.com/manual/transform/process-parallel-edges

## 3.5 分块抽取 + 汇总（map-reduce，召回天花板最高）

不再单轮全量抽取，改两轮：

1. **抽取轮**：全文按块分批喂模型，每批只要求"列出该段中出现的所有人物互动（动作、计划、冲突、对话涉及的关系）"，局部三元组 + 页码证据
2. **汇总轮**：合并局部三元组，对照已确认人物列表做实体归一化、去重、分层

依据：CREFT（2025，多智能体迭代精炼人物关系图，https://arxiv.org/abs/2505.24553）与 ai-knowledge-graph（分块抽取+实体标准化）都证明该模式显著优于单轮抽取。证据天然带页码，与现有 quote 校验兼容。

## 3.6 漏损兜底

- **内置"调查员"固定人物节点**，validPeople 放行指向它的边
- 被过滤的边不静默丢弃：按名称模糊匹配尝试修正，失败进待确认队列并提示"N 条关系因端点未识别被搁置"
- id 锚定：people 阶段后用名称哈希生成确定性 id，重跑不失效

## 3.7 连线路由与布局（解决观感）

**方案 A（推荐首选）**：删 dagre 统一 ELK，开 `edgeRouting: ORTHOGONAL`，用 ELK 返回的 `sections` 折点画边。关键配置：

```
elk.algorithm: layered
elk.edgeRouting: ORTHOGONAL
elk.layered.crossingMinimization.strategy: LAYER_SWEEP
elk.layered.nodePlacement.strategy: NETWORK_SIMPLEX
elk.spacing.edgeEdge: 20
elk.spacing.edgeNode: 16
elk.layered.spacing.edgeEdgeBetweenLayers: 20
elk.edgeLabels.inline: true
elk.layered.considerModelOrder.strategy: NODES_AND_EDGES
```

参考：
- ELK Layered 选项参考：https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
- ELK 分层算法原理（2025 官方博文）：https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html

**方案 B（拖拽手感增强）**：A* 网格寻路绕障边。原版 `tisoap/react-flow-smart-edge` 已归档，用活跃 fork `Jalez/react-flow-smart-edge`（https://github.com/Jalez/react-flow-smart-edge）

**方案 C（draw.io 级质量）**：libavoid 正交绕障路由，React Flow 官方 Pro 示例同款（https://reactflow.dev/examples/edges/edge-routing），接入复杂度较高

**方案 D（重写画布）**：换 G6 v5，平行边/combo/边标签开箱即用，代价是放弃现有 React Flow 交互代码。只在前述方案做完仍不满意时考虑

## 3.8 边标签可读性

改用 `<EdgeLabelRenderer>` 渲染 HTML 标签（比 SVG text 灵活）：

- 标签做成带底色的小 pill，压线也看得清
- label 限长（≤ 8 字），长了省略号 + hover 显示全文
- 默认只显示选中节点/重要边的标签，其余 hover 才出现
- 参考：https://reactflow.dev/api-reference/components/edge-label-renderer

---

# 第四部分：统一改进路线（按优先级）

| 阶段 | 内容 | 预期收益 |
|---|---|---|
| P0 | 3.1 全部四项小改动 | 刺杀类关系不再被检索词/去重/截断误杀 |
| P1 | 3.2 prompt 关系范畴 + 3.4 平行边合并 | 意图/计划类关系开始被提取；同对人多边不再重叠 |
| P2 | 3.7 方案 A（统一 ELK + sections 画边）+ 3.8 标签 pill 化 | 连线观感质变 |
| P3 | 3.3 按人/人物对召回 | 检索召回根治 |
| P4 | 3.5 map-reduce 抽取 + 3.6 兜底 | 召回天花板 |
| P5 | 3.7 方案 B/D 按需 | 打磨 |

## 验证建议

改动后用一个已知含刺杀情节的模组做回归：先确认原文块被召回（①），再确认模型输出里有该关系（②），最后确认图上渲染（⑤）。分段定位，一次只改一层。
