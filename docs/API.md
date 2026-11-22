# Classroom Local · 前后端接口清单

> 整理自 `server.mjs`（v2.25.17）。新前端只通过这里列出的接口与后端交互。
> 修改接口时，请同步更新本文件；未在此列出的行为不应被前端依赖。

## 通用约定

- 服务只接受同源请求：带 `Origin` 且与本机地址不符时返回 `403`。
- 请求体为 JSON（`Content-Type: application/json`），上传类接口例外（见下文）。
- 错误统一返回 `{ "error": "中文说明" }`，HTTP 状态非 2xx。前端直接把 `error` 显示给用户。
- `409`：材料或结果正在提交（存在 `.output-transaction.json` 或材料提交日志）。提示用户稍后重试或重启。
- 长任务返回 `202` 和一个任务对象，之后用对应的 `jobs` 接口轮询或取消。
- 进度：前端每隔几秒 `GET /api/projects/:id`，读取 `status`、`stage`、`files[].progress`、`tasks`。目前没有 SSE 或 WebSocket。
- 凭据永不返回：设置接口会去掉 `apiKey`、`mineruToken` 等，只返回 `hasXxx` 布尔值。

记号：`:id` 是每周课程的 id（如 `Week_DebateW4_95c62a5a`），需要 `encodeURIComponent`。

---

## 0. 前端页面

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 新前端页面（`public/next/index.html`） |
| GET | `/next`、`/next/`、`/next/index.html` | `302` 跳到 `/`（地址栏中的 `#/…` 保留） |
| GET | `/legacy` | `302` 跳到 `/legacy/` |
| GET | `/legacy/` 及旧前端静态文件 | 旧前端，暂留到旧界面浏览器测试改写完成后删除 |
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
| POST | `/api/projects/:id/ai-parse` | 体：`{sourceId, fresh?, retryIssues?, retryFailed?, teachingPart?}`。PPT 走 pptRecognition/Translation/Explanation，PDF 走 pdfRecognition。本周已有任务在跑时拒绝 |
| POST | `/api/projects/:id/ai-parse-cancel` | 体：`{sourceId}` |
| GET | `/api/projects/:id/ai-partial?source=` | 查看部分结果 |
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

`POST /api/projects/:id/process`，体：`{mode, sessionId?, sourceId?, referenceProfileId?}`

| mode | 内容 | 用到的模型任务 |
|---|---|---|
| `preparation` | 课件识别、翻译、导读 | context, pptRecognition, pptTranslation, pptExplanation |
| `session` | 本节课讲稿 | context, classroom, transcriptTranslation |
| `analysis` | 本节课 Deep Dive | context, deepDive |
| `week` | 整周 Deep Dive | context, weeklyDeepDive |
| `reference` | 参考文献翻译 | referenceTranslation |
| `reading` | Reading / BB PDF 解析（需 `sourceId`） | — |

若所选模型是 ACP 或 ChatGPT 订阅，返回值中带 `acpJobId` 或 `chatgptJobId`，前端随后用第 7 节的 jobs 接口跟踪。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/:id/output?name=&scope=` | 下载生成结果（Markdown）。`scope` 为 session id 或 `week` |

## 5. 阅读

### 课件

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/:id/reader?version=` | 课件阅读数据（逐页原文、译文、细读） |
| GET | `/api/projects/:id/page-image?source=&page=` | 缓存的页面截图 |
| POST | `/api/projects/:id/preview?source=` | 生成预览。体：`{force?}`，返回 `202` |
| GET | `/api/projects/:id/preview-status?source=` | 预览状态 |
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
| GET | `/api/projects/:id/reference-reader?source=` | 段落、译文、进度、是否过期 |
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
| POST | `/api/settings/editor` | 分区保存。体：`{section, …}`。section ∈ `model`（体含 `profile`、`acpPaths?`）、`delete-model`（`profileId`）、`models`、`routes`、`mineru`、`preview`、`advanced` |
| POST | `/api/settings/model-test` | 测试某个模型连接。体：`{kind, profile}`，kind ∈ `ai/text/json/vision/inspect/login`。返回 `202` 任务 |
| POST | `/api/settings/test` | 测试 MinerU、视觉模型等。体：`{kind, settings?, task?}` |
| GET | `/api/settings/test/:jobId` | 测试结果 |
| POST | `/api/settings/test/:jobId/cancel` | 停止测试 |
| POST | `/api/settings/acp-logout` | 体：`{profileId, confirm:true}` |
| POST | `/api/acp/connect` | 体：`{action, profileId, settings?}`，action ∈ `inspect/login/text/vision` |
| GET | `/api/chatgpt/status` | ChatGPT 订阅登录状态与用量 |
| POST | `/api/chatgpt/login` | 体：`{reconsent?}` |
| POST | `/api/chatgpt/disconnect` | 断开 |
| GET | `/api/chatgpt/models` | 可用模型列表 |

---

## 重做前端时需要留意

1. **进度靠轮询整个项目对象。** 项目 JSON 可能有几十 KB；新前端可以继续这样做，但要集中在一处轮询，不要每个组件各自请求。
2. **任务状态有三套来源：** 项目对象里的 `tasks` / `status`、ACP jobs、ChatGPT jobs。新前端最好统一成一个"后台任务"数据层。
3. **删除操作都分两步：** 先 `*-plan` 看影响，再带 `confirm:true` 执行。界面上应保留这个确认步骤。
4. **`/api/settings` 和 `/api/settings/editor` 并存。** 新前端只用 `editor`；确认没有其他调用后，旧接口可以删除。
