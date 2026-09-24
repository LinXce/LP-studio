# 验证范围

验证日期：2026-09-22。系统 Windows，Node v24.19.0。依赖实际解析版本以 package-lock.json 为准。

## 自动化

- TypeScript strict 类型检查。
- UI 不导入 Node/Electron/core/providers 的边界检查。
- 33 项测试覆盖文件 apply/rollback、外部变更、路径越界、NTFS 相关路径、junction、UTF-8 BOM/编码、崩溃状态恢复、JSONL、SSE、跨分片 Key 脱敏、CLI 协议、API URL 限制、本机 HTTP 流、中断、stdin 字面值、停止进程、Git 状态与分支切换、Command CLI 与 Antigravity CLI 解析。
- 桌面自动化：实际 Electron 窗口、isolated renderer、文件树、Monaco、上下文、原生桥 apply/rollback、PowerShell、密钥密文、快捷键与模型设置。测试中原生确认/目录选择由测试程序替换，真实用户交互仍由主进程弹窗负责。

## 本次实际结果

- `npm.cmd run check`：16/16 测试通过，类型检查和 UI 边界检查通过。
- `npm.cmd run build`：成功；Monaco 带来的大 chunk 提醒保留，不影响离线资源加载。
- `npm.cmd run test:desktop`：通过；额外验证完整 UI → 本机模拟 API → 流式回复 → lp-edit → 待审核 diff，未审核前项目文件未写入。
- Windows x64 目录打包成功：`release/win-unpacked/LP Studio.exe`。
- `node scripts/packaged-smoke.mjs`：直接启动打包 EXE 通过，app.isPackaged 为 true，使用 file:// 内置资源与 EXE 旁的 .lp-data，无开发服务器。
- `docs/desktop-preview.png` 是桌面端到端测试截图，含临时项目与模拟回复，不代表真实模型响应。

## 厂商连接验证边界

- Claude Code 本机 `--version` 为 2.1.233，`--help` 包含使用的 print / stream-json / tools / strict-mcp-config 等参数；没有向真实账号发消息。
- Gemini CLI 本机 `--help` 确认 headless、stdin、stream-json、plan；没有向真实账号发消息。
- Codex 本机 wrapper 存在，但运行失败：缺少 `@openai/codex-win32-x64` optional dependency。应用未修复或覆盖全局安装。Codex Adapter 只有事件 fixture/代码验证，真实可执行文件联调待用户修复环境后完成。
- API 使用本地 HTTP fixture 验证 SSE 与中断；未验证真实 OpenAI/Anthropic/Gemini Key、额度、代理或模型 ID。
- 没有触发 OAuth/浏览器授权流程。

## 尚未验收

不同 Windows 机器上的实际复制运行、不同账户 DPAPI 拒绝解密、企业杀毒拦截、断电恢复、恶意本地并发文件交换、CLI hooks/插件权限、全交互 PTY、真实厂商长会话和计费。

便携 EXE 为未签名个人测试版。停止终端不等于撤销命令副作用；文件恢复保护限于通过应用 FileService 应用的修改。完整 Electron 包体含 Chromium/Monaco，构建的大 chunk 提醒不代表运行时加载网络资源。

## 开发启动窗口修复（2026-09-22）

通过 npm run dev 复现旧启动入口只打印 Logo、Electron 进程存在但没有可见主窗口。桌面启动进程改用 windowsHide: false，主窗口显式 show/focus，并加入阶段日志、IPC 就绪回报、超时及进程错误处理。修复后类型检查通过，真实开发入口收到 Window visible / Desktop ready 回报；Windows 进程检查得到非零 MainWindowHandle，窗口标题为 LP Studio。此验证覆盖此前生产构建窗口测试未覆盖的开发启动入口。

## 中央导航与主题（2026-09-22）

- 模型、会话、设置为第三栏页面，已移除导航弹窗。外侧项目栏、Monaco 预览和 diff 不重新挂载。
- `npm.cmd run check`：类型检查、16 项回归和 UI 依赖边界通过。
- `npm.cmd run build`：通过。Windows x64 便携 EXE 已使用新构建重新打包。
- `node scripts/desktop-smoke.mjs`：实际 Electron 窗口测试通过，覆盖无 modal、导航选中状态、模型表单与独立对话/命令草稿保留、会话搜索与打开、Ctrl+L 返回输入框、窄中央栏无水平溢出、主题切换与重载持久化、Monaco 明暗同步、减少动画偏好，以及后台 API 流式任务在切换页面后正常完成。
- `node scripts/packaged-smoke.mjs`：直接启动打包 EXE 通过，确认内置资源、桌面 IPC、中央导航和主题持久化。
- `docs/theme-industrial.png`、`docs/theme-settings.png`、`docs/desktop-preview.png` 为实际桌面测试截图。工业浅色工作台截图含独立临时项目和本机模拟 API 响应。
- 自动化最初受受限环境 Windows 用户信息读取失败、Electron 启动崩溃及审批超时影响；在正常权限环境重试后上述检查均通过。

## 面板折叠修复与 Command CLI（2026-09-22）

- 修复项目栏隐藏后 CSS Grid 自动排位将中央工作区放入零宽列的问题。六个布局元素显式指定列与行；折叠项目栏时中央区域保持可见并扩展。
- 文件预览折叠为 40px 窄栏，右上角展开按钮始终可用。编辑器保持挂载；Ctrl+B / Ctrl+J 和原有菜单按钮继续可用。
- 新增独立 Command CLI 适配器，默认命令 cmdc；一次性迁移为现有工作区补充连接，不覆盖自定义配置，删除该连接后不反复补回。
- 本机 cmdc 1.58.1 的 --version、--help 及安装包协议已核对。使用 JSON NDJSON、stdin、plan、no-session、no-skills、skip-onboarding、no-auto-update；不修改全局安装或凭证，没有向真实账号发送推理请求。
- `npm.cmd run check`：22/22 测试、严格类型检查和 UI 边界检查通过。新增覆盖 Command CLI 分片/多轮/结果去重、结束帧与错误、真实子进程 stdin/参数传递，以及默认连接迁移。
- `npm.cmd run build`：通过；Windows x64 便携目录已重新打包。
- `node scripts/desktop-smoke.mjs`：通过。实际测量左右单独折叠、同时折叠、切换设置页、快捷键恢复时的面板坐标与宽高；两套主题均验证。通过本地模拟 CLI 完成 UI → IPC → 子进程 → 流式回复，检查上下文、版本检测及项目文件未被写入。
- `node scripts/packaged-smoke.mjs`：更新后的真实 EXE 通过，验证内置资源、默认 Command CLI 连接、面板几何与右上角按钮、主题持久化。
- 测试修正了适配器表单定位与异步回复等待；只检测元素存在不足以捕获本次零宽布局回归，因此面板检查以实际几何为准。

