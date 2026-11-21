# 交接说明：从 claude.ai 对话转到 Claude Code（2026-11-21）

> 给接手的 Claude Code 会话。请完整读完本文件，再读 `AGENTS.md`（规则）、`PRODUCT.md`（产品约束）、`docs/API.md`（接口）。
> 用户用中文交流，请用中文、用通俗的话解释你在做什么；技术细节可以简短，但每一步的目的要说清楚。

---

## 1. 项目与用户

- **Classroom Local**：用户此前用 Codex 制作的本地课程管理网页，当前版本 **v2.25.17**（以 `package.json` 为准；README 标题、页面里写的 v2.25.8 / v2.25.10 都是旧的）。
- 用户：比较文学专业学生，单人使用，Windows 11，桌面浏览器。
- 运行方式：双击 `Start.cmd` → 用 `runtime\node.exe`（随包 Node）运行 `server.mjs --open`。用户日常**不使用 npm**，也不会自己构建前端。
- 结构：`server.mjs`（81KB，全部路由）+ `lib/`（约 50 个业务模块）+ `public/`（原生 JS/CSS 前端）+ `skills/`（**本应用调用 AI 的提示词**，不是开发助手的 skills）+ `test/`（约 45 个 `node --test` 测试）。
- `data/`：用户的私人课程资料（课件、文献、字幕、录音、生成结果）和 `data/settings.json`（**含 API 密钥、令牌**）。**禁止读取内容、修改、提交。**

## 2. 上一个会话的结论

用户觉得现在的前端"有大量操作逻辑和 UI 显示问题"。审阅代码后的判断：

- **后端质量不错**：模块划分清楚，有测试，业务规则（保留原件、不编造讲师发言、断点续跑、ACP/MinerU 容错）都写进了代码。
- **前端是补丁叠出来的**：
  - 四个工作区写在同一个 `index.html` 里，靠 `hidden` 切换；`app.js` 73KB，十几个全局可变状态，`querySelector` 300+ 次，JS 在运行时还会搬动工具栏和菜单。
  - `style.css` 按版本层层覆盖（注释可见 v1.8、v2.0、Parallel Score…），966 条规则里 181 个选择器重复定义。
- **已决定：只重做前端，保留后端**（`server.mjs`、`lib/`、`skills/`、`test/`）。
- 重做原则：
  1. **先重新设计信息架构和操作流程，再写代码**，不要照搬旧布局。
  2. 新前端与旧前端**并存**（例如新前端挂在 `/next`），逐个工作区替换，旧界面在迁移完成前保持可用。建议顺序：材料阅读 → 设置 → 讲稿 → Deep Dive。
  3. 视觉方向沿用用户确认过的：深青 `#213B3A` / `#28665F`、浅砂 `#EEEEE7`，**不要装饰性插图**。
  4. `DESIGN.md` 和 `.impeccable/` **已过时**，不要作为当前设计依据。

## 3. 上一个会话已经写进项目的文件

| 文件 | 说明 |
|---|---|
| `AGENTS.md` | 项目规则（目录权限、8 条硬性规则、分支/测试/版本做法、重做决定） |
| `CLAUDE.md` | 只有一行 `@AGENTS.md`，让 Claude Code 读同一份规则 |
| `docs/API.md` | 从 `server.mjs` 整理的前后端接口清单（新前端只依赖它） |
| `docs/UI-ISSUES.md` | 界面问题清单模板（还没填） |
| `docs/HANDOFF.md` | 本文件 |
| `README.md` | 重写为简短版：启动、目录、开发、备份 |
| `CHANGELOG.md` | 原 71KB README 的**完整原文**，原样保留 |
| `DESIGN.md` | 只在开头加了"已过时"说明 |
| `.gitignore` | 新增 `.claude/settings.local.json`、`Thumbs.db`、`desktop.ini` |
| `tools/backup-data.cmd` | 把 `data/` 和 `.env` 备份到 `文档\Classroom-Backups\带日期文件夹` |
| `tools/git-baseline.cmd` | 想一次完成 git 基线的脚本——**在用户电脑上没跑通**，见下一节。由你直接用 git 命令完成后，可以删掉这个脚本 |

## 4. git 现状与已知问题

- 仓库由 Codex 创建：初次提交是 "Baseline Classroom Local 2.25.10"，之后在 `fix/…`、`feature/…` 短分支上提交并快进合并回 `main`，最后一次合并是 `fix/native-acp-logout`（v2.25.17）。
- 提交身份是 Codex 的占位：`Classroom Local <classroom@localhost.invalid>`（写在仓库的 `.git/config` 里）。
- **没有远程仓库。**
- **有未提交的改动**：`server.mjs` 的修改时间晚于最后一次提交；另外还有第 3 节里的新文档。
- **git 程序问题**：git 装在 `C:\Program Files\Git`，但可能不在系统 PATH 里。脚本运行时报过 `'git' 不是内部或外部命令`。如果你的终端里 `git --version` 失败，先用完整路径 `"C:\Program Files\Git\cmd\git.exe"`，并协助用户把 `C:\Program Files\Git\cmd` 加进**用户或系统环境变量**的 Path（桌面应用不读 PowerShell 配置文件，改完要完全退出再重开）。
- **可能的所有权问题**：Codex 在 Windows 上以沙盒用户运行，git 可能报 `detected dubious ownership`。遇到时**只信任这一个文件夹**：
  `git config --global --add safe.directory "<项目路径，用正斜杠>"`
  不要使用 `safe.directory '*'`。
