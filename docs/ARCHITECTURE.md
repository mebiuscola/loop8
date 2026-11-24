# 系统结构与关键机制（给开发助手）

> 规则见 `AGENTS.md`，进度见 `docs/STATUS.md`，接口见 `docs/API.md`，界面结构见 `docs/IA-PROPOSAL.md`。
> 本文写的是"代码里有、但不读代码看不出来"的机制和不变量。改到这些地方时先读这里，改完同步更新。
> 最后更新：2026-11-24（Claude Code）。

## 1. 数据怎么存

每一周是 `data/classes/<id>/`（`data/` 是用户私人数据，开发时只能通过运行中的接口或测试副本查看，见 `AGENTS.md`）：

| 位置 | 内容 | 能否重建 |
|---|---|---|
| `project.json` | 这一周的状态：材料列表（`files`）、各材料解析进度（`aiParse`）、任务（`tasks`）、课堂、修订号（`revision` / `materialRevision`） | 否 |
| `Source/` | 原件。**永不修改、覆盖、重命名**；同名不同内容另存编号文件名 | 否 |
| `Parsed/<材料 id>/` | 解析结果与检查点：课件 `ppt_task.json`，文献 `ai_task.json`，已核对的提示 `hint-checks.json` 等 | 否（模型生成，重做要花钱和时间） |
| `.Cache/PPT/` | PowerPoint 导出：`<原件哈希>.pdf`、`<原件哈希>.json`、`<原件哈希>-slides/slide-N.png` + `slides.json` | 能 |
| `.Cache/Pages/<材料 id>/` | 每页图片与文字：`page-N.png`、`page-N.json`、`manifest.json` | 能 |

- **兼容旧数据：** 启动时会自动迁移（文件名、输出、解析计数等，见 `server.mjs` 启动段和 `lib/doubts.mjs` 的 `migrateDoubtCounts`）。新格式必须能读旧数据；需要迁移就在启动时迁移并写测试，不能要求用户重新上传或重新生成。
- **写入：** 同一周的写入通过 `writeProject` / `serialWriter` 串行；多个任务同时写同一周仍是待办（`docs/STATUS.md`）。

## 2. 课件（PPT/PPTX/PDF 课件）

流程：上传 → 原页绘制 → 页面缓存 → AI 识别、翻译、解读（逐页）→ 整课检查 → 阅读接口。

1. **原页绘制（`lib/preview.mjs`，`resources/export-preview.ps1`）**
   - PPT/PPTX 由本机 PowerPoint 在后台打开只读副本（不显示窗口、不运行宏），逐页导出 1920 宽的 PNG，再"另存为 PDF"（保留隐藏页）。脚本用 `-ExecutionPolicy Bypass` 运行，只对这一次有效。
   - 上传、打开阅读页、生成导读前自动开始（`server.mjs` 的 `startSlides` / `autoPowerPoint`）；测试中（`NODE_TEST_CONTEXT`）和测试副本（`CLASSROOM_TEST_COPY=1`）不自动启动，除非设 `CLASSROOM_POWERPOINT=1`。
   - 失败不会自动重试，只在用户点"用 PowerPoint 重新生成原页"时重试。不能用 PowerPoint 时用内置的近似绘制（浏览器里画 PPTX），阅读页会说明。
   - **PDF 只用来核对页数和读取每页文字，不用于显示。** 不要给 PPT/PPTX 加回"PDF 预览"显示方式。
2. **页面缓存（`lib/page-cache.mjs`）**
   - 每页一张图（`page-N.png`）和一份文字与检查结果（`page-N.json`）。有 PowerPoint 图片时直接用它，不再用 PDF 画一遍。
   - **两个键，别混用：**
     - `renderKey`：缓存能否复用。包含原件、绘制方式、绘制代码（`public/parse-render.js` 等）、字体、浏览器版本。Edge 更新或改绘制代码都会让缓存重建。
     - `imageKey`：导读等结果是否还对应同一批图。精确绘制（PowerPoint 图片或 PDF）只看原件和绘制方式；近似绘制等于 `renderKey`。
     - 判断结果是否过时一律用 `sameImages`（`lib/ppt-quality.mjs`）：先比 `imageKey`；没有 `imageKey` 的旧结果比 `renderKey`，精确绘制再比记录的绘制方式（`renderBasis`）和原件哈希。**不要再直接比较 `renderKey` 来判断导读是否过时**，否则 Edge 一更新所有导读都会被标成"按旧图生成"，生成导读时还会丢弃已完成的页。
