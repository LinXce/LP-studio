import { useEffect, useRef, useState } from 'react';
import { Cpu, RefreshCw } from 'lucide-react';
import type { ProviderView } from '../../../packages/contracts';
import { bridge } from './bridge';
type Props = { providers: ProviderView[]; providerId: string; model: string; disabled: boolean; onChange: (id: string, model: string) => Promise<void>; onEditing: (editing: boolean) => void; error: (e: unknown) => void };
export function SessionPicker({ providers, providerId, model, disabled, onChange, onEditing, error }: Props) {
  const provider = providers.find(p => p.id === providerId);
  const [catalog, setCatalog] = useState<{ id: string; models: string[]; note: string }>({ id: '', models: [], note: '' });
  const [loading, setLoading] = useState(false); const serial = useRef(0);
  const [custom, setCustom] = useState(false); const [customId, setCustomId] = useState('');
  useEffect(() => {
    const request = ++serial.current; setLoading(false); setCustom(false);
    if (provider) void bridge.providerModels(provider.id).then(result => { if (request === serial.current) setCatalog({ id: provider.id, ...result }); }).catch(error);
    return () => { serial.current++; };
  }, [provider?.id, provider?.model, provider?.models, error]);
  useEffect(() => { onEditing(custom); return () => onEditing(false); }, [custom, onEditing]);
  const models = [...new Set([model, provider?.model, ...(provider?.models ?? []), ...(catalog.id === providerId ? catalog.models : [])].filter((m): m is string => Boolean(m)))];
  async function discover() {
    const request = ++serial.current; setLoading(true);
    try { const result = await bridge.providerModels(providerId, true); if (request === serial.current) setCatalog({ id: providerId, ...result }); }
    catch(e) { if (request === serial.current) error(e); } finally { if (request === serial.current) setLoading(false); }
  }
  return <div className="session-picker">
    <div className="connection-picker model-select"><Cpu size={14}/><select aria-label="会话 CLI" title="选择 CLI 或 API 连接" value={providerId} disabled={disabled} onChange={e => { const p = providers.find(p => p.id === e.target.value); if (p) void onChange(p.id, p.model); }}>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
    {provider?.kind === 'command-cli' && <button className="icon catalog-refresh" title="读取 CLI 支持的模型" aria-label="读取 CLI 支持的模型" disabled={disabled || loading} onClick={() => void discover()}><RefreshCw size={14} className={loading ? 'spin' : ''}/></button>}
    <div className="actual-model model-select"><select aria-label="会话模型" title={catalog.id === providerId ? catalog.note : '选择此连接支持的模型'} value={custom ? '__custom__' : model} disabled={disabled || !provider} onChange={e => { if (e.target.value === '__custom__') { setCustom(true); setCustomId(model); } else { setCustom(false); void onChange(providerId, e.target.value); } }}>
      <option value="" disabled={provider?.kind.endsWith('-api')}>{provider?.kind.endsWith('-cli') ? 'CLI 默认模型' : '请选择模型'}</option>
      {models.map(id => <option key={id} value={id}>{id}</option>)}<option value="__custom__">填写模型 ID…</option>
    </select></div>
    {custom && <div className="custom-model"><input aria-label="自定义模型 ID" maxLength={150} placeholder="此 CLI 支持的模型 ID" value={customId} disabled={disabled} onChange={e => setCustomId(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (customId.trim()) { void onChange(providerId, customId.trim()); setCustom(false); } } }}/><button className="text-button" disabled={disabled || !customId.trim()} onClick={() => { void onChange(providerId, customId.trim()); setCustom(false); }}>使用</button><button className="text-button" onClick={() => setCustom(false)}>取消</button></div>}
  </div>;
}
