# Antigravity ACP · 本地交互式连接

本版接通官方 ACP 的个人账号认证、模型列表、文字 / JSON 与图片能力测试、Ask this class，以及逐步交互式课程生成。现有课程、Skill、来源检索、问答历史和 API 连接继续使用。

## 如何启用

1. 二选一：安装 [官方 Antigravity CLI](https://antigravity.google/docs/getting-started?tab=cli)，或者从 [ACP Registry 的 Google 发布条目](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json) 下载 Windows 独立 ZIP。独立版不需要 CLI；完整解压，保留同一版本的 `agy_acp_server.exe` 和 `localharness_external.exe`。不要只复制一个 EXE，不要重命名，不要使用 OAuth 反代或第三方修改过的运行时。
2. 双击 `Start.cmd`。进入“模型与解析设置 → AI 模型”，点击“添加模型”，连接方式选择“Antigravity · 官方 ACP”。
3. CLI 选择 CLI 入口并填写 `agy.exe` 的完整路径；独立版选择“独立 ACP · agy_acp_server.exe”，填写主程序的完整路径。应用检查同目录的配套 EXE，并自动为子进程设置 `ANTIGRAVITY_HARNESS_PATH`；不需要修改系统环境变量。ACP 协议连接直接启动上述原生 EXE。Windows 可用 `where.exe agy` 查找 CLI 入口。
4. 点击“个人账号登录”。界面依次显示启动、协议握手、官方认证及阶段耗时。浏览器未自动打开时，可使用面板内“打开登录页面”或“复制登录链接”。认证成功立即显示完成，不等待模型列表。若官方已保存有效凭据，可能无需再次弹出浏览器。凭据由官方运行时保存，本应用不读取登录缓存、OAuth token 或账号密码。之后单独点击“读取模型列表”，选择账号实际返回的模型及可用 Thinking 选项。选择模型不会自动发请求；切换模型后可手动刷新其选项。
5. 点击“测试文字 / JSON”和“测试图片”。这些测试会消耗少量账号额度。读取模型列表只进行协议连接和建会话，不发送生成请求。
6. 点击“保存连接”。之后可以在 AI 模型顶部将它设为全局默认，并“保存默认模型”；或在“功能分配”中给指定功能选择它并保存。所有功能都可选择 API 或 ACP，没有按类型隐藏的默认模型限制。模型列表与能力测试本身不会保存设置。

退出个人账号时，在模型设置点击“退出登录”，确认后应用向已保存的官方 ACP 连接发送 logout，并等待官方响应，此操作，适用于此电脑共享的 Antigravity 登录。 [官方退出说明](https://antigravity.google/docs/cli/install/)

打开 Ask 提问即可。官方运行时若需要重新登录，会启动原生授权流程，并在状态区提示。回复以文字流显示；本次任务的工具权限通过官方 ACP 回调自动选择 allow_once，不持久授予 allow_always。可以随时点击“停止”。期间可以切换课程和阅读资料，回答写回原来的问答范围。

## 当前边界

- **点击一次启动整次任务。** PPT、文献翻译、讲稿和 Deep Dive 自动推进后续 ACP 请求，不再额外要求“确认并开始”或逐次“继续”。本次工具请求自动选择官方提供的 allow_once；没有该选项时取消该工具操作，不扩大为永久权限。仍可在任务面板停止，已完成页面和段落保留。
- Google 对官方未修改的 ACP 运行时、原生 `oauth-personal` 和单人交互式使用有公开说明；这不等于允许第三方无人值守的任务队列，也不构成不会封号的保证。政策与额度仍由 Google 决定。
- 本应用只显式使用 `oauth-personal`，不发送 API Key，不修改官方系统提示词。原来的 Markdown Skill 作为用户任务说明发送。继承环境中的常见 Gemini / Google API 计费变量会移除。
- **无法从 ACP 确认剩余订阅额度、是否已启用额外积分或所有计费开关。** 请先在官方应用或 CLI 中检查 `/usage`、`/credits` 及额外积分设置。小请求测试成功不证明不会额外计费。
- 模型和 Thinking 以当前账号、当前运行时返回的信息为准，不硬编码 Gemini / Claude 的可用性。图片能力声明之后仍需实际图片测试；JSON 是提示与客户端校验，不是 API 原生 JSON Schema 保证。
- 应用不提供客户端文件读写、终端或额外 MCP 工具。官方 Agent 自身可能提供工具；本次授权自动处理这些工具的 allow_once 请求。临时目录不等于操作系统级隔离。此行为来自本地客户端的权限回调，不修改官方程序或启动参数。
- 全应用同时处理一个 ACP 工作流。课件按解析并发设置使用最多 4 个独立进程；参考文献按正文批次复用会话。其他流程依各自调度推进。讲稿保持课堂顺序。此功能只执行用户启动的任务，不增加定时或持久任务队列。
- 关闭设置会停止设置测试。已启动的课程任务不再依赖网页轮询保活，切换页面、收起面板或关闭浏览器不会因此停止。本地服务必须继续运行；可主动停止任务，关闭服务也会取消。取消和超时不会保存为成功；无法撤销远端已经发生的操作。
- 空闲三分钟回收官方子进程。关闭启动窗口或 Ctrl+C 会尝试结束正在运行的 ACP 子进程；强制杀进程时操作系统的清理行为可能不同。

## 排错

| 现象 | 处理 |
| --- | --- |
| 找不到官方程序 | 检查 EXE 的完整路径，区分 CLI 和独立入口。安装桌面 IDE 不一定代表安装了 CLI。 |
| 独立 ACP 缺少 localharness_external.exe | 将同一官方 ZIP 完整解压到一个文件夹，不要混用不同版本或只移动主程序。配套文件缺失时会在启动前停止。 |
| 需要官方登录 | 点击个人账号登录，完成官方浏览器授权。登录权限由 Google 判断。 |
| 不弹出浏览器，也没有登录链接 | 查看阶段：还在启动／握手时尚未进入认证；认证中若运行时提供有效的 Google 授权链接，会显示打开／复制入口。未收到链接不等于账号失败，也不伪造链接。 |
| 已认证，读取模型列表超时 | 认证步骤已经成功；单独重试“读取模型列表”，不要仅因此重复授权。若持续失败，需要进一步排查官方运行时的模型列表请求或网络。 |
| 模型不可用 | 重新读取模型列表并选择账号返回的模型。不会自动改用另一模型。 |
| 图片测试失败 | 更新官方运行时，确认当前模型和 ACP 都支持图片；普通文字成功不代表视觉可用。 |
| JSON 测试失败 | 当前回复不符合 JSON 格式；未记为成功。可在官方 CLI 对照同一请求。 |
| ACP 正在处理另一项交互 | 回到发起交互的 Ask / 设置，完成或停止当前交互。 |
| 仍看到“下一步模型请求” | 确认已运行 v2.25.9 并重新启动本地服务，再刷新网页。新版不再额外要求继续。 |

## 开发与验证

- `lib/acp-client.mjs`：官方 TypeScript SDK、stdio 进程、个人认证、能力协商、模型切换、提示与图像、权限回调、取消。
- `lib/acp-jobs.mjs`：内存任务句柄、按本次任务自动授权、手动停止和完成记录过期回收；不是持久任务队列。
- `lib/model-routing.mjs` / `lib/adapters.mjs`：provider 分流与隔离；API 的原缓存身份保留。
- `web/src/components/settings/`（`AccountCard`、`AssignSection` 等）与 `web/src/lib/acp-account.svelte.ts`、`jobs.svelte.ts`：账号登录、模型分配、交互状态、权限请求与停止。
- `lib/acp-interaction.mjs`：传递任务上下文、授权和取消信号；配合材料工作池调度后续请求。
- `test/acp.test.mjs` / `test/acp-browser.test.mjs` / `test/acp-login-browser.test.mjs`：本地模拟官方 ACP 协议及真实浏览器测试，不需要 Google 账号。模拟通过不能替代真实账号、官方二进制、网络或额度的端到端验证。

开发机安装 Node.js 22+ 后运行 `npm ci`，再运行 `npm test`。Windows 便携包已包含运行时和生产依赖，不需要普通用户安装 npm。

v2.24.1 已用官方独立 Windows 1.4.5 原版完成真实 `initialize` 握手，确认 `oauth-personal` 与图片输入能力；未发起个人登录或模型生成。这不代表账号额度已验证。应用停止官方 Windows 子进程时会清理其进程树，避免只结束启动器后留下同名工作进程。

v2.25.1 登录阶段默认上限：启动／握手 60 秒、认证 300 秒、会话与模型列表 90 秒、模型配置 30 秒。用户可以提前停止。切换设置分类不会销毁登录任务，关闭设置窗口则取消设置测试。仅解析认证期间官方输出中的 Google 授权页地址，校验 HTTPS、Google 主机、授权路径与本机回调；不显示其他 stderr。任务状态含有限的阶段时间记录，授权链接不进入这些记录，不落盘，任务结束后清除。新测试模拟了链接分段、长链接、重复链接、恶意地址、模型读取卡住、页面重建和取消；真实 Google 授权仍需用户完成。

官方参考（2026-11-08 核对）：[ACP 连接与认证](https://antigravity.google/docs/ide/extensions/acp)、[个人交互式使用范围说明](https://discuss.ai.google.dev/t/tos-clarification-is-openbot-official-antigravity-acp-server-permitted-under-the-antigravity-terms-of-service/197826)、[官方 ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk)。
