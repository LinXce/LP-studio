import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { ExternalLink, Plus, Power, RotateCcw, Terminal as TerminalIcon, X } from 'lucide-react';
import type { ProviderView, Session } from '../../../packages/contracts';
import { bridge } from './bridge';
import { SessionPicker } from './SessionPicker';
import type { ThemeId } from './theme';
import { attachTerminalIme } from './terminalIme';

// The terminal stays dark in both themes, matching the existing one-shot command panel.
const terminalThemes: Record<ThemeId, ITheme> = {
  midnight: { background: '#0e1017', foreground: '#d8dce8', cursor: '#a1b2ff', cursorAccent: '#0e1017', selectionBackground: '#26334e', black: '#0e1017', brightBlack: '#4e5c76' },
  industrial: { background: '#171e1e', foreground: '#d8e0d9', cursor: '#65c5ab', cursorAccent: '#171e1e', selectionBackground: '#31423d', black: '#171e1e', brightBlack: '#5f7a70' },
};
type Props = {
  theme: ThemeId; session?: Session; label: string; sessions: Session[]; closedTabs: string[]; providers: ProviderView[];
  providerId: string; model: string; disabled: boolean; active: boolean; focusRequest: number;
  onSelectSession: (id: string) => void; onCloseTab: (id: string) => void; onNewSession: () => void;
  onSelect: (providerId: string, model: string) => Promise<void>; onCreate: () => void; error: (e: unknown) => void;
};
export function TerminalView({ theme, session, label, sessions, closedTabs, providers, providerId, model, disabled, active, focusRequest, onSelectSession, onCloseTab, onNewSession, onSelect, onCreate, error }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<Terminal | undefined>(undefined);
  const focusPending = useRef(false);
  const [notice, setNotice] = useState('');
  const [serial, setSerial] = useState(0);
  const [booted, setBooted] = useState(false);
  const sessionId = session?.id ?? '';
  const activeRef = useRef(active);
  activeRef.current = active;
  const isCommandCli = providers.some(p => p.id === session?.providerId && p.kind === 'command-cli');
  useEffect(() => {
    if (!sessionId || !host.current) return;
    // The theme is read once here; a separate effect restyles the live terminal on theme change.
    const view = new Terminal({ fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 13, cursorBlink: true, scrollback: 5000, theme: terminalThemes[theme] });
    const fit = new FitAddon(); view.loadAddon(fit); view.open(host.current);
    instance.current = view;
    try { fit.fit(); } catch { /* the host may not be laid out yet */ }
    // cmdc drops input until its Ink prompt is installed; enable the textarea when it is ready.
    if (view.textarea && isCommandCli) view.textarea.disabled = true;
    if (active && !isCommandCli) view.focus();
    let alive = true;
    // A tab/button click can reclaim focus after React mounts the terminal.
    // Correct that once on the next frame; never refocus while an IME is active.
    const focusFrame = requestAnimationFrame(() => {
      if (alive && activeRef.current && !isCommandCli && view.textarea && document.activeElement !== view.textarea &&
          !view.textarea.matches(':focus') && !document.activeElement?.matches('input, textarea, [contenteditable=true]')) view.focus();
    });
    let ready = false;
    let recent = '';
    let promptReadyScheduled = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const sendToPty = (data: string) => {
      // Focus reporting is terminal protocol traffic, never typed content.
      // Passing it to an Ink CLI can corrupt its first input event.
      if (data === '\x1b[I' || data === '\x1b[O') return;
      if (!ready) return;
      void bridge.terminalWrite(sessionId, data).catch(failure => { if (alive) error(failure); });
    };
    const markReady = () => {
      if (ready || !alive) return;
      ready = true;
      clearTimeout(idle);
      clearTimeout(fallback);
      if (view.textarea) view.textarea.disabled = false;
      setBooted(true);
      // A disabled textarea cannot take focus. Finish navigation when the CLI is ready,
      // including when a hidden page's input retained focus during the switch.
      const focused = document.activeElement as HTMLElement | null;
      const editingElsewhere = focused && focused !== view.textarea &&
        focused.matches('input, textarea, [contenteditable=true]') && focused.getClientRects().length > 0;
      // A visible editor means the user has moved focus deliberately while the CLI booted.
      // Honor that choice; otherwise complete the pending terminal focus request.
      if (activeRef.current && !editingElsewhere &&
          (focusPending.current || !focused?.matches('input, textarea, [contenteditable=true]') || !focused.getClientRects().length)) {
        view.focus();
      }
      focusPending.current = false;
    };
    let refreshIme = () => {};
    const stopEvents = bridge.onTerminal(event => {
      if (event.sessionId !== sessionId) return;
      if (event.type === 'data') {
        recent = (recent + event.data).slice(-10000);
        // cmdc installs its key handler when it draws this prompt.
        if (isCommandCli && !promptReadyScheduled && /Ask your question/i.test(recent)) {
          clearTimeout(idle); promptReadyScheduled = true; idle = setTimeout(markReady, 120);
        } else if (!isCommandCli && !ready) {
          markReady();
        }
        view.write(event.data, refreshIme);
      } else { clearTimeout(idle); markReady(); view.write(`\r\n[LP Studio] 终端已退出，退出码 ${event.exitCode}。\r\n`); }
    });
    const input = view.onData(sendToPty);
    const ime = attachTerminalIme(view, host.current);
    refreshIme = ime.refresh;
    const observer = new ResizeObserver(() => {
      try { fit.fit(); } catch { return; }
      void bridge.terminalResize(sessionId, view.cols, view.rows).catch(() => {});
    });
    observer.observe(host.current);
    void bridge.terminalStart(sessionId).then(result => {
      if (!alive) return;
      setNotice(result.ok ? '' : result.message);
      if (result.ok) {
        // Don't lock out login/onboarding or a changed cmdc prompt indefinitely.
        // Readiness recognition is only an input gate; it never buffers input.
        if (!ready) fallback = setTimeout(markReady, isCommandCli ? 8000 : 1200);
        void bridge.terminalResize(sessionId, view.cols, view.rows).catch(() => {});
        // Keep the existing textarea focus: refocusing while IME composes loses keys.
      }
    }).catch(failure => { if (alive) error(failure); });
    return () => {
      alive = false; focusPending.current = false; cancelAnimationFrame(focusFrame); clearTimeout(idle); clearTimeout(fallback); observer.disconnect(); stopEvents(); input.dispose(); ime.dispose(); view.dispose();
      instance.current = undefined;
      void bridge.terminalStop(sessionId).catch(() => {});
    };
  }, [sessionId, serial, isCommandCli]);
  useEffect(() => { if (instance.current) instance.current.options.theme = terminalThemes[theme]; }, [theme]);
  // Reselecting an existing session leaves focus on the clicked sidebar or tab
  // button. Give the terminal focus after that click, even if its id is unchanged.
  useEffect(() => {
    if (!active || !sessionId) { focusPending.current = false; return; }
    focusPending.current = true;
    const frame = requestAnimationFrame(() => {
      const view = instance.current;
      if (!view?.textarea || view.textarea.disabled) return;
      const focused = document.activeElement as HTMLElement | null;
      if (focused && focused !== view.textarea &&
          focused.matches('input, textarea, [contenteditable=true]') && focused.getClientRects().length) return;
      view.focus();
      focusPending.current = document.activeElement !== view.textarea;
    });
    return () => cancelAnimationFrame(frame);
  }, [active, sessionId, focusRequest]);
  // A confirm dialog closing leaves focus on <body>, which makes the terminal look dead: keys go nowhere
  // and no amount of typing helps. Reclaim focus whenever nothing else legitimately holds it.
  useEffect(() => {
    if (!active || !sessionId) return;
    const reclaim = () => {
      const focused = document.activeElement;
      if (focused && focused !== document.body) return;
      const view = instance.current;
      if (view?.textarea?.disabled) focusPending.current = true;
      else view?.focus();
    };
    const afterPointer = () => { setTimeout(reclaim, 0); };
    window.addEventListener('focus', reclaim);
    document.addEventListener('pointerup', afterPointer);
    return () => { window.removeEventListener('focus', reclaim); document.removeEventListener('pointerup', afterPointer); };
  }, [active, sessionId]);
  async function restart() {
    // Stop first so the new start does not race the teardown of the previous PTY.
    await bridge.terminalStop(sessionId).catch(() => {});
    setNotice(''); setBooted(false); setSerial(value => value + 1);
  }
  async function stop() {
    await bridge.terminalStop(sessionId).catch(() => {});
    setNotice('终端已停止。点「重启」可以重新启动。');
  }
  return <div className="terminal-view">
    <div className="tabs">{sessions.filter(entry => !closedTabs.includes(entry.id)).map(entry => <div key={entry.id} className={`session-tab ${sessionId === entry.id ? 'active' : ''}`}><button className="tab-open" onMouseDown={event => event.preventDefault()} onClick={() => onSelectSession(entry.id)}><TerminalIcon size={13}/><span>{entry.title}</span></button><button className="tab-close" title={`关闭标签：${entry.title}`} aria-label={`关闭标签：${entry.title}`} onClick={() => onCloseTab(entry.id)}><X size={13}/></button></div>)}<button className="icon" title="新建会话" aria-label="新建会话" onClick={onNewSession}><Plus size={15}/></button></div>
    {session ? <>
      <div className="terminal-toolbar">
        <span className="terminal-label"><TerminalIcon size={14}/>{label}</span>
        <div className="row">
          <button className="text-button" title="在系统终端（cmd）中打开同一个 CLI，使用系统的输入法" onClick={() => void bridge.openExternalTerminal(sessionId).then(result => { if (!result.ok) setNotice(result.message); }).catch(error)}><ExternalLink size={13}/>系统终端</button>
          <button className="text-button" title="用当前模型重新启动终端" onClick={() => void restart()}><RotateCcw size={13}/>重启</button>
          <button className="text-button" title="终止终端进程" onClick={() => void stop()}><Power size={13}/>停止</button>
        </div>
      </div>
      {notice && <div className="terminal-notice">{notice}</div>}
      {!booted && !notice && <div className="terminal-boot">CLI 正在启动，请等待输入提示符出现</div>}
      <div className="terminal-host" ref={host}/>
    </> : <div className="terminal-empty">
      <div className="terminal-empty-icon"><TerminalIcon size={30}/></div>
      <h2>在终端里直接用 CLI</h2>
      <p>先选好连接与模型，再点「新建会话」；终端会在当前项目目录运行该 CLI 自己的界面。</p>
      <div className="terminal-empty-picker"><SessionPicker providers={providers} providerId={providerId} model={model} disabled={disabled} onChange={onSelect} error={error}/></div>
      <button className="primary terminal-empty-create" disabled={disabled || !providerId} onClick={onCreate}>新建会话</button>
      <small>只有 CLI 连接能开终端；API 连接会给出提示。</small>
    </div>}
  </div>;
}