## 主题窗口控制、警告弹窗与会话管理（2026-09-22）

- 使用无系统边框窗口与独立 WindowControls 组件。左上角集成最小化、最大化/还原、关闭和预览开关；预览折叠后不再保留右侧 40px 栏。标题栏空白区域支持拖动及双击最大化。
- 项目选择框焦点轮廓绘制在包含文件夹图标的整个容器上。
- 主进程的 CLI 检测、模型运行、终端执行、应用/回滚及会话删除请求，由统一主题 dialog 展示；未保存编辑提示也使用该组件。默认焦点为取消，Esc 取消，原生 modal dialog 限制焦点及背景交互。未启动 UI 前的致命启动错误仍使用系统提示，目录选择仍为系统选择器。
- 确认请求有唯一 ID，确认前不执行操作；窗口关闭、渲染退出或重载会取消未决请求。运行中会话禁止删除，确认前后均校验；删除保留文件修改/回滚记录。关闭标签仅影响当前窗口内标签展示，可从历史重新打开。
- `npm.cmd run check`：22/22 测试、类型检查和 UI 边界检查通过。
- `npm.cmd run test:desktop`：既有完整桌面回归及新增 `scripts/chrome-smoke.mjs` 均通过。新增覆盖两套主题的标题/弹窗配色、项目图标焦点范围、标签关闭/重开、会话删除/取消/重载持久化、保留项目文件与修改记录、主进程运行中删除保护、命令取消、重载取消确认、真实最小化/最大化/还原/关闭。
- `npm.cmd run pack:win`：最新 Windows x64 便携版打包通过；`node scripts/packaged-smoke.mjs` 直接启动 EXE 验证通过。
- `.cache/chrome-industrial.png` 和 `.cache/chrome-midnight.png` 为隔离项目的实际桌面确认框截图。桌面测试已改为点击主题确认按钮，不再替换原生 message box。
- 正常权限测试曾受自动审批超时影响，受限环境遇到用户信息读取失败或 Electron 崩溃；重试后以上验证均完成。

## 右上角窗口控制与会话模型选择（2026-09-22）

- 窗口控制移至右上角，顺序为预览开关、最小化、最大化/还原、关闭，关闭按钮靠最右边。
- 统一底部通知 4 秒自动消失，相同消息重新触发会重置计时；确认对话框不自动消失。
- CLI 与实际模型独立选择，空白会话允许调整，首次确认运行后固定。会话保存模型快照，旧会话启动时迁移，CLI 参数来自会话模型。确认期间保护配置与删除操作，取消确认后仍可调整。
- Command CLI 可主动读取本机模型目录；其他 CLI 使用连接配置、别名或手动输入，不保证预设别名对应账号权限。
- 本次类型检查、UI 依赖边界检查通过。受限 Windows 下 tsx 的用户信息读取报 ENOMEM，改用 esbuild 编译相同测试后运行 Node test：core/command 17 项、providers 7 项通过，共 24 项。覆盖模型持久化、旧会话回退、已开始/忙碌保护、模型目录解析及实际 CLI --model 参数。
- 完整测试中的进程树终止用例在受限环境挂起，已停止测试；未算作通过。Electron 窗口测试的正常权限审核两次超时，未执行成功。本次新增的窗口位置、重复通知计时、空白会话切换/重载和模型锁定 GUI 断言尚待在正常桌面环境运行 `npm.cmd run test:desktop`。

## 输入框底栏、Git 分支与 Antigravity CLI（2026-09-22）

- 输入框底栏左侧新增 Git 徽标（仓库名 + 分支选择，列出本地分支并经主题确认框执行 `git checkout`），右侧为 CLI 连接与模型选择。
- 项目、CLI 连接、模型、Git 分支统一使用新增的 `OptionSelect.tsx` 弹层：触发器显示当前值，面板支持 ↑↓、回车、Esc 与点击外部关闭，无搜索框。表单内的下拉框（适配器、超时等）保持系统控件。
- 曾短暂实现的模型搜索与收藏已移除：`Bootstrap.favorites`、`setFavorite` IPC、`workspace.json` 的 `favorites` 字段及相关样式一并删除，不保留未使用的持久化代码。
- 只有 Command CLI（cmdc）提供模型目录枚举；Antigravity 适配器移除了 `listModels`，只保留 `--version` 探测。
- 底部通知改为按等级取色：信息/成功/警告/错误四级，两套主题各有一组 `--toast-*` 变量；错误与警告使用 `role="alert"`，信息与成功使用 `role="status"`。
- 新增 `packages/core/git.ts`：只读 `rev-parse` / `branch` / `for-each-ref`，以及 `git checkout`（仅本地已有分支、拒绝以 `-` 开头的名字、运行中的项目被拒绝）。参数以数组传递，不经过 shell；`GIT_TERMINAL_PROMPT=0` 避免凭证提示挂起。
- 新增 `antigravity-cli` 适配器（`packages/providers/antigravity.ts`）：print 模式读取 stdin、`--output-format stream-json`、`--mode plan`、`--sandbox`、`--disable-slash-commands`，NDJSON 解析兼容 text_delta / assistant message / result 信封并按增量去重。默认连接迁移为已有工作区补充该连接，不覆盖用户配置，删除后不反复补回。
- `npm.cmd run check`：33/33 测试、严格类型检查和 UI 依赖边界通过。新增覆盖 Antigravity 分片帧与错误帧、参数、真实子进程 stdin 与版本探测、默认迁移幂等、Git 非仓库/仓库/分支切换与非法分支名。
- `npm.cmd run build`：通过；Windows x64 便携目录尚未用本次构建重新打包。
- `node scripts/desktop-smoke.mjs`：通过。选择流程改为点击触发器再点选项：连接、读取本机模型目录、模型选择，并断言会话开始后连接与模型控件禁用。
- `node scripts/chrome-smoke.mjs`：通过。覆盖项目选择框的焦点轮廓、独立临时仓库中的分支切换（经确认框切到 `feature` 再切回 `main`，项目文件不变）。
- 未验收：本机未安装 `agy`，也没有真实 Antigravity 账号；参数名与 stream-json 字段来自官方 headless 文档与 fixture，需在装有 CLI 的机器上回归。Git 分支切换未覆盖冲突、子模块与 detached HEAD 的实际交互。表单外的选择弹层未做键盘焦点陷阱与屏幕阅读器逐项朗读测试。

