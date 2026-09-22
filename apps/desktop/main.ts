import { app, BrowserWindow, dialog, ipcMain, session as electronSession } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { providerSchema } from '../../packages/contracts';
import { Store } from '../../packages/core/storage';
import { ensureDefaultProviders } from '../../packages/core/defaults';
import { FileService, listFiles, readSnapshot } from '../../packages/core/files';
import { Runs } from '../../packages/core/runs';
import { configureSession, sessionConfig } from '../../packages/core/sessions';
import { configuredModels } from '../../packages/providers/models';
import { adapterFor } from '../../packages/providers';
import { apiEndpoint } from '../../packages/providers/api';
import { Vault } from './vault';
import packageInfo from '../../package.json';
const devUrl = !app.isPackaged ? process.env.LP_DEV_URL : undefined;
const base = app.isPackaged ? path.dirname(app.getPath('exe')) : process.cwd();
const portable = !app.isPackaged || existsSync(path.join(base, 'portable.flag'));
const dataDir = portable ? path.join(base, '.lp-data') : path.join(app.getPath('appData'), 'LP Studio');
mkdirSync(dataDir, { recursive: true }); app.setPath('userData', path.join(dataDir, 'electron'));
const locked = app.requestSingleInstanceLock();
if (!locked) { console.log('[desktop] Another instance is running; activating its window.'); app.quit(); }
let win: BrowserWindow | undefined; let runs: Runs | undefined;
app.on('second-instance', () => { if (win?.isMinimized()) win.restore(); win?.show(); win?.focus(); });
app.on('before-quit', () => runs?.stopAll());
app.on('window-all-closed', () => app.quit());
const idSchema = z.string().uuid(); const relativeSchema = z.string().max(2000);
async function main() {
  console.log('[desktop] Waiting for Electron readiness...');
  await app.whenReady();
  console.log('[desktop] Loading local workspace...');
  const store = new Store(dataDir); const files = new FileService(store); const vault = new Vault(dataDir); await files.recover();
  ensureDefaultProviders(store);
  let migratedModels = false;
  for (const s of store.state.sessions) if (s.model === undefined) { s.model = store.provider(s.providerId).model; migratedModels = true; }
  if (migratedModels) store.save();
  console.log('[desktop] Creating desktop window...');
  win = new BrowserWindow({ show: false, frame: false, width: 1520, height: 960, minWidth: 1000, minHeight: 640, title: 'LP Studio', backgroundColor: '#0c0e13', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
  win.once('ready-to-show', () => { win?.show(); win?.focus(); console.log('[desktop] Window visible.'); });
  win.webContents.on('render-process-gone', (_event, details) => console.error('[desktop] Renderer exited:', details.reason));
  win.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) console.error(`[desktop] UI load failed (${code}): ${description}`);
  });
  const fileUrl = pathToFileURL(path.join(__dirname, '../ui/index.html')).toString();
  const trusted = (url: string) => devUrl ? new URL(url).origin === new URL(devUrl).origin : url.split('#')[0] === fileUrl;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!trusted(url)) event.preventDefault(); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  electronSession.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  electronSession.defaultSession.setPermissionCheckHandler(() => false);
  runs = new Runs(store, files, id => vault.get(id), event => { if (win && !win.isDestroyed()) win.webContents.send('studio:event', event); });
  const handle = (name: string, handler: (...args: any[]) => unknown) => ipcMain.handle(`studio:${name}`, (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame || !trusted(event.senderFrame.url)) throw Error('未授权的 IPC 来源');
    return handler(...args);
  });
  const pendingRuns = new Set<string>();
  const pendingConfirmations = new Map<string, (accepted: boolean) => void>();
  const cancelConfirmations = () => { for (const resolve of pendingConfirmations.values()) resolve(false); pendingConfirmations.clear(); };
  win.on('closed', cancelConfirmations);
  win.webContents.on('did-start-loading', cancelConfirmations);
  win.webContents.on('render-process-gone', cancelConfirmations);
  const confirm = (title: string, detail: string): Promise<boolean> => new Promise(resolve => {
    if (!win || win.isDestroyed() || pendingConfirmations.size >= 10) { resolve(false); return; }
    const id = randomUUID(); pendingConfirmations.set(id, resolve);
    win.webContents.send('studio:confirm', { id, title, detail });
  });
  handle('answerConfirm', (id, accepted) => {
    idSchema.parse(id); z.boolean().parse(accepted);
    const resolve = pendingConfirmations.get(id); pendingConfirmations.delete(id); resolve?.(accepted);
  });
  handle('windowControl', action => {
    z.enum(['minimize', 'maximize', 'close']).parse(action);
    if (action === 'minimize') win!.minimize();
    if (action === 'maximize') { if (win!.isMaximized()) win!.unmaximize(); else win!.maximize(); }
    if (action === 'close') win!.close();
  });
  handle('windowMaximized', () => win!.isMaximized());
  const publishWindowState = () => win!.webContents.send('studio:windowState', win!.isMaximized());
  win.on('maximize', publishWindowState); win.on('unmaximize', publishWindowState);
  handle('deleteSession', async id => {
    idSchema.parse(id); const entry = store.session(id);
    if (runs!.isBusy(id) || pendingRuns.has(id)) throw Error('请先停止该会话的运行任务，再删除会话');
    if (!await confirm('删除会话', `确定删除“${entry.title}”？此操作无法撤销。\n仅删除对话记录，项目文件及修改/回滚记录会保留。`)) return false;
    if (runs!.isBusy(id) || pendingRuns.has(id)) throw Error('该会话正在运行，不能删除');
    store.state.sessions = store.state.sessions.filter(s => s.id !== id);
    for (const change of store.state.changes) if (change.sessionId === id) delete change.sessionId;
    store.save(); return true;
  });
  handle('bootstrap', () => ({ ...store.state, providers: store.state.providers.map(p => ({ ...p, hasKey: vault.has(p.id) })), dataDir, version: packageInfo.version }));
  handle('openProject', async () => {
    const result = await dialog.showOpenDialog(win!, { title: '打开可信任的项目目录', properties: ['openDirectory'] });
    if (result.canceled) return null;
    const root = await realpath(result.filePaths[0]);
    const existing = store.state.projects.find(p => p.root.toLowerCase() === root.toLowerCase()); if (existing) return existing;
    const project = { id: randomUUID(), root, name: path.basename(root) }; store.state.projects.push(project); store.save(); return project;
  });
  handle('relocateProject', async id => {
    const project = store.project(idSchema.parse(id));
    if (store.state.sessions.some(s => s.projectId === id && runs!.isBusy(s.id))) throw Error('请先停止此项目的运行任务');
    const result = await dialog.showOpenDialog(win!, { title: '重新定位项目目录（保留会话和修改记录）', properties: ['openDirectory'] });
    if (result.canceled) return null;
    const root = await realpath(result.filePaths[0]);
    if (store.state.projects.some(p => p.id !== id && p.root.toLowerCase() === root.toLowerCase())) throw Error('该目录已经是另一个项目');
    project.root = root; project.name = path.basename(root); store.save(); return project;
  });
  handle('tree', (id, relative) => listFiles(store.project(idSchema.parse(id)).root, relativeSchema.parse(relative)));
  handle('readFile', (id, relative) => readSnapshot(store.project(idSchema.parse(id)).root, relativeSchema.parse(relative)));
  handle('createSession', (projectId, providerId, model) => {
    store.project(idSchema.parse(projectId)); store.provider(idSchema.parse(providerId));
    const selectedModel = z.string().trim().max(150).optional().parse(model) ?? store.provider(providerId).model;
    const entry = { id: randomUUID(), projectId, providerId, model: selectedModel, title: '新会话', messages: [], updatedAt: new Date().toISOString() }; store.state.sessions.push(entry); store.save(); return entry;
  });
  handle('configureSession', (id, providerId, model) => configureSession(store, idSchema.parse(id), idSchema.parse(providerId), z.string().trim().max(150).parse(model), runs!.isBusy(id) || pendingRuns.has(id)));
  handle('providerModels', async (id, discover) => {
    const config = store.provider(idSchema.parse(id)); const adapter = adapterFor(config.kind);
    if (z.boolean().optional().parse(discover) && adapter.listModels) {
      if (!await confirm('读取 CLI 模型列表', `将运行 ${config.executable || 'cmdc'} --list-models。此命令可能联网更新模型目录，不发送对话。`)) throw Error('已取消读取');
      const models = await adapter.listModels(config);
      return { models: [...new Set([...configuredModels(config), ...models])], note: '来自本机 CLI 模型目录；实际可用性由登录账号决定' };
    }
    return { models: configuredModels(config), note: '已配置模型 / CLI 别名；可在连接设置添加支持的模型 ID' };
  });
  handle('saveProvider', (input, secret) => {
    const config = providerSchema.parse(input); const key = z.string().max(16000).optional().parse(secret);
    if (runs!.hasProvider(config.id) || [...pendingRuns].some(id => store.session(id).providerId === config.id)) throw Error('请先停止使用此模型的会话');
    if (config.kind.endsWith('-api')) apiEndpoint(config);
    if (key !== undefined) vault.set(config.id, key.trim());
    const index = store.state.providers.findIndex(p => p.id === config.id);
    if (index < 0) store.state.providers.push(config); else store.state.providers[index] = config;
    store.save(); return { ...config, hasKey: vault.has(config.id) };
  });
  handle('deleteProvider', id => {
    idSchema.parse(id); if (store.state.sessions.some(s => s.providerId === id)) throw Error('已有会话使用此模型，不能删除；可修改配置或清除密钥');
    vault.set(id, ''); store.state.providers = store.state.providers.filter(p => p.id !== id); store.save();
  });
  handle('probeProvider', async id => {
    const config = store.provider(idSchema.parse(id));
    if (config.kind.endsWith('-cli') && !await confirm('检测本地 CLI', `将运行 ${config.executable || (config.kind === 'command-cli' ? 'cmdc' : config.kind.replace('-cli', ''))} --version。此程序以当前用户权限执行，请确认来源可信。`)) return '已取消';
    return adapterFor(config.kind).probe(config);
  });
  handle('run', async input => {
    const request = z.object({ sessionId: idSchema, prompt: z.string().trim().min(1).max(60000), context: z.array(relativeSchema).max(30) }).parse(input);
    const s = store.session(request.sessionId); const p = sessionConfig(store, s.id); const project = store.project(s.projectId);
    if (pendingRuns.has(s.id) || runs!.isBusy(s.id)) throw Error('此会话正在运行或等待确认');
    pendingRuns.add(s.id);
    try {
    const detail = p.kind.endsWith('-api')
      ? `目标：${apiEndpoint(p)}\n模型：${p.model}\n将发送最近的对话及 ${request.context.length} 个已选文件，可能产生费用。请确认目标服务可信。`
      : `程序：${p.executable || (p.kind === 'command-cli' ? 'cmdc' : p.kind.replace('-cli', ''))}\n项目：${project.root}\n模型：${p.model || 'CLI 默认'}\n复用该 CLI 的本地登录态。本应用不启动登录流程。将请求 CLI 的只读/规划模式；CLI 插件、配置和系统权限仍由 CLI 自身控制，这不是操作系统沙箱。仅运行可信项目与 CLI。`;
    if (!await confirm('运行模型并发送上下文', detail)) throw Error('已取消运行');
    return runs!.start(request);
    } finally { pendingRuns.delete(s.id); }
  });
  handle('stop', id => runs!.stop(idSchema.parse(id)));
  handle('command', async (sessionId, input) => {
    idSchema.parse(sessionId); const command = z.string().trim().min(1).max(16000).parse(input); const s = store.session(sessionId); const p = store.project(s.projectId);
    if (!await confirm('执行终端命令', `目录：${p.root}\n\n${command}\n\n命令将以当前 Windows 用户权限执行，可能读写项目以外的文件、访问网络。停止操作不会撤销已产生的副作用。`)) return null;
    return runs!.command(sessionId, command);
  });
  handle('propose', (id, input, content) => files.propose(idSchema.parse(id), z.object({ path: relativeSchema, content: z.string().max(1048576), hash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(input), z.string().max(1048576).parse(content)));
  for (const op of ['apply', 'rollback'] as const) handle(op, async id => {
    idSchema.parse(id); const c = store.state.changes.find(c => c.id === id); if (!c) throw Error('修改不存在');
    if (!await confirm(op === 'apply' ? '应用文件修改' : '回滚文件修改', `${store.project(c.projectId).root}\n${c.path}\n已保存修改前后文本；文件发生外部变化时将拒绝覆盖。`)) return null;
    return files.update(id, op === 'rollback');
  });
  console.log('[desktop] Loading UI...');
  if (devUrl) await win.loadURL(devUrl); else await win.loadFile(path.join(__dirname, '../ui/index.html'));
  win.show(); win.focus();
  console.log('[desktop] Desktop ready.');
  if (devUrl && process.send) process.send({ type: 'lp:desktop-ready' });
}
if (locked) void main().catch(err => { console.error('[desktop] Startup failed:', err); dialog.showErrorBox('LP Studio 启动失败', String(err.message)); app.quit(); });
