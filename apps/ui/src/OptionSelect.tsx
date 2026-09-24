import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
export type SelectOption = { value: string; label: string; hint?: string };
type Props = {
  label: string; placeholder?: string; title?: string; icon?: ReactNode; value: string; options: SelectOption[];
  disabled?: boolean; empty?: string; up?: boolean; triggerClass?: string; onSelect: (value: string) => void; footer?: ReactNode;
};
// Shared popup picker: one look for every selection in the chrome, without the model search box.
export function OptionSelect({ label, placeholder, title, icon, value, options, disabled, empty, up, triggerClass, onSelect, footer }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const current = options.find(option => option.value === value);
  const text = current?.label ?? placeholder ?? '';
  useEffect(() => {
    if (!open) return;
    // A themed confirmation is modal: its backdrop click must not dismiss the picker that opened it.
    const onPointer = (event: PointerEvent) => { if ((event.target as Element | null)?.closest?.('dialog')) return; if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => { setActive(Math.max(0, options.findIndex(option => option.value === value))); }, [open, value, options.length]);
  useEffect(() => { scroll.current?.querySelector<HTMLElement>(`[data-option="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  function key(event: React.KeyboardEvent) {
    if (!open) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(options.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); const option = options[active]; if (option) choose(option.value); }
  }
  function choose(next: string) {
    setOpen(false);
    onSelect(next);
  }
  return <div className={`picker ${open ? 'open' : ''}`} ref={root}>
    <button type="button" className={`picker-trigger ${triggerClass ?? ''}`} aria-haspopup="listbox" aria-expanded={open} aria-label={text ? `${label} ${text}` : label} title={title ?? label} disabled={disabled} onClick={() => setOpen(value => !value)} onKeyDown={key}>
      {icon}<span>{text || placeholder || '—'}</span><ChevronDown size={14}/>
    </button>
    {open && <div className={`picker-panel ${up ? 'up' : ''}`}>
      {options.length > 0
        ? <div className="picker-scroll" role="listbox" aria-label={label} ref={scroll}>{options.map((option, index) => <button type="button" key={option.value} role="option" data-option={index} aria-label={option.label} aria-selected={option.value === value} className={`picker-option ${option.value === value ? 'selected' : ''} ${index === active ? 'active' : ''}`} onPointerEnter={() => setActive(index)} onClick={() => choose(option.value)}><span>{option.label}</span>{option.hint && <small aria-hidden="true">{option.hint}</small>}{option.value === value && <Check size={14}/>}</button>)}</div>
        : <p className="picker-empty">{empty ?? '没有可选项'}</p>}
      {footer}
    </div>}
  </div>;
}
