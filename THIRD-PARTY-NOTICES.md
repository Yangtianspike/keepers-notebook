# 第三方组件许可声明

本项目（守秘人笔记本 / Keeper's Local Notebook）的源码与构建产物中包含以下第三方组件。
各组件的版权归其原作者所有，继续适用其原始许可条款。本文件用于履行这些许可所要求的署名与声明保留义务。

---

## 1. turn.js —— 非商业许可（重要）

| 项 | 内容 |
| --- | --- |
| 版本 | turn.js 3rd release（`r3`） |
| 版权 | Copyright (c) 2012, Emmanuel Garcia. All rights reserved. |
| 来源 | <https://www.turnjs.com> ／ 许可原文 <https://www.turnjs.com/license.txt> |
| 本项目内位置 | `public/turn.min.js`、`node_modules/turn.js/` |

许可条件（原文摘录，中译仅供参考）：

- 允许以源码或二进制形式再分发和使用，无论是否修改，前提是**保留上述版权声明、条件列表与免责声明**；
- **任何再分发、使用或修改都必须仅出于个人利益，不得用于任何商业目的或获取金钱收益。**

> Any redistribution, use, or modification is done solely for personal
> benefit and not for any commercial purpose or for monetary gain.

补充说明：

- `public/turn.min.js` 头部仅保留 `/* turn.js r3 | turnjs.com/license.txt */` 一行指向声明，完整条款见上述来源。
- **注意版本元数据的矛盾**：npm 包 `turn.js@1.0.5` 的 `package.json` 将 `license` 标注为 `MIT`，
  但该包随附的 `license.txt` 明确为非商业条款。此处按**更严格的非商业条款**执行。
- 对本项目的约束：本项目对 turn.js 的使用同样限于非商业目的，与项目整体许可方向一致。
  如需将本项目用于商业目的，必须**单独解决 turn.js 的商业授权**，或改为自研/替换翻页引擎。

## 2. jQuery

- 版本：3.7.1
- 版权：Copyright OpenJS Foundation and other contributors（<https://jquery.org/license>）
- 许可：MIT
- 位置：`public/jquery-3.7.1.min.js`、`node_modules/jquery/`

## 3. pdf.js / pdfjs-dist

- 版本：6.1.200
- 版权：Copyright Mozilla Foundation
- 许可：Apache License 2.0（保留其 `NOTICE` 要求）
- 位置：`public/pdf.worker.min.mjs`、`node_modules/pdfjs-dist/`

## 4. mammoth

- 版本：1.12.0
- 许可：BSD-2-Clause
- 位置：`node_modules/mammoth/`

## 5. Next.js

- 版本：16.2.6
- 版权：Copyright Vercel, Inc.
- 许可：MIT
- 位置：`node_modules/next/`

## 6. React / React DOM

- 版本：19.2.6
- 版权：Copyright Meta Platforms, Inc. and affiliates
- 许可：MIT
- 位置：`node_modules/react/`、`node_modules/react-dom/`

## 7. @xyflow/react

- 版本：12.11.2
- 许可：MIT
- 位置：`node_modules/@xyflow/react/`

## 8. dagre

- 版本：0.8.5
- 许可：MIT
- 位置：`node_modules/dagre/`

## 9. elkjs

- 版本：0.12.0
- 许可：EPL-2.0 OR GPL-3.0-or-later（双许可）
- 本项目的选择：**EPL-2.0**（Eclipse Public License 2.0）
- 位置：`node_modules/elkjs/`

## 10. drizzle-orm

- 版本：0.45.2
- 许可：Apache License 2.0（保留其 `NOTICE` 要求）
- 位置：`node_modules/drizzle-orm/`

## 11. 构建期依赖

`devDependencies`（TypeScript 5.9.3、ESLint 9.39.4、Tailwind CSS 4.2.1、Vite 8.0.13、
Wrangler 4.92.0、vinext 0.0.50、Drizzle Kit 0.31.10、`@types/*` 等）仅用于本地构建与检查，
不随源码仓库分发。各包的完整许可见 `node_modules/<包名>/LICENSE*`。

---

## 如何获取完整许可文本

各依赖包的完整许可文本随包分发，见 `node_modules/<包名>/LICENSE`、`LICENSE.md`、
`LICENSE.txt` 或 `license.txt`；仓库中未提交 `node_modules`，可用 `npm install` 复原。

## 免责

本文件为许可信息汇总，不构成法律意见。第三方组件的著作权归其各自作者所有。
