import { useLayoutEffect, useState } from 'react';

// Theme metadata and persistence are UI-only; adding a theme does not change IPC.
export const themes = [
  { id: 'midnight', name: '午夜深蓝', description: '深蓝工作区 · 柔和紫蓝强调色', editor: 'vs-dark' },
  { id: 'industrial', name: '工业浅色', description: '浅灰面板 · 深色终端 · 青绿与橙色', editor: 'light' },
] as const;
export type ThemeId = typeof themes[number]['id'];
const storageKey = 'lp-theme';
export function useTheme() {
  const [theme, updateTheme] = useState<ThemeId>(() => {
    try { const value = localStorage.getItem(storageKey); return themes.find(t => t.id === value)?.id ?? 'midnight'; }
    catch { return 'midnight'; }
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(storageKey, theme); } catch { /* Keep the selection for this window if storage is unavailable. */ }
  }, [theme]);
  return { theme, setTheme: updateTheme, editorTheme: themes.find(t => t.id === theme)!.editor };
}
