# Classroom Local · 前后端接口清单

> 整理自 `server.mjs`（v2.25.17）。新前端只通过这里列出的接口与后端交互。
> 修改接口时，请同步更新本文件；未在此列出的行为不应被前端依赖。

## 通用约定

- 服务只接受同源请求：带 `Origin` 且与本机地址不符时返回 `403`。
- 请求体为 JSON（`Content-Type: application/json`），上传类接口例外（见下文）。
- 错误统一返回 `{ "error": "中文说明" }`，HTTP 状态非 2xx。前端直接把 `error` 显示给用户。
- `409`：材料或结果正在提交（存在 `.output-transaction.json` 或材料提交日志）。提示用户稍后重试或重启。
- 长任务返回 `202` 和一个任务对象，之后用对应的 `jobs` 接口轮询或取消。
- 进度与变化通知：`GET /api/events` 是服务器推送的事件流（SSE，`text/event-stream`）。每次课程数据保存后推送 `{type:"course", id, revision}`；任何修改 `/api/projects…` 的请求结束后推送 `{type:"list"}`（新建、改名、删除课程）。前端收到后重新读取 `GET /api/projects` 与当前课程，读取 `status`、`stage`、`files[].progress`、`tasks`。连接断开时浏览器自动重连（`retry: 3000`），前端在重连后补读一次，并在断开期间改回轮询。每 25 秒有一行注释保持连接。将来部署到服务器时，这个接口和其他接口一样需要登录保护；经过反向代理时要关闭缓冲（已发送 `X-Accel-Buffering: no`）。
- 凭据永不返回：设置接口会去掉 `apiKey`、`mineruToken` 等，只返回 `hasXxx` 布尔值。

记号：`:id` 是每周课程的 id（如 `Week_DebateW4_95c62a5a`），需要 `encodeURIComponent`。

---

## 0. 前端页面

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 新前端页面（`public/next/index.html`） |
| GET | `/next`、`/next/`、`/next/index.html` | `302` 跳到 `/`（地址栏中的 `#/…` 保留） |
| GET | `/legacy`、`/legacy/` | `302` 跳到 `/`（旧前端已在 v2.26.0 删除） |
| GET | `/parse-render.*`、`/render-audit.js`、`/pptx-frame.*`、`/reading-reference.js`、`/reading-reference.css` | 独立页面：原页渲染、实时 PPTX 预览、引文原文对照 |
| GET | `/next/…` | 新前端构建产物，来自 `public/next/`。`index.html` 不缓存，其余带哈希的资源长期缓存；CSP 不允许内联脚本。未构建时返回 `404 {error:"新界面尚未构建。"}`；越出目录的路径返回 `400` |

## 1. 每周课程（项目）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects` | 课程列表 |
| POST | `/api/projects` | 新建课程。体：`{name}`。返回 `201` 和新项目对象 |
| GET | `/api/projects/:id` | 完整项目对象（轮询进度也用它）。若有未完成的材料删除，会附带 `materialDeletionPending` |
| POST | `/api/projects/:id/week-rename` | 体：`{name}` |
| GET | `/api/projects/:id/week-delete-plan` | 删除前的影响摘要 |
| POST | `/api/projects/:id/week-delete` | 体：`{confirm:true}`。永久删除整周 |

项目对象的主要字段：`id, name, created, status, stage, files[], bbText, revision, materialRevision, sessions[], chat[], tasks{}, preparation, generation`。

材料的 AI 解析状态 `files[].aiParse` 中：`incomplete` 是未能识别、需要重试的页数；`hints` 是还有未核对提示的页数；`notes` 是整份材料的附注（如缺少字体）。提示不影响页面状态（2026-11-23 起；旧结果在启动时按已保存的结果重新计数，不重新解析）。

