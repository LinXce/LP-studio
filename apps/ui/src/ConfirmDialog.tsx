import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Confirmation } from '../../../packages/contracts';
import { bridge } from './bridge';
type Request = Confirmation & { finish: (accepted: boolean) => void };
export function useConfirmation() {
  const [queue, setQueue] = useState<Request[]>([]);
  const localPending = useRef(new Set<(accepted: boolean) => void>());
  const ask = useCallback((title: string, detail: string) => new Promise<boolean>(resolve => {
    const finish = (accepted: boolean) => { localPending.current.delete(finish); resolve(accepted); };
    localPending.current.add(finish);
    setQueue(q => [...q, { id: crypto.randomUUID(), title, detail, finish }]);
  }), []);
  useEffect(() => {
    const stop = bridge.onConfirm(request => setQueue(q => [...q, { ...request, finish: accepted => { void bridge.answerConfirm(request.id, accepted); } }]));
    return () => { stop(); for (const finish of localPending.current) finish(false); };
  }, []);
  const answer = (accepted: boolean) => { const request = queue[0]; if (!request) return; setQueue(q => q.slice(1)); request.finish(accepted); };
  return { ask, dialog: queue[0] ? <ConfirmDialog key={queue[0].id} request={queue[0]} answer={answer}/> : null };
}
function ConfirmDialog({ request, answer }: { request: Confirmation; answer: (accepted: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="confirmation-dialog" aria-labelledby="confirmation-title" aria-describedby="confirmation-detail" onCancel={e => { e.preventDefault(); answer(false); }} onKeyDown={e => e.stopPropagation()}>
    <div className="confirmation-heading"><AlertTriangle size={23}/><h2 id="confirmation-title">{request.title}</h2></div>
    <p id="confirmation-detail">{request.detail}</p>
    <div className="confirmation-actions"><button autoFocus className="secondary" onClick={() => answer(false)}>取消</button><button className="primary" onClick={() => answer(true)}>确认</button></div>
  </dialog>;
}
