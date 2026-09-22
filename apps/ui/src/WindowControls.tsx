import { useEffect, useState } from 'react';
import { Minus, Square, Copy, X, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { bridge } from './bridge';
export function WindowControls({ rightOpen, togglePreview, error }: { rightOpen: boolean; togglePreview: () => void; error: (e: unknown) => void }) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => { void bridge.windowMaximized().then(setMaximized).catch(error); return bridge.onWindowState(setMaximized); }, [error]);
  return <div className="window-controls">
    <button title={`${rightOpen ? '折叠预览' : '展开预览'} · Ctrl+J`} aria-label={rightOpen ? '折叠预览' : '展开预览'} aria-controls="preview-content" aria-expanded={rightOpen} onClick={togglePreview}>{rightOpen ? <PanelRightClose size={17}/> : <PanelRightOpen size={17}/>}</button>
    <span className="window-control-divider"/>
    <button title="最小化" aria-label="最小化" onClick={() => void bridge.windowControl('minimize').catch(error)}><Minus size={16}/></button>
    <button title={maximized ? '还原窗口' : '最大化'} aria-label={maximized ? '还原窗口' : '最大化'} onClick={() => void bridge.windowControl('maximize').catch(error)}>{maximized ? <Copy size={14}/> : <Square size={14}/>}</button>
    <button className="window-close" title="关闭窗口" aria-label="关闭窗口" onClick={() => void bridge.windowControl('close').catch(error)}><X size={17}/></button>

  </div>;
}