## 2. 材料

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/projects/:id/bb` | 保存 Blackboard 介绍文字。体：`{text}` |
| POST | `/api/projects/:id/upload` | **原始字节上传**。头：`X-File-Name`（URL 编码）、`X-File-Role`（`bb`/`ppt`/`reading`/`srt`）。允许扩展名：bb `.md .txt .pdf`；ppt `.ppt .pptx .pdf`；reading `.pdf`；srt `.srt`。同名不同内容会自动编号另存 |
| POST | `/api/projects/:id/material-role` | 改材料用途。体：`{sourceId, role}`，role ∈ `ppt/reading/bb` |
| GET | `/api/projects/:id/source?id=` | 下载原件（录音走音频流） |
| GET | `/api/projects/:id/material-delete-plan?source=` | 删除影响摘要 |
| POST | `/api/projects/:id/material-delete` | 体：`{sourceId, confirm:true}` |
| POST | `/api/projects/:id/parsed?source=` | 导入外部解析 JSON（请求体为文本，≤30MB） |
| GET | `/api/projects/:id/analysis?source=` | 读取已导入的完整 PPT 分析 JSON |
| GET | `/api/ppt-skill` | 下载外部解析用的 `course-ppt-parser.zip` |

### AI 解析（单份材料）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/projects/:id/ai-parse` | 体：`{sourceId, fresh?, retryIssues?, retryFailed?, teachingPart?, pages?, part?}`。PPT 走 pptRecognition/Translation/Explanation，PDF 走 pdfRecognition。本周已有任务在跑时拒绝。**单页重做（2026-11-24）：** `pages`（页码数组，只用于已完成的课件页，不能与 fresh、retryIssues、retryFailed、teachingPart 同用）加 `part`：`all` 重新识别、翻译和解读，`translation` 只重新翻译，`explanation` 只重新解读。只重做这些页，其他页不变；沿用这份课件已保存的规则（本周其他材料变化不会让其他页重做）；不复用旧回复。原结果在新结果保存前保留，失败或停止时放回原结果（任务显示"重做未完成 / 已停止重做 · 保留原来的结果"）。完成后整课检查只重新检查该页所在的一组 |
| POST | `/api/projects/:id/ai-parse-cancel` | 体：`{sourceId}` |
| GET | `/api/projects/:id/ai-partial?source=` | 查看部分结果 |
| POST | `/api/projects/:id/task-dismiss` | 确认（"知道了"）一个失败或停止的任务。体：`{key}`。记在任务上：`tasks[key].dismissed` = 被确认的那次运行（`finished||started` + `|` + `error`）；同一任务再次运行后失败会重新显示 |
| POST | `/api/projects/:id/hint-check` | 把某页的一条提示标为已核对（或撤销）。体：`{sourceId, page, hint, checked?}`；hint 必须是该页现有提示的原文；解析进行中时拒绝。返回 `{page, checked[], hints}` |
| POST | `/api/projects/:id/ai-partial-import` | 体：`{sourceId, confirm:true}`，采用部分结果 |
| POST | `/api/projects/:id/ai-cache-clear` | 体：`{sourceId}`，清除 AI 缓存 |
| POST | `/api/projects/:id/page-cache-clear` | 体：`{sourceId}`，清除 PPT 页面截图缓存（旧前端未使用） |

