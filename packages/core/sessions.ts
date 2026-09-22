import type { Store } from './storage';
export function configureSession(store: Store, id: string, providerId: string, model: string, busy: boolean) {
  const session = store.session(id);
  if (busy) throw Error('请先等待当前操作完成');
  if (session.startedAt || session.messages.length) throw Error('会话已开始，请新建会话切换 CLI 或模型');
  store.provider(providerId);
  session.providerId = providerId; session.model = model.trim(); session.updatedAt = new Date().toISOString();
  store.save(); return session;
}
export function sessionConfig(store: Store, id: string) {
  const session = store.session(id); const provider = store.provider(session.providerId);
  return { ...provider, model: session.model ?? provider.model };
}