## cmdc headless 工具被拒导致的空转（2026-09-22）

- 复现：用 Command CLI（cmdc）+ DeepSeek 模型运行时，日志出现 `tool_denied: read_file`，随后 `The model produced no response (continuation budget exhausted).`，进程退出码 9。
- 读本机 `command-code` 1.62.1 打包代码后的结论：
  - `resolvePrintInputSource` 证实 `-p` 无参数时从 stdin 读取提示，应用的调用方式正确；空 stdin 才会报 `No query provided`。
  - print 模式的权限闸门只拦 `edit_file`、`write_file`、`shell_command`、`monitor_command`、`kill_shell`；`read_file` 不在其中。
  - plan 模式对 `read_file` 是放行的：`isPlanSafe` 对 `readOnly` 工具返回真，`check()` 在 `"plan"===mode` 分支直接 `return "allow"`。
  - `check()` 真正会拒绝的分支是：命中 `permissions.deny` / `permissions.ask` 规则，或**目标路径不在工作区内**（`outsideWorkspaceAccess`）：后者在 headless 下无人可批准，返回拒绝。`~/.commandcode` 与 scratchpad 的读取有专门豁免。
  - 本机 `~/.commandcode/config.json` 只有 `installed` 与 `starredModels`，没有任何权限规则，因此本次拒绝来自工作区之外的路径。
  - 退出码 9 来自 `classifyPrintOutcome`：`finalText` 为空即 `QE.NO_RESPONSE`，并打印该 Warning；与工具扣留无关。
  - `getTasteContent` 会跳过只有索引标题的 `taste.md`（`isHeaderOnly`），因此可排除“taste 提示模型去读文件”的猜测。
- 改动：`runProcess` 非零退出时附带 stderr 尾部（最多 4 行）；cmdc 的 `tool_denied` 状态改为中文说明并在出错时提示“未授予工具”；新增 `tool_queued` 状态，打印工具名与参数（只取路径类字段，不输出文件正文），用于定位被拒的具体路径。
- 未开启 `--tools-all` / `--yolo`：前者无法放开 `read_file`（只影响 headless 扣留的少数工具），后者会同时放开写入与命令执行。
- `npm.cmd run check`：35/35 通过。新增覆盖“非零退出携带 stderr 尾部”“tool_denied 中文状态与适配器提示”“tool_queued 打印参数且不回显文件正文”。
- 待用户复现：需要一次真实运行确认被拒路径。若是模型给出以 `/` 开头的 POSIX 风格路径，在 Windows 上会解析到当前盘根目录，从而落到工作区之外。
- 未验收：未用真实 cmdc 账号完成修复后的完整链路（避免消耗额度）。

## 输入框回车行为（2026-09-22）

- 输入框改为 Enter 直接运行、Shift+Enter 输入换行；组合键仍可发送。输入法组合期间（`isComposing`）按 Enter 只确认候选词，不触发发送，避免中文输入被打断。
- 发送按钮 title 由「运行 · Ctrl+Enter」改为「运行 · Enter」，输入框提示与设置页快捷键列表同步更新（Enter 运行 / Shift+Enter 换行）。
- `npm.cmd run check`：35/35、类型检查与 UI 边界通过。
- `npm.cmd run build`：通过。
- `node scripts/chrome-smoke.mjs`：通过。新增断言：Shift+Enter 后输入框为两行文本，Enter 提交并在无项目时弹出「请先打开项目」提示。
- `node scripts/desktop-smoke.mjs`：通过，发送按钮按新名称定位。

## 对话流内联工具授权（2026-09-22）

- 背景：headless CLI 无法中途请求权限。读 `command-code` 1.62.1 打包代码确认 `headlessInteraction` 的 `confirmTool` 对任何带风险的调用直接返回 `deny`，且 `headless: true` 时 `observeInteraction` 不发出 `interaction_requested`。因此应用改为把「工具被拒绝」当作权限信号。
- 交互：拒绝后不再弹模态框，而是在对话流中插入授权气泡（工具名 + 路径 + 将授予的权限），提供「允许并重新执行」与「忽略」。同时**移除了每次运行的确认弹窗**（按用户要求）；应用/回滚、删除会话、终端命令、CLI 检测、读取模型目录、Git 分支切换仍保留主题确认框。
- 实现：`ProviderEvent` 新增 `tool`（queued/denied）；`Runs` 采集拒绝并用 `grantForDenial` 解析最小授权（路径真实存在且位于项目外 → 目录授权，否则全部工具），通过 `authorize` 事件下发；批准后写入 `Session.grants` 并用 `retry` 重跑同一轮（不重复追加用户消息，并清掉上次的空回答）。会话内已生效的授权不再询问，避免「批准→再拒绝」循环。`clearGrants` 可撤销，新建会话重置。
- cmdc 参数映射：目录授权 → `--add-dir <dir>`；全部工具 → `--yolo` 且不再传 `--permission-mode plan`（代码里 plan 分支先于 bypass 判定，两者同时给等于无效）。`supportsGrants` 能力标记保证只有 cmdc 会发起授权请求，其他适配器不出现无效气泡。
- `npm.cmd run check`：37/37 通过。新增覆盖「授权参数映射」「tool 事件结构」「拒绝产生授权且授权生效后不再询问」「grantForDenial/sameGrant」「supportsGrants 只对 cmdc 为真」。
- `npm.cmd run build`：通过。
- `node scripts/desktop-smoke.mjs`：通过。新增流程：拒绝夹具触发气泡 → 断言运行期间没有确认弹窗 → 「忽略」后气泡消失 → 重新运行再「允许并重新执行」→ 夹具在带 `--yolo` 时输出 `GRANTED_RETRY_OK` 且断言不传 `--permission-mode` → 会话 `grants` 持久化为 `[{all:true}]`。
- `node scripts/chrome-smoke.mjs`：通过（未改动该脚本的相关部分）。
- 未验收：真实 cmdc 账号下的目录授权路径；多工具连续拒绝时只展示首个拒绝；授权后仍被拒时的提示文案。

