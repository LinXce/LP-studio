import { useCallback, useEffect, useRef, useState } from 'react';
export function useToast() {
  const [toast, update] = useState(''); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setToast = useCallback((message: string) => {
    clearTimeout(timer.current); update(message);
    if (message) timer.current = setTimeout(() => update(''), 4000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, setToast] as const;
}
