# 独立模块与多 AI 协作

本项目支持将改动分配给多个 AI；运行时不包含自动多代理调度。修改前先约定写入范围和契约。

| 工作范围 | 允许修改 | 保持稳定 |
|---|---|---|
| 界面布局/视觉 | apps/ui/src | StudioBridge、DTO；不导入后端模块 |
| 会话/权限/文件业务 | packages/core + 对应测试 | ProviderAdapter 与 UI contract |
| 厂商集成 | packages/providers + 协议 fixture | 统一事件；不改 UI 状态 |
| 桌面生命周期/安全 | apps/desktop | preload 白名单；渲染进程不获取 Node |
| 契约/数据迁移 | packages/contracts、Store schema | 属于共享变更，需先写迁移/兼容说明 |

建议每项任务限定文件列表，接口有变化先改 contracts 并让依赖模块通过 typecheck；分支提交后审查依赖方向和安全边界。此仓库未自动创建 Git 仓库或提交，用户可自行纳入现有版本管理。

添加厂商适配器不要在 Runs 中增加厂商 switch。解析器测试应包含真实脱敏 fixture：分片、CRLF、错误、中断、重复事件。不要把 Key、HOME 下凭证或实际对话样本提交进代码。

新适配器还需要 `interactive(config)`（返回 `{ command, args }`，**不带** `-p`/输出格式），交互式终端用它拉起 CLI 自己的 TUI；不实现该方法的适配器（如纯 API 连接）在终端里会给出明确提示而不是失败。

终端相关改动：UI 侧只经 `window.studio.terminal*` 与 `onTerminal`；`apps/desktop/terminal.ts` 的 PTY 依赖可注入，单测用假 PTY，不要依赖本机 `node-pty` 或真实 CLI。改动 PTY 启动参数时同时更新 `tests/terminal.test.ts`。

UI 组件允许导入 contracts 类型，不允许 node:*、electron 或 packages/core/providers。桌面端对返回对象作序列化，UI 不应依赖实例方法。

完成改动后：`npm.cmd run check`；涉及 UI/IPC 再 build 和 test:desktop；涉及包资源再验证 pack:win。桌面测试使用独立 `.cache/desktop-smoke-*` 数据，不改实际项目文件。