## 3. 课堂（Session）、字幕与录音

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/projects/:id/sessions` | 新建一节课。返回 `201 {project, session}` |
| POST | `/api/projects/:id/session-rename` | 体：`{sessionId, title}` |
| GET | `/api/projects/:id/session-delete-plan?session=` | 删除影响摘要 |
| POST | `/api/projects/:id/session-delete` | 体：`{sessionId, confirm:true}` |
| POST | `/api/projects/:id/audio-upload` | **原始字节上传**。头：`X-Session-Id`、`X-File-Name` |
| GET/HEAD | `/api/projects/:id/audio?id=` | 录音流（支持 Range） |
| POST | `/api/projects/:id/audio-binding` | 体：`{sessionId, offsetMs?…}`，录音与字幕对齐 |
| GET | `/api/projects/:id/transcript?session=&version=` | 双语讲稿时间线 |

SRT 字幕通过 `upload` 上传，`X-File-Role: srt`。

## 4. 生成任务

`POST /api/projects/:id/process`，体：`{mode, sessionId?, sourceId?, referenceProfileId?, engine?}`

**排队（2026-11-23）：** `mode:"reference"` 在本周有其他任务正在写入课程时（课件 AI 解析、PDF 解析、讲稿等生成、原页渲染）不再报"此课程正在处理请求"，而是排队：返回 202 和项目对象，`tasks["reference:<sourceId>"] = {status:"queued", stage, queued, request}`；课程空闲后由服务器按普通启动流程自动开始（所有启动检查照常）。重启后排队的任务会重新排队。`POST /api/projects/:id/queue-cancel`，体：`{key}`，取消排队中的任务（任务变为 `error`，`error:"已取消排队。"`）。

| mode | 内容 | 用到的模型任务 |
|---|---|---|
| `preparation` | 课件识别、翻译、导读 | context, pptRecognition, pptTranslation, pptExplanation, deckReview（整课检查；未单独指定时跟随 pptRecognition。思考强度见 `modelThinking`（第 8 节），可为整课检查单设较低强度） |
| `session` | 本节课讲稿 | context, classroom, transcriptTranslation |
| `analysis` | 本节课 Deep Dive | context, deepDive |
| `week` | 整周 Deep Dive | context, weeklyDeepDive |
| `reference` | 参考文献翻译（2026-11-24 起）：先从这篇文献本身整理术语表（每约 3 万字一次请求，模型给出的词必须在原文中出现才保留，最多 120 条，存于 `Parsed/<id>/reference-terms.json`，原文解析不变时复用；失败时照常翻译并给出提示），再按约 4000 字符 / 12 段一批翻译（可跨页），按"材料解析并发数"同时进行；每批只带上批内出现的术语 `referenceTerminology`，不带课件的本周术语表 | referenceTranslation, referenceTerms（参考文献术语整理；未单独指定时跟随 referenceTranslation） |
| `reading` | Reading / BB PDF 解析（需 `sourceId`）。先读 PDF 自带文字层，扫描件或文字损坏时交给 MinerU；`engine:"mineru"` 始终用 MinerU。完成后文件带 `parseSource`：`text-layer` 或 `mineru`（旧数据和导入的解析没有此字段） | — |

若所选模型是 ACP 或 ChatGPT 订阅，返回值中带 `acpJobId` 或 `chatgptJobId`，前端随后用第 7 节的 jobs 接口跟踪。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/:id/output?name=&scope=` | 下载生成结果（Markdown）。`scope` 为 session id 或 `week` |

## 5. 阅读

### 课件

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/:id/reader?version=` | 课件阅读数据（逐页原文、译文、细读）。有 AI 解析时，每页带 `hints:[{text, checked}]`（解析疑点，不影响页面状态），并带整份课件的 `notes`（例如本机缺少课件字体）。`renderKey`：当前原页图片的版本；`drawnBy`：原页由谁绘制 `{kind:"powerpoint"|"pdf"|"converting"|"approximate", engine?, generated?, reason?}`（approximate 为内置近似绘制，reason 说明为什么没有用 PowerPoint）。打开 PPT/PPTX 时若还没有 PowerPoint 绘制的原页，会在后台开始绘制 |
| GET | `/api/projects/:id/page-image?source=&page=` | 缓存的页面截图。带 `ETag`；请求带相同的 `If-None-Match` 时返回 304（不重新发送图片） |
| POST | `/api/projects/:id/preview?source=` | 生成预览。体：`{force?}`，返回 `202`。**PowerPoint 绘制原页（2026-11-24）：** 用本机 PowerPoint 时，打开课件副本（只读、无窗口、不运行宏），把每页（含隐藏页）导出为 1920 像素宽的 PNG，同时另存 PDF；这些 PNG 就是阅读页和发给模型的原页图片。PPT/PPTX 上传、打开阅读页、生成导读前会自动开始（导读会等它完成；失败时用内置近似绘制，只在用户点"用 PowerPoint 重新生成原页"时重试）。`force:true` 重新绘制。脚本以 `-ExecutionPolicy Bypass` 只对本次运行放行（Windows 默认禁止运行脚本）。测试中不自动启动 PowerPoint，除非设置 `CLASSROOM_POWERPOINT=1` |
| GET | `/api/projects/:id/preview-status?source=` | 预览状态。`slides:true` 表示原页图片由 PowerPoint 导出；`generated` 为生成时间 |
| GET | `/api/projects/:id/preview-file?source=` | 预览 PDF |
| POST | `/api/projects/:id/preview-pdf?source=` | 关联用户导出的 PDF（原始字节，≤150MB） |
| POST | `/api/projects/:id/preview-clear?source=` | 清理预览 |
| POST | `/api/projects/:id/ppt-page-preview` | 单页 PPT 试解析（用"单页 PPT 试解析"分配的模型，需图片输入）。体：`{sourceId, pageIndex}`（0 起）。返回 `202 {id, transport}`，`transport` 为 `acp` / `chatgpt` / `preview`，用第 7 节对应的 jobs 接口跟踪；结果 `result` 为 `{page:{paragraphs[{english,chinese}],closeReading}, warnings[]}`，只用于查看，不写入课程 |
| GET | `/api/projects/:id/preview-source?source=` | PPTX 原件字节（浏览器内渲染用） |
| GET | `/api/projects/:id/preview-fonts?source=` | PPTX 所需字体的本地匹配情况 |
| GET | `/api/preview-font/:name` | 字体文件 |
| GET | `/api/parse-resource/:rid/(file\|native)` | 网页内解析时的临时渲染资源 |

### 参考文献

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/:id/reference-reader?source=` | 段落、译文、进度、是否过期；`terminology`：本文术语表 `{terms:[{english,chinese,scope,pages,alternatives?}],status:"complete"|"partial",error,current}` 或 null（current 为 false 表示原文解析已更新，下次翻译时重新整理）。AI 整理，界面与原文、译文分开显示 |
| GET/HEAD | `/api/projects/:id/reference-file?source=` | 参考文献 PDF 原件 |
| GET | `/api/projects/:id/reading-reference?ref=` | 独立的引用查看页面（HTML） |
| GET | `/api/projects/:id/reading-reference-data?ref=` | 引用数据 |
| GET/HEAD | `/api/projects/:id/reading-pdf?ref=` | 引用对应的 PDF |

