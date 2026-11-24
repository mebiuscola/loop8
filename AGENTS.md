# Classroom Local · 给 AI 开发助手的项目规则

本文件同时供 Codex（读 `AGENTS.md`）和 Claude Code（`CLAUDE.md` 引用本文件）使用。
开始任何修改前先读完本文件，再读 `docs/STATUS.md`（当前进度与待办）、`PRODUCT.md` 和 `docs/API.md`。

## 项目是什么

Windows 上运行的本地课程工作台：一个 Node.js 服务（`server.mjs` + `lib/`）加浏览器前端（`public/`）。
单一用户（比较文学学生），按"每周课程"组织课件、参考文献、课堂字幕/录音，生成双语阅读、课堂讲稿和 Deep Dive，并支持按范围提问。

## 目录

| 路径 | 内容 | 能否随意修改 |
|---|---|---|
| `server.mjs` | HTTP 服务与全部路由 | 可以，但接口变化要同步 `docs/API.md` |
| `lib/` | 业务逻辑（解析、模型路由、ACP、缓存、讲稿、Deep Dive 等） | 谨慎；改动必须有测试 |
| `skills/` | **本应用调用 AI 时使用的提示词**（不是开发助手的 skills） | 只在明确要求时修改 |
| `public/` | 新前端构建产物（`public/next/`）和几个独立页面（原页渲染、引文原文对照）与第三方库 | `public/next/` 只由构建生成，不手改 |
| `test/` | `node --test` 测试 | 新功能和修复都要补测试 |
| `docs/` | 开发文档：进度（`STATUS.md`）、接口清单（`API.md`）、问题清单（`UI-ISSUES.md`）、信息架构（`IA-PROPOSAL.md`） | 随改随更新 |
| `data/` | **用户的私人课程资料与设置（含凭据）** | **禁止读取内容、修改、删除或提交** |
| `runtime/`, `agy-acp-server/`, `node_modules/` | 随包分发的可执行文件与依赖 | 不要修改 |
| `vendor/`, `public/vendor/` | 第三方库（pdf-lib、pdf.js、pptx 渲染） | 不要手改 |

## 不可违反的规则

1. **原件即证据。** 永不修改、覆盖或重命名 `Source/` 中的原始文件；同名不同内容的上传另存编号文件名。
2. **来源分明。** 原页、译文、课堂发言和 AI 分析在数据和界面上都要能区分，不能混成一种"内容"。
3. **不编造。** 不根据课件或文献编造讲师发言；保留课堂顺序；区分 Lecturer / Student / Unclear。
4. **保护用户数据。** 不读取、打印、提交 `data/` 和 `.env`；不在日志、诊断或错误信息中输出密钥、令牌或课程正文。
5. **后台任务不阻塞阅读。** 生成和解析在后台运行；停止任务时保留已完成的部分。
6. **只在用户要求时生成。** 讲稿、本节 Deep Dive、整周 Deep Dive 是三个独立操作，不自动触发。
7. **删除两步走。** 先 `*-plan` 展示影响，用户确认后再带 `confirm:true` 执行。
8. **兼容已有数据。** 任何改动都要能直接读取现有 `data/classes/*/project.json`；需要迁移时写迁移代码并测试，不要求用户重新上传或重新生成。

## 工作方式

- **分支：** 不直接在 `main` 上改。缺陷用 `fix/…`，功能用 `feature/…`，文档用 `docs/…`。
- **提交：** 一个提交只做一件事，提交信息用一句话说明"改了什么、为什么"。
- **测试：** 修改后运行全部测试（见下方"命令"）。浏览器测试需要本机有 Edge 或 Chrome。
- **版本号：** 以 `package.json` 的 `version` 为唯一来源。页面上的版本号和静态资源的 `?v=` 不要另外手写。
- **接口：** 前端只依赖 `docs/API.md` 中列出的接口。新增或修改接口时先改文档。
- **界面验证：** 改完界面要在浏览器里实际打开检查（截图或逐步操作），不能只看代码就宣布完成。
- **问题记录：** 用户反馈的界面问题记在 `docs/UI-ISSUES.md`，修复后在对应条目标注。
- **沟通：** 用户用中文交流；用通俗的话说明做了什么、为什么，技术细节从简。

## 命令（Windows，本机）

| 做什么 | 命令 | 在哪里运行 |
|---|---|---|
| 全部测试 | `runtime\node.exe --test test/*.test.mjs`（约 4 分钟，应全部通过） | 项目根目录 |
| 单个测试 | `runtime\node.exe --test test/<名称>.test.mjs` | 项目根目录 |
| 前端类型检查 | `npm run check` | `web/` |
| 构建前端 | `npm run build`（输出到 `public/next/`） | `web/` |
| 前端开发服务器 | `npm run dev`（把 `/api` 转发到 `CLASSROOM_PORT`，默认 4317） | `web/` |