- 用户可能已把项目从 Codex 的输出目录复制到 `C:\Users\zhy64\Code\classroom-local`。以你当前打开的文件夹为准，先确认 `.git` 在里面。

## 5. 第一项任务：完成 git 基线并推送到 GitHub

按顺序做，每一步都向用户说明；涉及 GitHub 账号的地方请用户操作或确认。

1. **确认环境**：`git --version`；确认当前在 `main`（`git branch --show-current`）；`git status` 看有哪些改动。
2. **设置提交身份**（问用户）：名字，以及邮箱。如果用户不想公开邮箱，建议使用 GitHub 提供的 `ID+用户名@users.noreply.github.com`。用仓库级设置：`git config user.name …`、`git config user.email …`。
3. **上传前检查**（见第 6 节，全部通过再继续）。
4. **第一次提交：只提交原有的未提交代码改动**，不含第 3 节的新文档和脚本。提交后打附注标签 `v2.25.17-legacy`（"旧前端的最后状态"）。如果原有代码没有改动，就直接给当前 HEAD 打这个标签。
5. **第二次提交**：第 3 节的文档、`.gitignore` 和 `tools/`。
6. **创建分支** `redesign/frontend`（暂时不用切换过去）。
7. **远程仓库**：请用户在 GitHub 新建一个**私有**空仓库（不要勾选添加 README 或 .gitignore），把地址给你。然后：
   `git remote add origin <地址>`
   `git push -u origin main`
   `git push origin redesign/frontend`
   `git push origin --tags`
   第一次推送会弹出 Git Credential Manager 的浏览器登录，让用户自己完成。
8. 推送后请用户在 GitHub 网页上确认：仓库是 Private；文件列表里**没有** `data/`、`.env`、`runtime/`、`agy-acp-server/`、`node_modules/`。

**不要做的事：**
- 不要 `push --force`，不要改写已有历史（包括 Codex 的占位作者），不要 `git add` 被忽略的文件。
- 不要修改 `core.autocrlf`（目前是 false，保持不变）。

## 6. 上传（推送）前必须检查的事

1. **私人资料没有被纳入**：
   - `git check-ignore -v data/settings.json .env runtime/node.exe agy-acp-server/agy_acp_server.exe` 应该都显示被忽略（不存在的文件会被跳过，没关系）。
   - `git status --short`，以及暂存后的 `git diff --cached --name-only`：列表里不能出现 `data/`、`.env`。
2. **没有密钥混在代码或文档里**：在**将被提交的文件**里搜索常见密钥格式，例如 `sk-`、`Bearer `、`api_key`、`token=`、`MINERU`，并检查 `.env.example` 里的值是空的。发现可疑内容时，先停下来问用户。
3. **没有超大文件**：GitHub 拒收超过 100MB 的单个文件，超过 50MB 会警告。`runtime/node.exe`（约 92MB）和 `agy-acp-server/*.exe`（约 55MB、148MB）都应被忽略。检查将被提交的文件里有没有超过 20MB 的（`public/vendor/pdfjs` 约 3.5MB，正常）。
4. **课程资料版权**：`data/classes/` 里的课件、文献、录音是课程的私人材料，**永远不要提交**，私有仓库也不行。`test/fixtures/` 里的是自制的测试文件，可以提交。以后往 `docs/screenshots/` 放截图时，提醒用户截图会进入仓库，里面不能露出密钥或账号信息。
5. **数据先单独备份**：git 不备份 `data/`。推送前提醒用户运行 `tools\backup-data.cmd`，或手动把 `data/` 和 `.env` 复制到别处。

## 7. 第二项任务（基线完成后）：为前端重做做准备

还不要写新前端的代码。先完成：

1. **测试基线**：运行 `npm ci`（需要的话）和 `npm test`，记录哪些测试原本就失败。浏览器测试需要本机有 Edge 或 Chrome。
2. **把应用跑起来逐页检查**：启动服务，在浏览器里把每个工作区点一遍，截图，找出操作逻辑和显示问题，写成 `docs/UI-ISSUES.md` 的初稿。工作区包括：侧栏、本周材料、材料阅读（课件 / 参考文献）、课堂讲稿、Deep Dive、Ask、模型与解析设置、后台任务提示。然后请用户补充自己的感受。**不要修改 `data/` 里的任何课程**；需要测试写操作时，新建一个测试课程，测完删掉。
3. **信息架构方案**：根据问题清单，提出新的页面结构和主要操作流程（文字说明加草图即可），等用户确认。
4. **技术方案，请用户决定**：建议 Vite + TypeScript + 一个组件框架（React 或 Svelte）。要说明代价：用户不用 npm，所以构建好的静态文件要么提交进仓库，要么由发布步骤生成后随包分发；`Start.cmd` 的用法不能变。另外需要确定新前端挂载的路径（如 `/next`）以及 `server.mjs` 怎样提供这些文件。
5. 确定的结果写回 `AGENTS.md` 的"前端重做"一节。

## 8. 与用户合作的方式

- 用中文、通俗地说明；先说要做什么、为什么，再动手。
- 不可撤销的操作（删除、推送、改全局设置）先征得用户同意。
- 一个提交只做一件事；在分支上工作，不直接改 `main`。
- 改了界面就在浏览器里实际看一遍，附截图，不要只看代码就说"完成"。
- 遇到报错，给出原文和你的判断，不要反复盲目重试。