## 授权链路实机复核与两处修复（2026-09-23）

- 复核 2026-09-23 的会话记录（`.lp-data/workspace.json`）：该会话 `grants: [{all:true}]`，模型自述 "it's outside my workspace, so I'll check it via the shell first" —— 证明「授权 → `--yolo` → shell 可用」在真实运行中生效。
- 同一条记录里 10:53:13 与 10:53:36 各有一条 assistant 消息，时间差 23 秒 —— 这是一次授权后重试，说明气泡批准与重跑链路可用。
- 修复 1：`EDIT_INSTRUCTIONS` 曾硬编码「本次运行不提供任何工具」，与实际不符（默认 plan 模式本就允许 `read_file`，授权后更可写文件与执行命令）。改为 `editInstructions(grants)`：未授权时声明只读，授权后声明可用全部工具但修改仍须走 lp-edit 提案。
- 修复 2：重试只在旧回答为空时清除，导致半截回答与完整回答并排显示（即上述 10:53:13 那条）。改为重试时替换掉上一条 assistant 消息，并断言用户消息不重复追加。
- 说明：授予「全部工具」后模型可用工具直接改文件、绕过 diff 审核；提示词里的约束只是劝告，服务端不强制。这是该授权的固有代价，界面已在气泡文案中标明。
- `npm.cmd run check`：37/37 通过，新增覆盖「提示词随授权变化」「重试替换旧回答且不重复用户消息」。

## 回答与提问无关的排查（2026-09-23）

- 现象：在 LP Studio 里对 cmdc + `deepseek/deepseek-v4-flash` 发 `return 1`，回答却是对 `C:\nvm4w\nodejs\node_modules\command-code\dist\index.mjs` 的分析；同一条 prompt 在 cmdc TUI 里正常返回 `1`。
- 已核对的证据（`.lp-data/workspace.json` 该会话）：首轮用户消息就是 `return 1`，随后是一空的 assistant 与旧的 `进程退出码 9` 系统消息；该会话现有 `grants: [{all:true}]`；10:53 一次授权后重试（两条 assistant 相隔 23 秒）。模型自述 "it's outside the current workspace, so I'll check it via the shell first"，证明授权链路生效。
- 读 `command-code` 1.62.1 打包代码，逐个排除「模型被自己路径污染」的可能：`readStructure` 只列 cwd 顶层目录（过滤隐藏项与 `node_modules` 等）并追加 `scopeDirLabels`；`scopeDirLabels` 只反映 `permissions.additionalDirectories` 与 `--add-dir`（两者都为空）；`workspaceRoots` = `[process.cwd(), ...额外目录]`；`process.argv` 仅用于 API 环境、`--experimental`、本地构建判定，**不进入模型上下文**。因此 cmdc 不会把自己的 `index.mjs` 路径告诉模型。
- 结论：那个路径是模型自行探索得到的，随后被**回放的历史**固化——我们每轮发送最近 20 条非系统消息，于是这段跑题的线索被反复带回，导致之后每个简短问题都被拖进同一话题。
- 本次修复：`buildPrompt` 按需构造提示词——无上下文文件时不带 lp-edit 契约，首轮既无历史也无上下文时直接发送用户原话（新增单测断言三种形态）；配合前两项修复（提示词工具说明随授权变化、重试替换旧回答）。
- 立即规避：该会话历史已被污染，请新建会话（或清除授权）后再问。
- 未验收：模型最初选择该路径的动机无法离线判定；如需定位，需要在实机跑一次并逐个变量对比（会消耗少量账号额度），当前未执行。
- `npm.cmd run check`：37/37 通过；`npm.cmd run build` 通过；`node scripts/desktop-smoke.mjs` 与 `node scripts/chrome-smoke.mjs` 通过。

## 授权被拒后的死锁修复（2026-09-23）

- 现象：用户在全新会话里发 `return 1`，模型第一件事就是 `read_file C:\nvm4w\nodejs\node_modules\command-code\dist\index.mjs`，被拒后空转退出 9；点击「允许并重新执行」后仍然失败，且**不再出现授权气泡**，用户无法继续。
- 原因 1（已修）：`offerAuthorization` 的去重条件是「该授权已在会话中」，一旦重试仍被拒就直接 `return`，既不升级也不再提示 —— 死锁。
- 原因 2（已修）：去重用的是等值比较，因此「已授权全部工具」时仍会再弹目录授权，形成循环。
- 现在的行为：已授权全部工具而仍被拒 → 输出明确状态（建议更换模型或新建会话）；目录授权仍被拒 → 升级为「允许全部工具」的第二次询问；否则照常询问。
- `--add-dir` 的可用性未验证：读 `command-code` 1.62.1 的 `addDirectory` 校验，敏感路径只覆盖 `node_modules/.bin`、`.commandcode` 设置目录与凭证目录，该路径**不属于**敏感路径；`createNodeHarnessSession` 也确认把 `getAdditionalDirectories()` 并入 `workspaceRoots()`。但用户实测目录授权后仍被拒，所以「`--add-dir` 在 print 模式是否真正放宽读取」仍待实机确认；当前的升级路径（`--yolo`）已被旧会话证实可用。
- 仍未定位：模型为什么在空白会话里第一件事就是读那个路径。已排除 cmdc 把它自己的路径写进模型上下文（`readStructure`/`scopeDirLabels`/`workspaceRoots`/`process.argv` 都已核查）。需要一次实机对比才能进一步判断。
- `npm.cmd run check`：37/37 通过（新增覆盖「授权无效时升级」「全部工具仍被拒时不再重复询问」）。