用 `runtime\node.exe`（随包 Node）跑测试，与用户实际运行的版本一致。`web/` 的命令需要系统安装的 Node 与 npm。

## 协作约定（多个开发助手轮流工作）

本项目由 Claude Code 和 Codex 等助手在**同一个文件夹**里轮流开发。进度靠 git 和 `docs/STATUS.md` 传递，不靠对话记录。

- **开始时：** 读本文件 → `docs/STATUS.md` → `git status`、`git log --oneline -15`、`git branch`，弄清当前分支和未完成的事。
- **结束或换手前：** 提交全部改动（不留未提交的半成品）；更新 `docs/STATUS.md` 的"当前状态"和"下一步"，与改动一起提交。
- **不要同时运行两个助手改这个文件夹。** 需要同时进行时，给另一个助手单独的分支和单独的文件夹（`git worktree`），完成后再合并。
- **先问用户，再做：** 调用任何模型或外部服务（包括用用户的账号测试）、推送（`git push`）、删除分支或数据、修改 `skills/`。用户的一次同意只对那一次操作有效。
- **查看真实数据：** 只能通过正在运行的应用接口（默认 `http://127.0.0.1:4317`），或复制到临时目录（不复制 `settings.json`）用完删除；只输出数字和结构（页数、耗时、字段名），不输出课程正文、提示词、模型回复、密钥或令牌。
- **换行符：** 很多文件用 Windows 换行（CRLF），`server.mjs`、`CHANGELOG.md` 混用。修改时保持文件原有换行；提交前对比 `git diff --stat` 和 `git diff --ignore-cr-at-eol --stat`，两者行数应相同。
- **发版：** 每个功能分支用一个合并提交并入 `main`（`git merge --no-ff`）；然后一个"Release x.y.z"提交：改 `package.json` 版本、在 `CHANGELOG.md` 的"新版本记录"最上面加一条（中文，写用户能感到的变化）、重新构建前端，并跑全部测试。推送前先问用户。
- **Antigravity 请求日志：** 设置 → 高级可打开"保存 Antigravity 完整请求日志"，文件在 `data/diagnostics/acp/`；分析时只统计时间、数量、结构，不输出内容。

## 前端结构

- 2026-11-22（v2.26.0）起，`/` 是用 Vite + Svelte 5 + TypeScript 写的新前端，旧前端已删除。后端（`server.mjs`、`lib/`、`skills/`、`test/`）沿用。
- 视觉方向：深青（#213B3A / #28665F）与浅砂（#EEEEE7），不使用装饰性插图。设计以 `web/src/styles/tokens.css` 和 `docs/IA-PROPOSAL.md` 为准。
- **信息架构**（`docs/IA-PROPOSAL.md`）：四个工作区：概览 / 阅读（课件、参考文献分开）/ 课堂 / Deep Dive；全局：课程列表、后台任务面板、提问（默认收起）；设置为独立页面；打开课程回到上次位置。
- **目录：**
  - `web/`：前端源码。`web/src/lib/api.ts` 是唯一调用后端的地方；阅读数据缓存在 `web/src/lib/reader-cache.svelte.ts`（阅读页与概览共用）。
  - `public/next/`：构建产物，**提交进仓库**（用户不运行 npm）。改了 `web/` 必须重新构建并一起提交。
  - 页面在 `/` 提供，构建资源在 `/next/…`（`/next`、`/legacy` 跳回 `/`）。
  - `public/` 根目录只剩服务端需要的独立页面：`parse-render.*`、`render-audit.js`、`pptx-frame.*`（原页渲染与实时预览）、`reading-reference.*`（引文原文对照）和 `vendor/`。新鲜度规则在 `lib/workflow.mjs`，`web/src/lib/classroom.ts`、`deepdive.ts` 与之保持一致。
  - 浏览器测试通过 `test/helpers/app.mjs` 驱动界面（按看得见的文字和标签找元素）。
- **用户运行方式：** 双击 `Start.cmd`，不需要 npm、不需要构建。构建工具只是开发依赖，写在 `web/package.json`，装在 `web/node_modules/`（不碰根目录随包分发的 `node_modules/`）。用户运行的是这个文件夹当前检出的分支。
- **样式：** 颜色、字号、间距、状态色全部用 `web/src/styles/tokens.css` 中的变量，组件里不写裸色值；状态词和按钮位置遵守 `docs/IA-PROPOSAL.md` 第 2 节。
