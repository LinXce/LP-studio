import { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type { ProviderView } from '../../../packages/contracts';
import { bridge } from './bridge';
import { OptionSelect } from './OptionSelect';
type Props = { providers: ProviderView[]; providerId: string; model: string; disabled: boolean; onChange: (providerId: string, model: string) => Promise<void>; error: (e: unknown) => void };
export function SessionPicker({ providers, providerId, model, disabled, onChange, error }: Props) {
  const provider = providers.find(p => p.id === providerId);
  const [catalog, setCatalog] = useState<{ id: string; models: string[] }>({ id: '', models: [] });
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState(false);
  const [customId, setCustomId] = useState('');
  const serial = useRef(0);
  const configured = provider?.models?.join(',') ?? '';
  useEffect(() => {
    const request = ++serial.current; setLoading(false); setCustom(false);
    if (provider) void bridge.providerModels(provider.id).then(result => { if (request === serial.current) setCatalog({ id: provider.id, models: result.models }); }).catch(error);
    return () => { serial.current++; };
  }, [provider?.id, provider?.model, configured, error]);
  const cli = Boolean(provider?.kind.endsWith('-cli'));
  const models = [...new Set([model, provider?.model, ...(provider?.models ?? []), ...(catalog.id === providerId ? catalog.models : [])].filter((m): m is string => Boolean(m)))];
  const options = [...(cli ? [{ value: '', label: 'CLI 默认模型' }] : []), ...models.map(m => ({ value: m, label: m }))];
  async function choose(id: string, next: string) {
    try { await onChange(id, next); } catch(e) { error(e); }
  }
  async function discover() {
    setLoading(true);
    try { const result = await bridge.providerModels(providerId, true); setCatalog({ id: providerId, models: result.models }); }
    catch(e) { error(e); } finally { setLoading(false); }
  }
  const footer = <>
    <div className="picker-actions">
      <button type="button" className="text-button" onClick={() => { setCustom(true); setCustomId(model); }}><Plus size={13}/>填写模型 ID</button>
      {provider?.kind === 'command-cli' && <button type="button" className="text-button" disabled={loading} onClick={() => void discover()}><RefreshCw size={13} className={loading ? 'spin' : ''}/>读取本机模型目录</button>}
    </div>
    {custom && <div className="custom-model"><input aria-label="自定义模型 ID" maxLength={150} autoFocus placeholder="此连接支持的模型 ID" value={customId} onChange={e => setCustomId(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (customId.trim()) { void choose(providerId, customId.trim()); setCustom(false); } } }}/><button type="button" className="text-button" disabled={!customId.trim()} onClick={() => { void choose(providerId, customId.trim()); setCustom(false); }}>使用</button><button type="button" className="text-button" onClick={() => setCustom(false)}>取消</button></div>}
  </>;
  return <div className="session-picker">
    <OptionSelect label="会话 CLI" title="选择 CLI 或 API 连接" placeholder="选择连接" disabled={disabled} up value={providerId} options={providers.map(p => ({ value: p.id, label: p.name, hint: p.kind }))} onSelect={id => void choose(id, providers.find(p => p.id === id)?.model ?? '')} triggerClass="connection-picker"/>
    <OptionSelect label="会话模型" title="选择此连接支持的模型" placeholder={cli ? 'CLI 默认模型' : '选择模型'} disabled={disabled || !provider} empty="此连接还没有可用模型" up value={model} options={options} onSelect={next => void choose(providerId, next)} triggerClass="model-pill" footer={footer}/>
  </div>;
}
