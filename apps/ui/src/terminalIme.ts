import type { Terminal } from '@xterm/xterm';

// xterm owns IME events and the PTY data stream. cmdc leaves its terminal
// cursor at the far right after drawing a prompt, so its native textarea
// needs a separate visual anchor for the Windows candidate window.
export function attachTerminalIme(view: Terminal, host: HTMLElement) {
  const area = view.textarea;
  if (!area) return { refresh: () => {}, dispose: () => {} };
  const helpers = area.parentElement!;
  let promptRow: number | undefined;
  const place = () => {
    const screen = host.querySelector('.xterm-screen');
    const rect = screen?.getBoundingClientRect();
    if (!rect || !view.cols || !view.rows) return;
    const buffer = view.buffer.active;
    // cmdc draws the shortcut hint several rows below the actual prompt;
    // its cursor is even farther down. Search the whole visible buffer.
    for (let row = view.rows - 1; row >= 0; row--) {
      const line = buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '';
      if (/^\s*>\s*Ask your question/i.test(line)) { promptRow = row; break; }
    }
    let x = buffer.cursorX;
    let y = buffer.cursorY;
    if (promptRow !== undefined) {
      const line = buffer.getLine(buffer.baseY + promptRow)?.translateToString(true) ?? '';
      if (/^\s*>\s*Ask your question/i.test(line)) {
        x = line.indexOf('>') + 2;
        y = promptRow;
      } else if (/^\s*>/.test(line)) {
        // The placeholder disappears after typing; keep the candidate window
        // on the edited row even though cmdc parks its ANSI cursor elsewhere.
        x = Math.max(2, Math.min(view.cols - 1, line.length));
        y = promptRow;
      } else {
        promptRow = undefined;
      }
    }
    const cellWidth = rect.width / view.cols;
    const cellHeight = rect.height / view.rows;
    helpers.style.setProperty('--terminal-ime-x', `${Math.max(0, Math.min(x * cellWidth, rect.width - cellWidth))}px`);
    helpers.style.setProperty('--terminal-ime-y', `${Math.max(0, y * cellHeight)}px`);
    // Chromium may scroll an overflow:hidden host horizontally to reveal a
    // growing composition textarea, moving the entire terminal off screen.
    if (host.scrollLeft) host.scrollLeft = 0;
  };
  area.addEventListener('focus', place);
  area.addEventListener('compositionstart', place, true);
  host.addEventListener('scroll', place);
  place();
  return { refresh: place, dispose: () => {
    area.removeEventListener('focus', place);
    area.removeEventListener('compositionstart', place, true);
    host.removeEventListener('scroll', place);
  } };
}