## 移除欢迎页预填提示词（2026-09-23）

- 用户反馈新建会话"自带上下文"，并指出欢迎页那两个卡片像"添加上下文的提示词按钮"。
- 核实：应用**没有**任何自动勾选文件的行为，`contexts` 只由文件树勾选与「清空上下文」写入，`createSession` 不携带上下文。用户看到的是欢迎页卡片把带文件语义的提示词预填进输入框：`请解释已选上下文文件的结构与职责。` 与 `请检查已选文件的问题，并使用 lp-edit 格式提出可审核的修改。`——在未勾选任何文件时，等于让模型去检查并不存在的"已选文件"，是诱导它自行翻找文件的来源之一。
- 改动：删除这两个卡片及其 `starter-grid` 样式（含浅色主题覆盖与窄窗口媒体查询），欢迎页保留图标、标题、说明与「文件由你选择 · 修改由你确认」。
- 顺带修掉桌面冒烟的一个竞态：运行结束前 assistant 文本就已落盘，脚本可能在上一个运行尚未清理时调用 `saveProvider`（报「请先停止使用此模型的会话」）；现在先等待发送按钮恢复再继续。
- `npm.cmd run check`：37/37；`npm.cmd run build` 通过；`node scripts/desktop-smoke.mjs` 与 `node scripts/chrome-smoke.mjs` 通过。

## 内嵌 PTY 终端（2026-09-23）

- 动机：用户实测同一 prompt 在 cmdc TUI 里答复简短切题，在本应用的 headless 链路里却去翻文件并空转。读 `command-code` 1.62.1 确认 headless（`-p`）会扣留 `ask_user_question`、`enter_plan_mode`、`exit_plan_mode`、`plan_review`、`todo_write`、`taste` 与 cron 系列工具，CLI 也无法在运行中请求权限 —— headless 无法复现交互行为，故改为真终端。
- 依赖 spike（本机 Windows / Electron 41.10.7 / Node 24.19.0）：`node-pty@1.1.0` 使用 `node-addon-api`（N-API），**自带 win32-x64 预编译产物，无需 `@electron/rebuild`**；`pty.spawn` 实测可启动 ConPTY 并收到输出（`cmd.exe /c echo` → `pty-ok`，退出码 0）。放在 `optionalDependencies`，缺依赖时应用照常可用。
- 关键发现（实测，非推断）：`.cmd`/npm wrapper 会被 `resolveExecutable` 解析成 `{ executable: process.execPath, args: [entry] }`，而 **Electron 二进制作为 PTY 子进程会立刻以退出码 0 静默退出、无任何输出**（同一 fixture 用 PATH 里的 `node.exe` 则正常输出 `TTY_READY` 与回显）。因此 `TerminalService` 在 `launch.executable === process.execPath` 时改用 `resolveNodeRuntime()`（PATH 中的 node），找不到时给出明确错误。headless 管道路径不受影响，仍用 `process.execPath`。
- 实现：`apps/ui/src/TerminalView.tsx`（xterm + FitAddon，空状态居中放连接/模型选择 + 新建会话，工具条含重启/停止）、`apps/desktop/terminal.ts`（每会话一个 PTY，64 MB 输出上限，缺依赖与非 CLI 连接给出可读原因）、契约新增 `TerminalEvent`/`TerminalStart` 与 4 个 IPC + `onTerminal` 推送。对话视图（消息流、lp-edit 审核、上下文勾选）用 `apps/ui/src/views.ts` 的 `chatView` 隐藏，代码保留。
- `npm.cmd run check`：42/42 通过。新增覆盖「`interactive()` 各 CLI kind 的参数（含模型、无 `-p`）」「API 连接无 `interactive`」「假 PTY 的 start/write/resize/stop/stopAll 与二次 start 幂等」「缺 node-pty 与 API 连接的降级提示」「`resolveNodeRuntime` 在 PATH 为空时报错」。
- `npm.cmd run build`：通过；`node-pty` 在 esbuild 中标记为 external，打包 `files` 含 `node_modules/node-pty` 且 `asarUnpack` 该目录；`npmRebuild` 关闭（N-API 无需重编）。
- `node scripts/desktop-smoke.mjs`：通过。新增断言：默认进入终端视图、空状态含连接/模型选择与「新建会话」、对话输入框不存在（`count() === 0`）；**真 PTY 端到端**——用 `tty-fixture.mjs` 起终端，经 IPC 写入 `hello`，断言收到 `TTY_READY` 与 `ECHO:hello`。原有 headless 流程改经 `window.studio.*` 驱动（对话 UI 已隐藏），覆盖 run → lp-edit → 待审核 diff → 预览、Command CLI 夹具、授权气泡与重试、apply/rollback、终端命令、密钥密文、主题、面板几何。
- `node scripts/chrome-smoke.mjs`：通过。CLI/模型选择与 Git 分支切换改在「终端命令」页执行；键盘行为（Shift+Enter 换行、Enter 提交）改在命令输入框上验证。
- 已知噪音：停止终端时 node-pty 的进程树 helper 在无控制台的进程里会打印 `AttachConsole failed`，不影响终端使用与进程终止。
- 未验收：真实 CLI 在 PTY 下的长时间交互、ANSI 复杂界面（曲线滚动、鼠标事件）、多会话并行终端、复制粘贴与 Unicode 宽字符；便携目录在另一台机器上的 PTY 运行。

## 终端三项修复（2026-09-23）

