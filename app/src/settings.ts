import { uid } from './util';

export interface Settings {
  serverUrl: string; // p.ej. http://192.168.1.50:8787 — vacío = solo local
  token: string;
  clientId: string;
  penOnly: boolean; // con lápiz: el dedo solo mueve/zoom
  wheel: 'zoom' | 'pan';
  penAutoDetected: boolean;
  customColors: string[];
  snap: boolean;
  autoShape: boolean;
  minimap: boolean;
  userName: string;
}

const KEY = 'canvaspp.settings';

function load(): Settings {
  let s: Partial<Settings> = {};
  try {
    s = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {}
  return {
    serverUrl: s.serverUrl ?? '',
    token: s.token ?? '',
    clientId: s.clientId || uid(10),
    penOnly: s.penOnly ?? false,
    wheel: s.wheel ?? 'zoom',
    penAutoDetected: s.penAutoDetected ?? false,
    customColors: s.customColors ?? [],
    snap: s.snap ?? false,
    autoShape: s.autoShape ?? false,
    minimap: s.minimap ?? true,
    userName: s.userName ?? '',
  };
}

export const settings: Settings = load();
saveSettings();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}

export function serverBase(): string {
  return settings.serverUrl.trim().replace(/\/+$/, '');
}

export function hasServer() {
  return !!serverBase();
}

export function wsUrl(projectId: string, name: string, share?: string) {
  const base = serverBase().replace(/^http/, 'ws');
  const q = share
    ? new URLSearchParams({ project: projectId, share })
    : new URLSearchParams({ project: projectId, token: settings.token, client: settings.clientId, name });
  return `${base}/ws?${q}`;
}

/** Si la app se sirve desde el propio NAS (http://nas:8787), se autoconfigura. */
export async function autodetectServer() {
  if (settings.serverUrl) return;
  if (!/^https?:$/.test(location.protocol)) return;
  if (location.hostname === 'localhost' && location.port !== '8787') return; // Capacitor / vite dev
  try {
    const r = await fetch(`${location.origin}/api/health`, { cache: 'no-store' });
    const j = await r.json();
    if (j && j.ok) {
      settings.serverUrl = location.origin;
      saveSettings();
    }
  } catch {}
}
