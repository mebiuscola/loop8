# Classroom Local · Windows 每周课程工作台

在本机整理每周的课程材料：上传课件、参考文献和课堂字幕/录音，生成双语阅读、课堂讲稿和 Deep Dive，并按课程、课件或文献提问。资料只保存在本机。

> 各版本的详细说明（模型设置、ACP、ChatGPT 订阅、MinerU、PPT 解析等）都在 [CHANGELOG.md](CHANGELOG.md) 里，原文完整保留。

## 启动

1. 双击 `Start.cmd`。有 `runtime\node.exe` 时直接使用它；否则需要本机安装 Node.js 22 或更高版本。
2. 浏览器会自动打开本地网页。任务运行期间不要关闭启动窗口。
3. 更新程序后，关闭旧的启动窗口，重新运行 `Start.cmd`，网页按 Ctrl+F5 刷新。

## 文件夹

| 路径 | 内容 |
|---|---|
| `data/` | 你的课程资料与设置（含密钥）。**不进 git，需单独备份**，见 `tools/backup-data.cmd` |
| `server.mjs`, `lib/` | 本地服务与业务逻辑 |
| `public/` | 网页前端 |
| `skills/` | 应用调用 AI 时使用的提示词，可按需编辑 |
| `test/` | 自动测试 |
| `docs/` | 开发文档：[接口清单](docs/API.md)、[界面问题清单](docs/UI-ISSUES.md) |
| `ACP.md` | Antigravity ACP 使用说明 |
| `PRODUCT.md` | 产品定位与约束 |
| `AGENTS.md` / `CLAUDE.md` | 给 AI 开发助手的项目规则 |

## 开发与发布

1. 从 `main` 建立短分支（`fix/…`、`feature/…`）。缺陷先记录复现步骤和预期结果，并补回归测试。
2. 源码检出需要 Node.js 22+，运行 `npm ci` 安装依赖。`runtime/`、`node_modules/`、`agy-acp-server/` 不在 git 中，可从对应版本的发行包复制。
3. 修改后运行 `npm test`（浏览器测试需要 Edge 或 Chrome）。发布前用课程副本验证：材料阅读、翻页和刷新、课堂讲稿、失败后已有成果仍可读。
4. 更新 `package.json` 的版本号和 `CHANGELOG.md`，合并回 `main`，打版本标签（如 `v2.25.18`），推送到远程仓库。

## 备份与恢复

- 运行 `tools\backup-data.cmd`：关闭服务后，把 `data/` 和 `.env` 复制到带日期的备份文件夹。
- 恢复演练：在独立目录设置 `CLASSROOM_DATA` 指向备份，启动服务，确认课程和原件可读。
- 仓库本身不包含个人课程和账号配置。
