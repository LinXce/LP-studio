import type { StudioBridge } from '../../../packages/contracts';
declare global { interface Window { studio: StudioBridge } }
export const bridge = window.studio;
