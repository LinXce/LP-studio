import { Check, FolderOpen, Palette } from 'lucide-react';
import { themes, type ThemeId } from './theme';

type Props = { theme: ThemeId; setTheme: (theme: ThemeId) => void; dataDir?: string; hasProject: boolean; relocate: () => Promise<void> };
export function Settings({ theme, setTheme, dataDir, hasProject, relocate }: Props) {
  return <section className="workspace-page settings-page">
    <header className="page-header"><div><small>WORKSPACE PREFERENCES</small><h2>工作台设置</h2><p>调整外观，管理本地工作空间。</p></div></header>
    <div className="page-body">
      <section className="settings-section"><h3><Palette size={16}/>外观主题</h3><p className="hint">立即生效，自动保存在当前设备；代码预览同步切换配色。</p>
        <div className="theme-grid" role="group" aria-label="外观主题">{themes.map(item => <button key={item.id} className={`theme-card ${theme === item.id ? 'selected' : ''}`} aria-pressed={theme === item.id} aria-label={`${item.name}主题`} onClick={() => setTheme(item.id)}>
          <span className={`theme-swatch swatch-${item.id}`} aria-hidden="true"><i className="swatch-rail"/><i className="swatch-project"/><i className="swatch-terminal"><b/><b/><b/><em/></i><i className="swatch-preview"/></span>
          <span className="theme-name">{item.name}{theme === item.id && <Check size={15}/>}</span><small>{item.description}</small>
        </button>)}</div>
      </section>
      <section className="settings-section"><h3>本地数据</h3><code className="data-path">{dataDir ?? '读取数据目录…'}</code><p className="hint">在程序目录放置 portable.flag 可启用便携数据目录。复制整个应用目录与 .lp-data 即可迁移；跨电脑密钥需重新填写，本地 CLI 需在目标电脑安装和登录。</p></section>
      <section className="settings-section"><h3>迁移后重新定位项目</h3><button className="secondary" disabled={!hasProject} onClick={() => void relocate()}><FolderOpen size={14}/>选择当前项目的新目录</button></section>
      <section className="settings-section"><h3>快捷键</h3><div className="shortcut-list">{[['Enter', '运行对话或命令'], ['Shift + Enter', '输入换行'], ['Ctrl + B', '折叠 / 展开项目栏'], ['Ctrl + J', '折叠 / 展开预览栏'], ['Ctrl + L', '返回输入框']].map(([key, label]) => <div key={key}><span>{label}</span><kbd>{key}</kbd></div>)}</div></section>
      <section className="settings-section"><h3>执行边界</h3><p className="hint">文件访问限制在项目目录，排除常见凭证文件与符号链接。CLI 的只读参数不是系统沙箱；终端命令拥有当前用户权限。对话和文件快照保存在本地，未做数据库加密。</p></section>
    </div>
  </section>;
}