## 6. Ask 问答

`POST /api/projects/:id/ask`，体：`{question, scope, focus}`

- `question`：1–10000 字符。
- `scope`：默认 `week`；可指向某节课、某份课件或参考文献。`focus` 可指定页码等，由后端 `validFocus` 校验。
- 同一 `[scope, focus]` 不能同时问两次。
- 普通 API 模型直接返回结果；ChatGPT 订阅返回 `202 {chatgptJobId}`，ACP 返回对应 job。

## 7. 后台任务（jobs）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/acp/jobs/:jobId` | ACP 任务状态 |
| POST | `/api/acp/jobs/:jobId/cancel` | 停止 |
| POST | `/api/acp/jobs/:jobId/permission` | 体：`{permissionId, optionId}` |
| GET | `/api/chatgpt/jobs/:jobId` | ChatGPT 订阅任务状态 |
| POST | `/api/chatgpt/jobs/:jobId/cancel` | 停止 |
| GET | `/api/preview/jobs/:jobId` | 预览任务状态 |
| POST | `/api/preview/jobs/:jobId/cancel` | 停止 |

## 8. 设置与模型连接

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/settings` | 旧版设置读取（脱敏）。当前前端未调用 |
| POST | `/api/settings` | 旧版整体保存。当前前端未调用 |
| GET | `/api/settings/editor` | 新设置编辑器数据（脱敏，含 `acpPaths`、`modelProfiles`）。`acpBundled`：随包分发的 `agy-acp-server\agy_acp_server.exe` 的绝对路径，文件不存在时为空字符串；只读，不写入设置 |
| GET | `/api/acp/traces` | Antigravity 完整日志列表（设置 `acpTrace` 为 true 时每次请求写一个文件到 `<data>/diagnostics/acp/`）：`{enabled, files:[{name,size,at}], totalBytes}`。日志含课程内容（发送的全文、思考、工具调用与结果、回复），只存在本机，从不打印 |
| GET | `/api/acp/traces/:name` | 下载一个日志文件（JSON Lines：request、每条消息、permission、result 或 error） |
| POST | `/api/acp/traces-clear` | 体：`{confirm:true}`，删除全部日志文件 |
| GET | `/api/acp/timings` | 最近 50 次 Antigravity 请求各阶段耗时（秒）：`{timings:[{at,total,phases:{starting,initialize,authenticate,session,config,prompt,responding,thinking,tools,generating},reusedProcess,reusedSession,images,model,thoughtUpdates,toolCalls,toolKinds,toolTimeout?,noTools,promptChars,imageKB}]}`（promptChars：本次发送的文字字符数；imageKB：图片大小）（prompt：请求发出到 Antigravity 有任何动静；responding：有动静但还没开始思考；thinking：从第一段思考起；tools：智能体自己的工具调用；generating：从回答的第一个字起；思考内容只计数、不保存；toolKinds 只记工具类别的次数，例如 {search:2}，不记查询内容。工具调用累计超过 120 秒的请求会停止（toolTimeout），并以不使用工具的方式重新请求一次。Antigravity 可用的工具由 `skills/agent_tools.md` 规定（只用网页搜索辨认图片，外部信息标明来源）。课件每页各用一个新会话（2026-11-23 起不再共用：共用后上下文变长，并没有更快））；不含请求或回复内容。Antigravity 的"测试"结果也附上这次的耗时 |
| POST | `/api/settings/editor` | 分区保存。体：`{section, …}`。section ∈ `model`（体含 `profile`、`acpPaths?`）、`delete-model`（`profileId`，删除一个模型）、`delete-connection`（`connectionId`，删除一个 API 连接下的全部模型）、`models`、`routes`（`modelRoutes`、`modelThinking`、`fallbackProfileId`、`fallbackEnabled`）、`mineru`、`preview`、`advanced`（advanced 含 `acpTrace`：保存 Antigravity 完整过程，默认关闭）。一个 API 连接可有多个模型：每个模型仍是一个 `profile`，同一连接的模型带相同的 `connectionId`（没有时等于自身 `id`，即单模型连接）；`baseUrl`、`outputTokenField`、`name`（连接名称）属于连接，保存其中一个模型时同步到同连接的其他模型，带新密钥或清除密钥时密钥也同步；新加的模型不带密钥时使用该连接已保存的密钥。**思考强度（2026-11-24）：** `modelThinking` 为每项功能单独设置思考强度 `{<功能>:<级别>, _default:<默认模型的级别>}`，与所选模型分开保存；没有设置的功能跟随所跟随的功能（单页试解析、整课检查跟随课件识别，参考文献术语整理跟随参考文献翻译）或默认模型，都没有时用模型自身的设置（Antigravity 连接的 `acpThinking`）。发送方式：Antigravity 切换会话的思考选项（级别来自读取模型列表）；API 连接加 OpenAI 兼容参数 `reasoning_effort`（low/medium/high）；ChatGPT 订阅加 `reasoning:{effort}`（级别来自该模型列出的级别，没有时为 low/medium/high）。API 与 ChatGPT 设置了思考强度时计入模型标识（`routeHash`），未设置时与以前相同 |
| POST | `/api/settings/model-test` | 测试某个模型连接。体：`{kind, profile}`，kind ∈ `ai/text/json/vision/inspect/login`。返回 `202` 任务 |
| POST | `/api/settings/test` | 测试 MinerU、视觉模型等。体：`{kind, settings?, task?}` |
| GET | `/api/settings/test/:jobId` | 测试结果 |
| POST | `/api/settings/test/:jobId/cancel` | 停止测试 |
| POST | `/api/settings/acp-logout` | 体：`{profileId, confirm:true}` |
| POST | `/api/acp/connect` | 体：`{action, profileId, settings?}`，action ∈ `inspect/login/text/vision` |
| GET | `/api/chatgpt/status` | ChatGPT 订阅登录状态与用量 |
| POST | `/api/chatgpt/login` | 体：`{reconsent?}` |
| POST | `/api/chatgpt/disconnect` | 断开 |
| GET | `/api/chatgpt/models` | 可用模型列表 `{models:[{modelId,name,thinking?,defaultThinking?}]}`（thinking：模型列出的思考强度级别） |

---

## 重做前端时需要留意

1. **进度靠轮询整个项目对象。** 项目 JSON 可能有几十 KB；新前端可以继续这样做，但要集中在一处轮询，不要每个组件各自请求。
2. **任务状态有三套来源：** 项目对象里的 `tasks` / `status`、ACP jobs、ChatGPT jobs。新前端最好统一成一个"后台任务"数据层。
3. **删除操作都分两步：** 先 `*-plan` 看影响，再带 `confirm:true` 执行。界面上应保留这个确认步骤。
4. **`/api/settings` 和 `/api/settings/editor` 并存。** 新前端只用 `editor`；确认没有其他调用后，旧接口可以删除。
