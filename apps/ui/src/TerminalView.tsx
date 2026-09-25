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
  const [notice, setNotice] = useState('');
  const [serial, setSerial] = useState(0);
  const [booted, setBooted] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const initialMetrics = () => ({ keys: 0, enter: 0, imeKeys: 0, otherKeys: 0, compositionStart: 0, compositionEnd: 0, beforeInput: 0, input: 0, data: 0, writes: 0, output: 0, focus: '无', lastEvent: '无' });
  const [diagnostics, setDiagnostics] = useState(initialMetrics);
  const diagnosingRef = useRef(false);
  diagnosingRef.current = diagnosing;
  const metrics = useRef(diagnostics);
  const describeFocus = () => {
    const focused = document.activeElement;
    if (focused?.classList.contains('xterm-helper-textarea')) return '终端输入框';
    if (focused instanceof HTMLElement) return focused.getAttribute('aria-label') || focused.tagName.toLowerCase();
    return '无';
  };
  const count = (field: 'keys' | 'enter' | 'imeKeys' | 'otherKeys' | 'compositionStart' | 'compositionEnd' | 'beforeInput' | 'input' | 'data' | 'writes' | 'output', event?: string) => {
    if (!diagnosingRef.current) return;
    metrics.current[field]++;
    metrics.current.focus = describeFocus();
    if (event) metrics.current.lastEvent = event;
    setDiagnostics({ ...metrics.current });
  };
  const sessionId = session?.id ?? '';
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!sessionId || !host.current) return;
    // The theme is read once here; a separate effect restyles the live terminal on theme change.
    const view = new Terminal({ fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 13, cursorBlink: true, scrollback: 5000, theme: terminalThemes[theme] });
    const fit = new FitAddon(); view.loadAddon(fit); view.open(host.current);
    instance.current = view;
    try { fit.fit(); } catch { /* the host may not be laid out yet */ }
    if (active) view.focus();
    let alive = true;
    // A tab/button click can reclaim focus after React mounts the terminal.
    // Correct that once on the next frame; never refocus while an IME is active.
    const focusFrame = requestAnimationFrame(() => {
      if (alive && activeRef.current && view.textarea && document.activeElement !== view.textarea &&
          !document.activeElement?.matches('input, textarea, [contenteditable=true]')) view.focus();
    });
    const sendToPty = (data: string) => {
      // Focus reporting is terminal protocol traffic, never typed content.
      // Passing it to an Ink CLI can corrupt its first input event.
      if (data === '\x1b[I' || data === '\x1b[O') return;
      count('data');
      void bridge.terminalWrite(sessionId, data).then(() => { if (alive) count('writes'); }).catch(failure => { if (alive) error(failure); });
    };
    let refreshIme = () => {};
    const stopEvents = bridge.onTerminal(event => {
      if (event.sessionId !== sessionId) return;
      if (event.type === 'data') {
        count('output');
        view.write(event.data, refreshIme);
      } else {
        view.write(`\r\n[LP Studio] 终端已退出，退出码 ${event.exitCode}。\r\n`);
      }
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
      // This describes only the PTY start result. Input forwarding never waits for a prompt.
      setBooted(true);
      if (result.ok) void bridge.terminalResize(sessionId, view.cols, view.rows).catch(() => {});
    }).catch(failure => { if (alive) { setBooted(true); setNotice(failure instanceof Error ? failure.message : String(failure)); } });
    return () => {
      alive = false; cancelAnimationFrame(focusFrame); observer.disconnect(); stopEvents(); input.dispose(); ime.dispose(); view.dispose();
      instance.current = undefined;
      void bridge.terminalStop(sessionId).catch(() => {});
    };
  }, [sessionId, serial]);
  useEffect(() => { if (instance.current) instance.current.options.theme = terminalThemes[theme]; }, [theme]);
  // Reselecting an existing session leaves focus on the clicked sidebar or tab
  // button. Give the terminal focus after that click, even if its id is unchanged.
  useEffect(() => {
    if (!active || !sessionId) return;
    const frame = requestAnimationFrame(() => {
      const view = instance.current;
      if (!view?.textarea) return;
      const focused = document.activeElement as HTMLElement | null;
      if (focused && focused !== view.textarea &&
          focused.matches('input, textarea, [contenteditable=true]') && focused.getClientRects().length) return;
      view.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, sessionId, focusRequest]);
  // The first printable key can arrive while a nav or tab button still owns focus.
  // The keydown's target is already fixed at that point: focusing xterm alone would
  // lose the first character. Send it once through xterm's normal onData pipeline.
  useEffect(() => {
    if (!active || !sessionId) return;
    const firstKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') count('enter', `回车${event.isComposing ? '（组合中）' : ''}`);
      else if (event.isComposing || event.keyCode === 229 || event.key === 'Process') count('imeKeys', `输入法按键（键码 ${event.keyCode}）`);
      else if (event.key.length === 1) count('keys', '字符按键');
      else count('otherKeys', `其他键（键码 ${event.keyCode}）`);
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) return;
      const view = instance.current;
      if (!view?.textarea || document.activeElement === view.textarea) return;
      const focused = document.activeElement as HTMLElement | null;
      if (focused?.matches('input, textarea, select, [contenteditable=true]')) return;
      if (focused && focused !== document.body && !focused.closest('.rail, .tabs, .session-list, .terminal-host')) return;
      event.preventDefault();
      view.focus();
      view.input(event.key);
    };
    const area = instance.current?.textarea;
    const onCompositionStart = () => count('compositionStart', '开始组合输入');
    const onCompositionEnd = () => count('compositionEnd', '完成组合输入');
    const onBeforeInput = (event: Event) => count('beforeInput', `输入事件：${(event as InputEvent).inputType}`);
    const onInput = (event: Event) => count('input', `已输入：${(event as InputEvent).inputType}`);
    const onFocus = () => { if (diagnosingRef.current) { metrics.current.focus = describeFocus(); metrics.current.lastEvent = '终端焦点变化'; setDiagnostics({ ...metrics.current }); } };
    const onBlur = () => { if (diagnosingRef.current) { metrics.current.focus = describeFocus(); metrics.current.lastEvent = '终端焦点变化'; setDiagnostics({ ...metrics.current }); } };
    window.addEventListener('keydown', firstKey, true);
    area?.addEventListener('compositionstart', onCompositionStart, true);
    area?.addEventListener('compositionend', onCompositionEnd, true);
    area?.addEventListener('beforeinput', onBeforeInput, true);
    area?.addEventListener('input', onInput, true);
    area?.addEventListener('focus', onFocus);
    area?.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', firstKey, true);
      area?.removeEventListener('compositionstart', onCompositionStart, true);
      area?.removeEventListener('compositionend', onCompositionEnd, true);
      area?.removeEventListener('beforeinput', onBeforeInput, true);
      area?.removeEventListener('input', onInput, true);
      area?.removeEventListener('focus', onFocus);
      area?.removeEventListener('blur', onBlur);
    };
  }, [active, sessionId]);
  // A confirm dialog closing leaves focus on <body>, which makes the terminal look dead: keys go nowhere
  // and no amount of typing helps. Reclaim focus whenever nothing else legitimately holds it.
  useEffect(() => {
    if (!active || !sessionId) return;
    const reclaim = () => {
      const focused = document.activeElement;
      if (focused && focused !== document.body) return;
      const view = instance.current;
      view?.focus();
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
          <button className="text-button" title="仅统计事件数量和焦点，不记录输入内容" onClick={() => {
            metrics.current = initialMetrics();
            metrics.current.focus = describeFocus();
            setDiagnostics({ ...metrics.current }); setDiagnosing(value => !value);
            instance.current?.focus();
          }}>输入诊断{diagnosing ? '：开' : ''}</button>
          <button className="text-button" title="在系统终端（cmd）中打开同一个 CLI，使用系统的输入法" onClick={() => void bridge.openExternalTerminal(sessionId).then(result => { if (!result.ok) setNotice(result.message); }).catch(error)}><ExternalLink size={13}/>系统终端</button>
          <button className="text-button" title="用当前模型重新启动终端" onClick={() => void restart()}><RotateCcw size={13}/>重启</button>
          <button className="text-button" title="终止终端进程" onClick={() => void stop()}><Power size={13}/>停止</button>
        </div>
      </div>
      {diagnosing && <div className="terminal-boot" role="status">
        <div>输入诊断：字符按键 {diagnostics.keys} · 输入法按键 {diagnostics.imeKeys} · 回车 {diagnostics.enter} · 组合开始/结束 {diagnostics.compositionStart}/{diagnostics.compositionEnd} · beforeinput/input {diagnostics.beforeInput}/{diagnostics.input}</div>
        <div>xterm 发送 {diagnostics.data} · PTY 写入请求 {diagnostics.writes} · CLI 输出 {diagnostics.output} · 焦点 {diagnostics.focus} · 最后事件 {diagnostics.lastEvent}（不记录输入内容）</div>
      </div>}
      {notice && <div className="terminal-notice">{notice}</div>}
      {!booted && !notice && <div className="terminal-boot">正在连接终端…</div>}
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