- 会话标签：终端视图此前没有标签栏（它属于已隐藏的对话视图），只能在左栏切换。现在 `TerminalView` 自带标签栏（切换 / 关闭 / 「+」新建）。
- 新建流程：原先左栏「+」与终端空状态的按钮会用当前默认连接直接建会话，用户看不到 CLI/模型选择。现在统一的 `startNewSession()` 只清空选择、回到居中的连接+模型界面；未打开项目时给出提示。
- 输入法：xterm 的隐藏 helper textarea 默认在 `left: -9999em`，中文输入法候选框会跟着它跑到窗口外。新增 `.terminal-host .xterm .xterm-helper-textarea { left: 0; top: 0 }`，让候选框至少落在终端内（xterm 在组合输入时仍会自行把它移到光标处并覆盖该规则）。同时 `terminalStart` 成功后补一次 `focus()`，避免开头几个按键丢失，并把写入失败从静默忽略改为报错提示。
- `npm.cmd run check`：42/42；`npm.cmd run build` 通过。
- `node scripts/desktop-smoke.mjs`：通过。新增断言：终端标签栏存在；**经真实 UI 路径输入**（`page.keyboard.type` → xterm onData → IPC → PTY → 回显），断言收到 `ECHO:hello`（此前的往返测试是直接调 IPC，没覆盖 UI 输入这一层）。`chrome-smoke` 的标签断言改为限定可见视图（终端视图现在也渲染标签，计数会翻倍）。
- 仍未验收：真实中文输入法下的组合输入与候选框位置（自动化只能验证按键能到达 PTY，无法验证 IME 弹窗位置），需要人工在中文输入法下确认。

## 输入法问题与系统终端保底（2026-09-23）

- 用户截图确认两个症状：输入法候选框出现在终端区域右外侧（贴着 xterm 的**组合输入显示块**），且**首次组合输入完全打不进字**，按一次回车后才恢复。
- 诊断：xterm 的隐藏 helper textarea 默认是 `left: -9999em; width: 0; height: 0`。Windows 输入法按聚焦可编辑元素的插入符矩形定位候选框，0×0 且位于屏幕外会让它落到别处，并可能丢掉首次组合输入。改动：把它改成终端内 `left: 0; top: 0; width: 1px; height: 1em; opacity: 0`（xterm 在组合输入时仍会用内联样式把它移到光标处）。
- 保底通路：终端工具条新增「系统终端」，用 `cmd.exe /c start "" cmd.exe /k <命令>` 在项目目录打开真正的控制台窗口运行同一个 CLI，输入法与渲染交给系统。命令串由 `consoleLine()` 生成：安全字符直出，其余加引号并剥离引号字符；`%`、`!` 在 cmd 中即使位于引号内也会展开，因此直接拒绝；换行与未加引号的 `& | < > ^` 同样拒绝（有单测覆盖）。
- 说明：本机无法自动化验证 IME 行为（Playwright 不驱动 Windows 输入法），因此「1px 输入框」这一修复按已知成因实施，需人工在中文输入法下确认；「系统终端」是确定性可用的替代路径。
- `npm.cmd run check`：43/43；`npm.cmd run build` 通过；`node scripts/desktop-smoke.mjs` 与 `node scripts/chrome-smoke.mjs` 通过。

## 输入法：实测结论与输入条（2026-09-23 第二次）

前两次按"隐藏输入框位置/尺寸"改 CSS 无效，因此改用 CDP 探针（`Input.imeSetComposition` / `Input.insertText`）在真实 Electron 里直接测量：

- 组合输入链路是通的：`Input.insertText('你好')` → xterm → IPC → PTY，夹具回显 `ECHO:你好`。
- 隐藏输入框**由 xterm 自己用内联样式**定位和撑开：`left:0; top:15.2075px; width:7.61856px; height:15.2075px`，组合时宽到 38px，组合块 `.composition-view` 同步在 (326,149)。也就是说 CSS 覆盖不到它，之前两处改动实际没生效。
- 锚点严格跟随 xterm 跟踪的光标单元格；`process.stdout.columns×rows` = 97×53，与渲染栅格（739px/7.6px、806px/15.2px）一致，**不存在尺寸错位**。用户截图里候选框贴在终端右外侧，是因为 cmdc 这类全屏 TUI 把硬件光标停在该行右端（截图中小方块 `d` 即组合块，正好在光标处）。这是 CLI 自身的光标位置，无法通过 CSS 调整。
- "打不进字"的机制：xterm 只有在 `compositionend` 之后才提交并清空状态，组合没走完时它停在 composing 状态丢弃按键；按一次回车恰好触发结束——与用户描述一致。该路径依赖真实输入法，本机无法自动化验证。

因此改为提供确定性通路：终端底部新增**输入条**（`aria-label="中文输入"`），是不经 xterm 的真实 `<input>`，Enter（`!isComposing` 守卫）把整行写入 PTY，另可点「发送到终端」。它有端到端测试：CDP `Input.insertText('你好')` + Enter → 断言 PTY 回显 `ECHO:你好`（`desktop-smoke` 已覆盖）。原来的"1px 输入框"CSS 已回退，避免无谓覆盖 xterm 的定位。

## 输入法：接管组合处理（2026-09-23 第三次，按用户要求）

用户要求去掉输入条、直接改 xterm 的组合状态处理。实现：`TerminalView` 在隐藏输入框上以捕获阶段监听 `compositionstart/update/end`、`keydown`、`input`、`blur`：

- `compositionstart` → 置 `composing` 并 `stopImmediatePropagation()`，xterm 永远不进组合态（也就无法卡在组合态丢弃按键）。
- 组合期间的 `keydown`/`input` → 拦住，拼音字母不会漏进 CLI。
- `compositionend` → 取 `event.data` 直接 `terminalWrite` 写入 PTY，清空隐藏输入框。
- 取消组合（`data` 为空）不发送任何内容，`composing` 复位；`blur` 兜底复位。

验证（`desktop-smoke`，用合成 CompositionEvent 驱动）：提交文本 `你好` 到达 PTY；同一会话随后的一次普通写入 `control` 完整到达；`nihao`/`shijie` 等拼音字母从未出现在 PTY 流中；取消组合后继续键入仍然到达（`ECHO:after`）。`npm.cmd run check` 43/43、build、两个冒烟套件通过。

**仍未人工验收 / 已知现象**：在合成事件（`isTrusted:false`）驱动的测试里，夹具偶尔只读到提交串的首字符（`你` 而非 `你好`），而同一次运行中**直接用桥接写同样的中文则完整到达**（另做了三组探针：`你好\r` 一次写、分两次写、逐字写，全部完整）。因此写路径没问题，怀疑是这套合成事件与 Chromium 编辑状态的交互假象，真实输入法路径必须人工确认。副作用：终端内不再显示 xterm 的组合预显，只有输入法自己的候选窗。

## 用真 cmdc 复现（2026-09-23 第四次）

