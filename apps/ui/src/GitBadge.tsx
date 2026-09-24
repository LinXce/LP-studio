import { FolderGit2, GitBranch } from 'lucide-react';
import type { GitStatus } from '../../../packages/contracts';
import { OptionSelect } from './OptionSelect';
type Props = { status?: GitStatus; loading: boolean; disabled: boolean; onSwitch: (branch: string) => Promise<void> | void };
export function GitBadge({ status, loading, disabled, onSwitch }: Props) {
  if (loading) return <div className="git-badge muted"><FolderGit2 size={14}/><span>读取 Git…</span></div>;
  if (!status?.repository) return <div className="git-badge muted" title="当前项目不是 Git 仓库"><FolderGit2 size={14}/><span>无 Git 仓库</span></div>;
  return <div className="git-badge">
    <span className="git-repo" title={status.repository}><FolderGit2 size={14}/><span>{status.repository}</span></span>
    <OptionSelect label="切换分支" title="切换 Git 分支" placeholder="游离 HEAD" icon={<GitBranch size={14}/>} up disabled={disabled} value={status.branch ?? ''} options={status.branches.map(branch => ({ value: branch, label: branch }))} onSelect={branch => void onSwitch(branch)} triggerClass="git-branch" empty="没有本地分支"/>
  </div>;
}
