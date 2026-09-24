import { useCallback, useEffect, useRef, useState } from 'react';
export type ToastLevel = 'info' | 'success' | 'warning' | 'error';
export type Toast = { text: string; level: ToastLevel };
export function useToast() {
  const [toast, update] = useState<Toast | null>(null); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setToast = useCallback((text: string, level: ToastLevel = 'info') => {
    clearTimeout(timer.current); update(text ? { text, level } : null);
    if (text) timer.current = setTimeout(() => update(null), 4000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, setToast] as const;
}