用户指出前面的验证都在"假夹具"上做（只打印一行、不做绝对光标定位），因此专门用真实 cmdc TUI 起终端抓取原始字节流（探针 `.cache/tui-probe.mjs`，仅本地运行，已删）：

- 首次观察：TUI **整屏没有任何横幅内容**（总输出 ~1.1KB，只有清屏、53 个换行、几条 OSC 标题），手动按键只有窗口标题变化、界面不重绘。原因是会话 model 为空且交互式启动**没有传跳过引导的参数**，CLI 停在信任/引导确认屏。
- 修复：`CommandCliAdapter.interactive()` 增加 `--trust --skip-onboarding --no-auto-update`（`cmdc --help`：`-t, --trust` = Auto-trust project (skip initial permission prompt)，`--skip-onboarding` = Skip taste onboarding）。重新抓取后**横幅正常绘制**（`███████ …`），说明 TUI 进入了正常状态——"第一次必须回车"的成因就是那两个确认屏。
- 候选框位置：修复后实测 xterm 跟踪的光标为 `row 20, col 97`（97 列终端的**最后一列**），`trackedCursorPx.x = 1057` 已越过屏幕右边界（screen 起点 326 + 宽 739）。即 cmdc 画完满宽输入框边框后把隐藏的光标留在该行末列，Chromium 的输入法锚点就在这个单元格上，所以候选框出现在终端右外侧。这是 CLI 自身的光标位置，真实控制台会锚在同一 caret；CSS 无法改变（xterm 每个光标变化都会重写内联 left/top）。
- 仍未复现：自动化按键在真 cmdc 上仍看不到界面重绘（夹具同样按键可正常往返），怀疑与无真实键盘/焦点事件有关，**真机输入法行为需人工确认**。
- 另注：`cmdc --help` 里的模型列表读取由 app 自身弹确认框（"读取 CLI 模型列表"），与 CLI 的信任屏是两回事，不要混淆。
- `npm.cmd run check` 43/43（含 `interactive` 参数断言更新：`.args.slice(-5)`，因为 argv 头部是随安装方式变化的运行时/脚本路径）。

## 输入法首个按键与锁存（2026-09-23 第五次）

用户实测反馈：中文模式下"输入的字符会出现在 cmd 里，输入法又拿到一个字符"，敲 `a` 回车后出现 `aa`，再回车才开始对话；且"第一次必须回车"仍在。

- 原因一（字母泄漏 + 重复）：**Windows 输入法的第一个组合按键的 keydown 早于 `compositionstart`**，Chromium 用 `keyCode 229` 标记它。此前只在 `composing` 为真时拦 keydown，所以这第一个键被 xterm 原样送进 CLI，随后 `compositionend` 的提交文本又被送一次 → `aa`。修复：keydown 判定改为 `event.isComposing || event.keyCode === 229`。
- 原因二（回车被吞）：此前用一个锁存标志 `composing` 拦 keydown，一旦某次组合没正常结束，锁存卡住，连回车、方向键、Ctrl+C 都会被吞——用户要按第二次回车才通。修复：取消 keydown/input 的锁存判定，改为逐事件看自身信号（`input` 仍按 `isComposing`/组合态判断，避免组合文本泄漏）。
- 冒烟新增断言：先派发"229 且 isComposing=false"的 keydown，再走 `compositionstart/update/end('家')`，断言 CLI 侧从未出现 `ECHO:j`、从未出现 `jia`，且 `家` 到达、无重复、取消组合后仍可继续键入。`npm.cmd run check` 43/43、build、desktop-smoke 与 chrome-smoke 通过。
- 仍未人工验收：真机输入法下的候选框位置与"首个回车"是否彻底消失。

## 输入法 `input` 事件泄漏（2026-09-23 第六次）

用户的实测描述给出了关键线索："输入的字符会出现在 cmd 里，输入法也拿到一个字符，回车后出现 `aa`"。这说明**泄漏走的是 `input` 事件而不是键盘事件**。

- 机制：第一个组合键的 keydown 带 `keyCode 229`（已拦），但 Chromium 随后派发的**组合 `input` 事件可能早于 `compositionstart`**，此时锁存标志 `composing` 仍为 false → 事件穿过守卫 → xterm 的 `input` 处理器把组合文本写进 CLI（第一个字符）；随后 `compositionend` 又由我们送一次（第二个字符）→ `aa`。同一锁存还会在异常时吞掉回车。
- 修复：`input` 守卫改为 **`(event as InputEvent).isComposing || composing`**（事件自身的标志不会因时序漏判）；`compositionend` 后**延迟一个 tick 才释放**锁存，正好压掉紧随其后的那个 `isComposing=false` 提交 `input`（否则同一条文本送两遍）；`keydown` 完全不看锁存，只看 `isComposing`/`229`，因此组合异常再也不会吞键。
- 冒烟改为**按真实事件序列驱动**：229 且 `isComposing=false` 的 keydown → `compositionstart` → 带 `isComposing=true` 的 `input` → `compositionend` → 随后的 `isComposing=false` 的 `input`。断言：CLI 侧无 `ECHO:j`、无 `jia`，`家` 到达，**无 `家家`（不重复）**，取消组合后仍可继续键入。
- 未验收：真实输入法下"上屏后是否只剩一份文本"。注意中文输入法里**第一次回车是选词上屏**，本就该由输入法消费、不提交给 CLI，这与"上屏文本重复"是两件事。

## 真机追踪结论：回退组合接管（2026-09-23 第七次）

用户提供了开发版 `[term]` 追踪日志，直接证实前几轮的方向是错的：

```
[term] spawn …index.mjs --trust --skip-onboarding --no-auto-update cwd=…   ← 参数生效
[term] keydown key=Process code=229 composing=false trusted=true           ← 正常（已不再拦）
[term] compositionstart trusted=true
[term] input type=insertCompositionText composing=true data="a" blocked=true
[term] write "a"        ← 关键：我的守卫判定 blocked，但 xterm 仍把组合文本写进了 PTY
…
[term] compositionend data="a" trusted=false   ← 我们又在提交时写一次 → "aa"
```