3. **AI 解析（`lib/ai-material.mjs`，检查点 `Parsed/<id>/ppt_task.json`）**
   - 逐页识别、翻译、解读，可拆成几步（`lib/ppt-split.mjs`）；每页结果经 `inspectRecognition` 检查（原生文字覆盖、渲染检查）后保存，记录 `quality.renderKey` / `quality.imageKey`。
   - 规则（提示词）变化只让受影响的部分重做（`lib/ppt-cache.mjs` 的 `updatePptRules`）；图片变了时，图片和文字完全相同的页按指纹复用（`reusablePptPages`）。
   - **单页重做**（`preparePageRedo` / `restorePageRedo`）：旧结果先存进 `task.redo`，失败或停止时放回；重做时保留本周已有的规则，不会让其他页重来。
   - 整课检查（`lib/ppt-deck-review.mjs`）按批进行；未通过核对的修改建议不采用、不算待处理。
4. **阅读接口**（`GET /api/projects/:id/reader`）：合并导读、每页提示、`learningStale`（按旧图生成）、`drawnBy`（谁画的原页）。

## 3. 参考文献

- 先读 PDF 文字层（`lib/pdf-text.mjs`），读不出的用 MinerU 或 AI 补救。
- 翻译（`lib/reference-study.mjs`）：先整理本文自己的术语表（`lib/reference-terms.mjs`：每部分约 3 万字符，最多 120 条，并核对确实出现在原文中），再按约 4000 字符 / 12 段一批、几批同时翻译。回复被截断时用 `salvageTranslations`（`lib/translation-batch.mjs`）保留完整的段，只补缺的。
- 同一周同一时间只翻译一份文献，其他排队（`tasks['reference:<id>'].status==='queued'`）。其他任务类型忙时仍直接拒绝（待办）。
- 状态文字："原件已变更"目前只看 `stale`，还没有像课件那样区分原件变化和其他材料变化（待办，见 `docs/STATUS.md`）。

## 4. 模型分配与思考强度

- 功能清单和跟随关系：`lib/model-routing.mjs` 的 `MODEL_TASKS`、`FOLLOWS`（单页试解析、整课检查跟随课件识别；参考文献术语整理跟随参考文献翻译）。**前端 `web/src/lib/settings.svelte.ts` 有一份同样的 `FOLLOWS`，两处必须一致。**
- 思考强度：每项功能单独设置（`modelThinking`，`_default` 是默认模型的）；没设的跟随所跟随的功能或默认模型，都没有时用模型自身的设置（`thinkingFor`，前端 `thinkingOf` 同规则）。
- 发送方式：Antigravity 切换会话的思考选项；API 加 `reasoning_effort`；ChatGPT 订阅加 `reasoning.effort`。设置了思考强度时才计入模型标识（`routeHash`）——改这条规则会让已有结果被判为过时。
- Antigravity 每个模型可选的思考强度在刷新模型列表时逐个读取，存在**浏览器本地缓存**（`accountModels`），不在服务器设置里。

## 5. Antigravity（ACP，`lib/acp-client.mjs`）

- 一个随包的 ACP 程序进程，按 `parseConcurrency` 限制同时请求数；每个阶段（启动、认证、会话、设置、请求）有各自的超时。
- 会话：同一组、同样指令的请求共用会话（指令只发一次）；`sessionGroup:null` 单独开会话。课件每页现在各用一个新会话。
- 工具：智能体可用的工具由 `skills/agent_tools.md` 规定；工具调用累计超过 120 秒会停止，并以不用工具的方式重新请求一次。
- 读取模型列表（inspect）只切换会话设置，不发请求、不耗额度；但会启动 Antigravity，属于调用外部服务。
- 完整请求日志（设置 → 高级）在 `data/diagnostics/acp/`，只能统计时间、数量、结构。

