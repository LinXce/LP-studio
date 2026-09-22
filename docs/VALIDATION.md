# 验证范围

验证日期：2026-09-22。系统 Windows，Node v24.19.0。依赖实际解析版本以 package-lock.json 为准。

## 自动化

- TypeScript strict 类型检查。
- UI 不导入 Node/Electron/core/providers 的边界检查。
- 16 项测试覆盖文件 apply/rollback、外部变更、路径越界、NTFS 相关路径、junction、UTF-8 BOM/编码、崩溃状态恢复、JSONL、SSE、跨分片 Key 脱敏、CLI 协议、API URL 限制、本机 HTTP 流、中断、stdin 字面值和停止进程。
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