- 根因：为了防 xterm "卡在组合态"而拦掉 `compositionstart`，等于**把"正在组合"这件事对 xterm 隐藏**；它于是把 `insertCompositionText` 当普通输入转发给 CLI（第一个字符），我们交完再送一次（第二个字符）→ 用户看到的"终端出现字符 + 回车两个字符"。
- `blocked=true` 只说明**我的**监听器决定拦；xterm 的监听器在捕获阶段注册更早，先执行完并已触发 `onData`，所以 `stopImmediatePropagation` 根本不起作用。
- 结论与修复：**组合交回 xterm 原生处理**，`TerminalView` 里的组合/按键监听改为纯观察（记录日志、不 `stopPropagation`），删除自研的提交投递与锁存。冒烟中"真实事件序列"的断言（拼音不泄漏、提交到达且不重复、取消组合后仍能键入）在原生路径下全部通过。
- 同时保留：`[term]` 追踪（仅开发版，主进程转发到启动控制台）与"对话框关闭后焦点落到 `<body>` 时收回焦点到终端"的修复。
- 教训记入本文：在无法复现真机输入法的环境里，不应反复以合成事件为依据改动 xterm 的输入路径；先拿到真实事件序列再动手。

## 真 cmdc 的启动吞键（2026-09-23 第八次）

回退组合接管后，用户反馈"两个字符"已解决、其余依旧。为定位剩余症状，用真 cmdc 做逐键实验（不需要输入法，本机可复现）：

```
PAINTED banner ✓ (1823 bytes)
KEY-a  bytes=0     ← 无任何反应
KEY-s  bytes=67
KEY-d  bytes=0
ENTER  bytes=0     ← 连回车都不响应
KEY-x  bytes=378   visible="─────\r\n> x \r\n─────"   ← 约 8 秒后同一个键立刻被画出
```

- 结论：**cmdc 启动后约 7 秒内不读 stdin**；这期间敲进去的字符会先进入控制台行缓冲，等 CLI 切到原始输入模式时被丢弃。用户看到的"敲什么都没反应、回车之后才行"就是这个启动窗口，不是传输问题（写入都到达了 PTY）。
- 修复：渲染层增加就绪门。CLI 输出安静 700ms 后判定就绪，期间的按键缓存在本地并在就绪后一次性补发；同时显示「CLI 正在启动…」提示（独立元素 `.terminal-boot`，与错误用的 `.terminal-notice` 分开）。追踪日志新增 `[term] ready` 与 `[term] flush "…"` 便于核对。
- 局限（如实记录）：就绪判定是启发式（安静 700ms）。像 cmdc 这种"先画完再静默几秒"的 CLI，可能在真正可读之前就被判定就绪，此时的补发仍会被 CLI 丢弃；此时界面上的启动提示已经消失，可据此区分"我们没发"与"CLI 没收"。
- 冒烟新增：`.terminal-boot` 先出现、随后消失，之后键盘 → PTY 往返仍然通过。`npm.cmd run check` 43/43、build、两个冒烟套件通过。
- 未解决/未验收：候选框仍在终端最右（CLI 自身把隐藏光标停在该行末列，实测 76 列时同样贴右），CSS 无法改变；真机输入法上屏后的观感需人工确认。

## 交接说明：终端输入法现状

用户已把该项工作转交给他人，此节供接手者快速对齐（结论均有上文证据）。

**已修复并有验证**
- 上屏文本重复/拼音泄漏：根因是本应用拦截组合事件（真机 `[term]` 日志证明 xterm 先于我们的监听器转发）。现已回退为 **xterm 原生处理组合**，渲染层只做观察记录；冒烟用真实事件序列断言"不泄漏、只送一次、取消组合不锁死"。
- 部分"首次回车无反应"：cmdc 启动时的文件夹信任屏与 taste 引导屏。交互式启动已加 `--trust --skip-onboarding --no-auto-update`（依据 `cmdc --help`）。加之前实测整屏没有横幅。
- 启动期吞键：真 cmdc 实测启动后约 7 秒不读 stdin（`KEY-a`/`KEY-d`/`ENTER` 输出 0 字节，第 8 秒同一按键立刻画出 `> x`）。已加就绪门：输出安静 700ms 判就绪，之前按键缓存后补发，界面显示 `.terminal-boot` 提示。
- 焦点：确认框关闭后焦点落到 `<body>` 会让终端看起来完全无响应，已补焦点回收（仅在焦点不在任何输入控件时收回）。

**仍未解决**
- 输入法候选框停在终端最右：xterm 把隐藏输入框放在它跟踪的光标单元格上，而 cmdc 画完满宽边框后把隐藏光标留在该行末列（96 列与 76 列实测都贴右）。这是 CLI 自身的光标位置，CSS 无效（xterm 每次光标变化都重写内联 `left/top`）。唯一可行杠杆：检测隐藏光标（`\x1b[?25l`）时把锚点钉到别处（如左下角），代价是偏离 CLI 光标——需产品决策，未实现。
- 就绪门是启发式：像 cmdc 这种"先画完横幅、再静默数秒"的 CLI 可能在真正可读前被判就绪，那一次补发仍被 CLI 丢弃。可改为等 CLI 画出输入框特征，或"首次安静 + 最短等待"组合判定。

**调试工具（建议保留）**
- 开发版把终端输入链路逐条打成 `[term] …`（`keydown`/`input`/`composition` 的标志位与文本、每次写入 PTY、`spawn` 实际参数、`ready`/`flush`），主进程转发到启动应用的控制台窗口。真机问题务必先看这份日志。
- 复现模式（不需输入法即可跑真 CLI）：`page.exposeFunction` 自动确认对话框 + `window.studio.onTerminal`/`terminalWrite` 驱动，见本项目上文探针记录。

**踩坑记录（勿重犯）**
1. 不要用 `stopImmediatePropagation` 拦 xterm 的组合事件：xterm 的捕获监听器注册更早、已经转发；而且对 xterm 隐藏组合态会让它把拼音当普通输入送进 CLI。合成事件测试看不出这一点，只有真机日志能。
2. 不要只依赖合成 CompositionEvent 做结论——前六轮的判断因此错了一半。
3. xterm 隐藏输入框的位置由内联样式决定，纯 CSS 覆盖无效。