## 6. 疑点与提示（`lib/doubts.mjs`）

- 只有"未能识别"的页算未完成并会重试；其他疑点是该页的"解析提示"，可标记已核对（`hint-checks.json`，不改解析结果）。
- "缺少课件字体"按文件只记一次（`deckNotes`）。
- "文字可能超出页面""缺少字体"是近似绘制对自己画法的检查，原页精确绘制时不显示（`exactPages`）。
- 计数规则改了要提高 `DOUBT_VERSION`，旧结果在启动时重算；找不到保存结果的旧计数只计从未完成的页。

## 7. 什么时候算"过时"

- 规则在 `lib/workflow.mjs`，前端 `web/src/lib/classroom.ts`、`deepdive.ts` 必须一致。
- 课件区分"原件已变更"（`sourceChanged`）和"材料有变化"（`stale`）。
- **讲稿只跟随自己的字幕**（2026-11-24）：字幕是讲课内容的唯一来源，课件和文献只用来校对术语（`skills/class_script.md`）。只有本节字幕被更换（`outputRevision!==revision`）才算过时；材料变化不算。
- **Deep Dive 跟随它读过的材料内容**：本周材料的"课程上下文"读什么（课件每页原文、画面描述、讲者备注、疑点和课程大纲；文献的识别文字；课程介绍）由 `lib/material-inputs.mjs` 算成每份材料的指纹，存在 `project.json` 的 `materialInputs`（材料计数 `materialRevision` 变化后，打开本周或发布结果时重算，不调用模型）。讲稿、本节 Deep Dive、整周 Deep Dive 生成时记下当时的指纹；之后只有指纹真的变了才算过时，界面说出是哪份材料（`materialChanges`）。只重新翻译或解读课件不改变指纹。
- 没有记下指纹的旧结果仍按材料计数判断；课件导读的上下文文字由 `learningNote` 生成，`lib/study.mjs` 与指纹共用，改上下文内容时两边自然一致。
- 导读是否"按旧图生成"见第 2 节的 `sameImages`。

## 8. 前端约定

- 只有 `web/src/lib/api.ts` 调用后端；接口以 `docs/API.md` 为准。
- 阅读数据走 `web/src/lib/reader-cache.svelte.ts`（阅读页与概览共用），只在结果签名变化时重新读取；服务器通过 `/api/events` 推送变化。
- 自定义的模型下拉（`ModelPicker`）总在下方展开。
- 颜色、字号、间距只用 `web/src/styles/tokens.css` 的变量；状态词和按钮位置遵守 `docs/IA-PROPOSAL.md` 第 2 节。
- `public/next/` 是构建产物，改了 `web/` 必须重新构建并一起提交。

## 9. 测试

- 浏览器测试通过 `test/helpers/app.mjs` **按看得见的文字和标签**找元素：改按钮或标签文字会让测试失败，要一起改 `test/`。
- Antigravity 替身：`test/fixtures/mock-acp.mjs`。可用环境变量让它卡在某个阶段（`MOCK_ACP_HANG`）、忽略设置切换（`MOCK_ACP_IGNORE_CONFIG`）、输出登录地址（`MOCK_ACP_AUTH_URL`）等；其中 Mock Plain 模型没有思考强度。
- PowerPoint：平时用替身（`test/powerpoint-slides.test.mjs`）；设 `CLASSROOM_POWERPOINT=1` 时用真实 PowerPoint 逐字节核对。
- 测试副本：`runtime\node.exe scripts/test-server.mjs`（见 `AGENTS.md`）。

## 10. 和用户合作的经验

- 用户用中文交流，希望用通俗的话说明"做了什么、为什么"，发现问题直接说。
- 用户说"先给方案"时只给方案、不改文件；说"检查日志"时只统计时间、数量和结构。
- 用户双击 `Start.cmd` 运行的是当前检出的分支：切换分支就等于换了用户在用的版本，改完要提醒重启。
- 调用模型或外部服务、推送、删除分支或数据、修改 `skills/` 前都要先问，每次同意只对那一次有效。
