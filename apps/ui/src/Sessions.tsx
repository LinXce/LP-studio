import { useState } from 'react';
import { ChevronRight, MessageSquare, Plus, Search, Trash2 } from 'lucide-react';
import type { ProviderView, Session } from '../../../packages/contracts';

type Props = { remove: (id: string) => void; sessions: Session[]; providers: ProviderView[]; activeId: string; runningIds: string[]; projectName?: string; create: () => void; select: (id: string) => void };
export function Sessions({ sessions, providers, activeId, runningIds, projectName, create, select, remove }: Props) {
  const [query, setQuery] = useState('');
  const visible = sessions.filter(s => s.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return <section className="workspace-page sessions-page">
    <header className="page-header"><div><small>SESSION HISTORY</small><h2>会话</h2><p>{projectName ?? '尚未打开项目'} · {sessions.length} 个会话</p></div><button className="primary" disabled={!projectName} onClick={create}><Plus size={15}/>新建会话</button></header>
    <div className="page-body"><label className="session-search"><Search size={16}/><input aria-label="搜索会话" placeholder="搜索当前项目的会话…" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <div className="session-cards">{visible.map(s => <div key={s.id} className="session-card-row"><button className={`session-card ${activeId === s.id ? 'selected' : ''}`} onClick={() => select(s.id)}><MessageSquare size={18}/><span><strong>{s.title}</strong><small>{providers.find(p => p.id === s.providerId)?.name ?? '未配置模型'} · {s.messages.length} 条消息</small><small>{new Date(s.updatedAt).toLocaleString()}</small></span>{runningIds.includes(s.id) && <span className="session-running"><i className="running-dot"/>运行中</span>}<ChevronRight size={16}/></button><button className="session-card-delete icon" title={`删除会话：${s.title}`} aria-label={`删除会话：${s.title}`} disabled={runningIds.includes(s.id)} onClick={() => remove(s.id)}><Trash2 size={16}/></button></div>)}</div>
      {!visible.length && <div className="page-empty"><MessageSquare size={32}/><h3>{query ? '没有匹配的会话' : '从一次对话开始'}</h3><p>{query ? '尝试其他搜索词。' : '打开项目并新建会话，历史记录会保存在本机。'}</p></div>}
    </div>
  </section>;
}
