// Elementos adicionales: conectores, notas de voz, vídeos, fórmulas, código, gráficos y comentarios.
import { computeTable } from '../sheet/format';
import { parseInput } from '../sheet/formula';
import type {
  AudioItem,
  ChartItem,
  CodeItem,
  CommentItem,
  ConnectorEnd,
  ConnectorItem,
  Item,
  MathItem,
  Rect,
  VideoItem,
} from '../types';
import { assetImage } from '../assets';
import { getRedrawHook, wrapText } from './render';

const FONT = (w: number, px: number) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const MONO = (px: number) => `${px}px ui-monospace, "Cascadia Code", Consolas, "Roboto Mono", monospace`;

// ------------------------------------------------------------------ resolución de elementos
type Resolver = (id: string) => Item | undefined;
let resolver: Resolver = () => undefined;
/** La pizarra registra cómo encontrar elementos por id (conectores, gráficos). */
export function getItemResolver() {
  return resolver;
}

export function setItemResolver(fn: Resolver) {
  resolver = fn;
}
export function resolveItem(id: string) {
  return resolver(id);
}

let boundsFn: (it: Item) => Rect = () => ({ x: 0, y: 0, w: 0, h: 0 });
export function setBoundsFn(fn: (it: Item) => Rect) {
  boundsFn = fn;
}

// ------------------------------------------------------------------ conectores
/** Punto del borde de r en la dirección de (tx, ty) desde su centro. */
function edgePoint(r: Rect, tx: number, ty: number, pad: number): [number, number] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const hw = r.w / 2 + pad;
  const hh = r.h / 2 + pad;
  const k = Math.min(Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity);
  return [cx + dx * k, cy + dy * k];
}

function endRect(e: ConnectorEnd, offset?: (id: string) => [number, number] | undefined): Rect | null {
  if (!e.id) return null;
  const it = resolver(e.id);
  if (!it || it.deleted) return null;
  const r = boundsFn(it);
  const o = offset?.(e.id);
  return o ? { ...r, x: r.x + o[0], y: r.y + o[1] } : r;
}

/** Extremos reales del conector (siguiendo a los elementos a los que está pegado). */
export function connectorPoints(c: ConnectorItem, offset?: (id: string) => [number, number] | undefined): [number, number, number, number] {
  const ra = endRect(c.from, offset);
  const rb = endRect(c.to, offset);
  const ca: [number, number] = ra ? [ra.x + ra.w / 2, ra.y + ra.h / 2] : [c.from.x, c.from.y];
  const cb: [number, number] = rb ? [rb.x + rb.w / 2, rb.y + rb.h / 2] : [c.to.x, c.to.y];
  const pad = c.sw * 2;
  const a = ra ? edgePoint(ra, cb[0], cb[1], pad) : ca;
  const b = rb ? edgePoint(rb, ca[0], ca[1], pad) : cb;
  return [a[0], a[1], b[0], b[1]];
}

function curveCtrl(x1: number, y1: number, x2: number, y2: number): [number, number] {
  // curva suave: punto de control desplazado en perpendicular
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return [mx - (y2 - y1) * 0.25, my + (x2 - x1) * 0.25];
}

export function connectorBounds(c: ConnectorItem): Rect {
  const [x1, y1, x2, y2] = connectorPoints(c);
  let xs = [x1, x2];
  let ys = [y1, y2];
  if (c.curve) {
    const [qx, qy] = curveCtrl(x1, y1, x2, y2);
    xs = [...xs, qx];
    ys = [...ys, qy];
  }
  const p = c.sw * 4 + 4;
  const x = Math.min(...xs) - p;
  const y = Math.min(...ys) - p;
  return { x, y, w: Math.max(...xs) - x + p, h: Math.max(...ys) - y + p };
}

export function connectorHit(c: ConnectorItem, x: number, y: number, tol: number) {
  const [x1, y1, x2, y2] = connectorPoints(c);
  const segs: [number, number][] = [];
  if (c.curve) {
    const [qx, qy] = curveCtrl(x1, y1, x2, y2);
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      segs.push([(1 - t) ** 2 * x1 + 2 * (1 - t) * t * qx + t * t * x2, (1 - t) ** 2 * y1 + 2 * (1 - t) * t * qy + t * t * y2]);
    }
  } else segs.push([x1, y1], [x2, y2]);
  for (let i = 0; i < segs.length - 1; i++) {
    const [ax, ay] = segs[i];
    const [bx, by] = segs[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= tol + c.sw) return true;
  }
  return false;
}

function head(ctx: CanvasRenderingContext2D, fx: number, fy: number, x: number, y: number, size: number) {
  const a = Math.atan2(y - fy, x - fx);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * Math.cos(a - 0.42), y - size * Math.sin(a - 0.42));
  ctx.lineTo(x - size * Math.cos(a + 0.42), y - size * Math.sin(a + 0.42));
  ctx.closePath();
  ctx.fill();
}

export function drawConnector(ctx: CanvasRenderingContext2D, c: ConnectorItem, zoom: number, offset?: (id: string) => [number, number] | undefined) {
  const [x1, y1, x2, y2] = connectorPoints(c, offset);
  const size = c.sw * 3 + 7 / zoom;
  ctx.save();
  ctx.strokeStyle = c.stroke;
  ctx.fillStyle = c.stroke;
  ctx.lineWidth = c.sw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  let q: [number, number] | null = null;
  if (c.curve) {
    q = curveCtrl(x1, y1, x2, y2);
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(q[0], q[1], x2, y2);
  } else {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  const fromEnd = q ?? [x1, y1];
  const fromStart = q ?? [x2, y2];
  if (c.arrow !== 'none') head(ctx, fromEnd[0], fromEnd[1], x2, y2, size);
  if (c.arrow === 'both') head(ctx, fromStart[0], fromStart[1], x1, y1, size);
  if (c.label) {
    const t = 0.5;
    const mx = q ? (1 - t) ** 2 * x1 + 2 * (1 - t) * t * q[0] + t * t * x2 : (x1 + x2) / 2;
    const my = q ? (1 - t) ** 2 * y1 + 2 * (1 - t) * t * q[1] + t * t * y2 : (y1 + y2) / 2;
    const fs = Math.max(10 / zoom, c.sw * 5);
    ctx.font = FONT(550, fs);
    const w = ctx.measureText(c.label).width;
    ctx.fillStyle = '#faf9f6';
    ctx.fillRect(mx - w / 2 - fs * 0.3, my - fs * 0.7, w + fs * 0.6, fs * 1.4);
    ctx.fillStyle = c.stroke;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.label, mx, my);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ tarjetas genéricas
function card(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, zoom: number, fill = '#fff') {
  ctx.save();
  if (zoom > 0.25) {
    ctx.shadowColor = 'rgba(0,0,0,0.16)';
    ctx.shadowBlur = 8 * zoom;
    ctx.shadowOffsetY = 2 * zoom;
  }
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ nota de voz
export const AUDIO_BASE_W = 260;
export const AUDIO_BASE_H = 64;
let playing: { id: string; el: HTMLAudioElement } | null = null;
export function setPlaying(p: typeof playing) {
  playing = p;
}
export function getPlaying() {
  return playing;
}

export function fmtTime(s: number) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function drawAudio(ctx: CanvasRenderingContext2D, a: AudioItem, zoom: number) {
  const s = a.w / AUDIO_BASE_W;
  card(ctx, a.x, a.y, a.w, a.h, 32 * s, zoom);
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.scale(s, s);
  const bh = a.h / s;
  const isPlaying = playing?.id === a.id && !playing.el.paused;
  const prog = playing?.id === a.id && a.duration ? playing.el.currentTime / a.duration : 0;
  ctx.fillStyle = '#8e4ec6';
  ctx.beginPath();
  ctx.arc(32, bh / 2, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  if (isPlaying) {
    ctx.fillRect(25, bh / 2 - 8, 5, 16);
    ctx.fillRect(34, bh / 2 - 8, 5, 16);
  } else {
    ctx.beginPath();
    ctx.moveTo(27, bh / 2 - 10);
    ctx.lineTo(42, bh / 2);
    ctx.lineTo(27, bh / 2 + 10);
    ctx.closePath();
    ctx.fill();
  }
  // onda decorativa (determinista a partir del id)
  let seed = 0;
  for (const ch of a.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const bars = 26;
  for (let i = 0; i < bars; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const hgt = 6 + (seed % 22);
    ctx.fillStyle = i / bars < prog ? '#8e4ec6' : '#d9cde8';
    ctx.fillRect(66 + i * 6.2, bh / 2 - hgt / 2 - 6, 3.4, hgt);
  }
  ctx.font = FONT(500, 11);
  ctx.fillStyle = '#6b6f76';
  ctx.textBaseline = 'alphabetic';
  const label = (a.title ? wrapText(ctx, a.title, 120)[0] + ' · ' : '') + fmtTime(isPlaying ? playing!.el.currentTime : a.duration);
  ctx.fillText(label, 66, bh - 10);
  ctx.restore();
}

/** ¿Se ha tocado el botón de reproducir? */
export function audioButtonAt(a: AudioItem, x: number, y: number) {
  const s = a.w / AUDIO_BASE_W;
  return Math.hypot(x - (a.x + 32 * s), y - (a.y + a.h / 2)) <= 26 * s;
}

// ------------------------------------------------------------------ vídeo
const ytThumbs = new Map<string, HTMLImageElement>();
function ytThumb(id: string): HTMLImageElement | null {
  let img = ytThumbs.get(id);
  if (!img) {
    img = new Image();
    img.crossOrigin = 'anonymous'; // sin esto la miniatura "contaminaría" el canvas y no se podría exportar
    img.onload = getRedrawHook();
    img.onerror = () => ytThumbs.set(id, new Image());
    img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    ytThumbs.set(id, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

function drawVideo(ctx: CanvasRenderingContext2D, v: VideoItem, zoom: number) {
  card(ctx, v.x, v.y, v.w, v.h, Math.min(v.w, v.h) * 0.05, zoom, '#15171a');
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(v.x, v.y, v.w, v.h, Math.min(v.w, v.h) * 0.05);
  ctx.clip();
  const img = v.source === 'youtube' && v.ytId ? ytThumb(v.ytId) : v.thumb ? assetImage(v.thumb, getRedrawHook()) : null;
  if (img) {
    const k = Math.max(v.w / img.naturalWidth, v.h / img.naturalHeight);
    const w = img.naturalWidth * k;
    const hh = img.naturalHeight * k;
    ctx.drawImage(img, v.x + (v.w - w) / 2, v.y + (v.h - hh) / 2, w, hh);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(v.x, v.y, v.w, v.h);
  }
  const r = Math.min(v.w, v.h) * 0.14;
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  ctx.fillStyle = v.source === 'youtube' ? '#ff0033' : 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.roundRect(cx - r * 1.3, cy - r * 0.9, r * 2.6, r * 1.8, r * 0.5);
  ctx.fill();
  ctx.fillStyle = v.source === 'youtube' ? '#fff' : '#15171a';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.35, cy - r * 0.5);
  ctx.lineTo(cx + r * 0.55, cy);
  ctx.lineTo(cx - r * 0.35, cy + r * 0.5);
  ctx.closePath();
  ctx.fill();
  if (v.title && zoom * v.w > 120) {
    const fs = Math.max(8, v.w * 0.045);
    ctx.font = FONT(600, fs);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;
    ctx.fillText(wrapText(ctx, v.title, v.w - fs * 1.6)[0] ?? '', v.x + fs * 0.8, v.y + fs * 0.7);
  }
  ctx.restore();
}

export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// ------------------------------------------------------------------ fórmulas
const mathImgs = new WeakMap<MathItem, HTMLImageElement>();
function drawMath(ctx: CanvasRenderingContext2D, m: MathItem, zoom: number) {
  let img = mathImgs.get(m);
  if (!img) {
    img = new Image();
    img.onload = getRedrawHook();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(m.svg.replace(/currentColor/g, m.color));
    mathImgs.set(m, img);
  }
  if (img.complete && img.naturalWidth) ctx.drawImage(img, m.x, m.y, m.w, m.h);
  else {
    ctx.strokeStyle = '#d0cdc5';
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(m.x, m.y, m.w, m.h);
  }
}

// ------------------------------------------------------------------ código
export const CODE_BASE_W = 420;
const CODE_FS = 13;
const CODE_LH = 19;
const CODE_PAD = 14;
const CODE_HEAD = 26;

const KW: Record<string, string> = {
  js: 'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|this|null|undefined|true|false|yield|static|get|set',
  py: 'def|return|if|elif|else|for|while|in|not|and|or|is|None|True|False|import|from|as|class|try|except|finally|raise|with|lambda|yield|pass|break|continue|global|nonlocal|async|await|self',
  java: 'public|private|protected|static|final|void|int|long|double|float|boolean|char|byte|short|class|interface|extends|implements|new|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|throws|import|package|null|true|false|this|super',
  c: 'int|long|short|char|float|double|void|unsigned|signed|const|static|struct|union|enum|typedef|return|if|else|for|while|do|switch|case|break|continue|sizeof|include|define|NULL|true|false|auto|class|public|private|namespace|using|std|new|delete|template',
  sql: 'select|from|where|and|or|not|insert|into|values|update|set|delete|create|table|drop|alter|join|left|right|inner|outer|on|group|by|order|having|limit|as|distinct|null|is|in|like|primary|key|index',
  bash: 'if|then|else|fi|for|in|do|done|while|case|esac|function|return|export|local|echo|cd|ls|sudo|exit',
  css: 'color|background|margin|padding|border|display|flex|grid|position|width|height|font|none|auto|important',
};
KW.ts = KW.js + '|interface|type|enum|implements|private|public|protected|readonly|as|keyof|any|unknown|never|string|number|boolean';
KW.cpp = KW.c;
KW.kotlin = KW.java + '|fun|val|var|when|object|data|companion';

export const CODE_LANGS: [string, string][] = [
  ['js', 'JavaScript'],
  ['ts', 'TypeScript'],
  ['py', 'Python'],
  ['java', 'Java'],
  ['kotlin', 'Kotlin'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['sql', 'SQL'],
  ['bash', 'Bash'],
  ['css', 'CSS'],
  ['html', 'HTML'],
  ['json', 'JSON'],
  ['text', 'Texto'],
];

type Tok = { t: string; c: string };
const TOKCOL = { kw: '#c678dd', str: '#98c379', num: '#d19a66', com: '#7f848e', fn: '#61afef', tag: '#e06c75', txt: '#dcdfe4' };

export function highlightLine(line: string, lang: string): Tok[] {
  const kw = KW[lang];
  const comment = lang === 'py' || lang === 'bash' ? '#.*' : lang === 'sql' ? '--.*' : lang === 'html' ? '<!--.*?-->' : '\\/\\/.*|\\/\\*.*?\\*\\/';
  const parts = [
    `(${comment})`,
    `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`[^\`]*\`)`,
    `(\\b\\d+(?:\\.\\d+)?\\b)`,
    lang === 'html' ? `(<\\/?[\\w-]+|\\/?>)` : `(\\b[A-Za-z_]\\w*(?=\\())`,
    kw ? `(\\b(?:${kw})\\b)` : `($^)`,
  ];
  const re = new RegExp(parts.join('|'), lang === 'sql' ? 'gi' : 'g');
  const out: Tok[] = [];
  let last = 0;
  if (lang === 'text') return [{ t: line, c: TOKCOL.txt }];
  for (const m of line.matchAll(re)) {
    if (m.index! > last) out.push({ t: line.slice(last, m.index), c: TOKCOL.txt });
    const c = m[1] ? TOKCOL.com : m[2] ? TOKCOL.str : m[3] ? TOKCOL.num : m[4] ? (lang === 'html' ? TOKCOL.tag : TOKCOL.fn) : TOKCOL.kw;
    out.push({ t: m[0], c });
    last = m.index! + m[0].length;
    if (!m[0].length) break;
  }
  if (last < line.length) out.push({ t: line.slice(last), c: TOKCOL.txt });
  return out;
}

export function codeHeight(c: CodeItem) {
  const lines = Math.max(1, c.code.split('\n').length);
  return (CODE_HEAD + CODE_PAD * 2 + lines * CODE_LH) * (c.w / CODE_BASE_W);
}

function drawCode(ctx: CanvasRenderingContext2D, c: CodeItem, zoom: number) {
  const s = c.w / CODE_BASE_W;
  const h = codeHeight(c);
  card(ctx, c.x, c.y, c.w, h, 10 * s, zoom, '#1f2329');
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(c.x, c.y, c.w, h, 10 * s);
  ctx.clip();
  ctx.translate(c.x, c.y);
  ctx.scale(s, s);
  // barra de título
  ctx.fillStyle = '#2a2f37';
  ctx.fillRect(0, 0, CODE_BASE_W, CODE_HEAD);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(14 + i * 14, CODE_HEAD / 2, 4.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.font = FONT(500, 11);
  ctx.fillStyle = '#9aa1ab';
  ctx.textBaseline = 'middle';
  const lname = CODE_LANGS.find(([k]) => k === c.lang)?.[1] ?? c.lang;
  ctx.fillText(lname, CODE_BASE_W - 14 - ctx.measureText(lname).width, CODE_HEAD / 2);
  if (zoom * s > 0.25) {
    ctx.font = MONO(CODE_FS);
    ctx.textBaseline = 'top';
    const cw = ctx.measureText('M').width;
    c.code.split('\n').forEach((line, i) => {
      let x = CODE_PAD;
      const y = CODE_HEAD + CODE_PAD + i * CODE_LH + 2;
      for (const tok of highlightLine(line.replace(/\t/g, '  '), c.lang)) {
        ctx.fillStyle = tok.c;
        ctx.fillText(tok.t, x, y);
        x += tok.t.length * cw;
        if (x > CODE_BASE_W) break;
      }
    });
  }
  ctx.restore();
}

// ------------------------------------------------------------------ gráficos
export const CHART_COLORS = ['#0090ff', '#f76b15', '#30a46c', '#8e4ec6', '#e5484d', '#f5c400', '#12a594', '#d6409f'];

export function chartData(ch: ChartItem): { labels: string[]; series: { name: string; values: number[] }[] } {
  let data = ch.data;
  let vals: unknown[][] | null = null;
  if (ch.table) {
    const t = resolver(ch.table);
    if (t && !t.deleted && t.kind === 'table') {
      // valores ya calculados (las fórmulas cuentan)
      const c = computeTable(t);
      data = c.text;
      vals = c.values;
    }
  }
  if (!data.length) return { labels: [], series: [] };
  const header = data[0];
  const rowIdx = data.map((_, i) => i).filter((i) => i > 0 && data[i].some((c) => String(c ?? '').trim()));
  const labels = rowIdx.map((i) => data[i][0] ?? '');
  const series: { name: string; values: number[] }[] = [];
  const num = (i: number, ci: number) => {
    const v = vals?.[i]?.[ci];
    if (typeof v === 'number') return v;
    const p = parseInput(String(data[i][ci] ?? '')).v;
    return typeof p === 'number' ? p : NaN;
  };
  for (let ci = 1; ci < header.length; ci++) {
    const values = rowIdx.map((i) => num(i, ci));
    if (values.some((v) => !isNaN(v))) series.push({ name: header[ci] || `Serie ${ci}`, values: values.map((v) => (isNaN(v) ? 0 : v)) });
  }
  return { labels, series };
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function drawChart(ctx: CanvasRenderingContext2D, ch: ChartItem, zoom: number) {
  card(ctx, ch.x, ch.y, ch.w, ch.h, 10 * (ch.w / 400), zoom);
  const { labels, series } = chartData(ch);
  const s = ch.w / 400;
  ctx.save();
  ctx.translate(ch.x, ch.y);
  ctx.scale(s, s);
  const W = 400;
  const H = ch.h / s;
  ctx.textBaseline = 'middle';
  ctx.font = FONT(700, 14);
  ctx.fillStyle = '#1f2328';
  ctx.fillText(wrapText(ctx, ch.title || 'Gráfico', W - 30)[0] ?? '', 16, 20);
  if (!series.length) {
    ctx.font = FONT(400, 12);
    ctx.fillStyle = '#8a8e94';
    ctx.fillText('La tabla no tiene columnas numéricas', 16, H / 2);
    ctx.restore();
    return;
  }
  // leyenda
  ctx.font = FONT(500, 10);
  let lx = 16;
  const legendItems = ch.chart === 'pie' ? labels : series.map((x) => x.name);
  legendItems.slice(0, 8).forEach((name, i) => {
    ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
    ctx.fillRect(lx, 38, 9, 9);
    ctx.fillStyle = '#4a4f57';
    const t = name.slice(0, 18);
    ctx.fillText(t, lx + 13, 43);
    lx += 22 + ctx.measureText(t).width;
  });
  const top = 58;
  const bottom = H - 28;
  const left = 40;
  const right = W - 14;
  if (ch.chart === 'pie') {
    const vals = series[0].values.map((v) => Math.max(0, v));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const r = Math.min((right - left) / 2, (bottom - top) / 2 + 10);
    const cx = W / 2;
    const cy = (top + bottom + 20) / 2;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (v / total > 0.06) {
        const am = (a0 + a1) / 2;
        ctx.fillStyle = '#fff';
        ctx.font = FONT(650, 10);
        ctx.textAlign = 'center';
        ctx.fillText(Math.round((v / total) * 100) + '%', cx + Math.cos(am) * r * 0.62, cy + Math.sin(am) * r * 0.62);
        ctx.textAlign = 'start';
      }
      a0 = a1;
    });
    ctx.restore();
    return;
  }
  const all = series.flatMap((x) => x.values);
  const min = Math.min(0, ...all);
  const max = niceMax(Math.max(...all, 0));
  const y = (v: number) => bottom - ((v - min) / (max - min || 1)) * (bottom - top);
  // rejilla
  ctx.strokeStyle = '#eceae4';
  ctx.lineWidth = 1;
  ctx.font = FONT(400, 9);
  ctx.fillStyle = '#8a8e94';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    const yy = y(v);
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(right, yy);
    ctx.stroke();
    ctx.fillText(Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v * 100) / 100), left - 5, yy);
  }
  ctx.textAlign = 'center';
  const n = labels.length || 1;
  const slot = (right - left) / n;
  labels.forEach((l, i) => ctx.fillText(l.slice(0, 10), left + slot * (i + 0.5), bottom + 12));
  if (ch.chart === 'bar') {
    const bw = (slot * 0.7) / series.length;
    series.forEach((se, si) =>
      se.values.forEach((v, i) => {
        ctx.fillStyle = CHART_COLORS[si % CHART_COLORS.length];
        const x = left + slot * i + slot * 0.15 + bw * si;
        const y0 = y(Math.max(0, min));
        ctx.fillRect(x, Math.min(y(v), y0), bw - 1, Math.abs(y0 - y(v)));
      }),
    );
  } else {
    series.forEach((se, si) => {
      ctx.strokeStyle = CHART_COLORS[si % CHART_COLORS.length];
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      se.values.forEach((v, i) => {
        const x = left + slot * (i + 0.5);
        if (i) ctx.lineTo(x, y(v));
        else ctx.moveTo(x, y(v));
      });
      ctx.stroke();
      se.values.forEach((v, i) => {
        ctx.beginPath();
        ctx.arc(left + slot * (i + 0.5), y(v), 3, 0, Math.PI * 2);
        ctx.fill();
      });
    });
  }
  ctx.restore();
}

// ------------------------------------------------------------------ comentarios
export function commentRadius(zoom: number) {
  return 15 / zoom;
}

function drawComment(ctx: CanvasRenderingContext2D, c: CommentItem, zoom: number) {
  const r = commentRadius(zoom);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = c.resolved ? '#a3a6ab' : '#f76b15';
  ctx.beginPath();
  // burbuja con pico abajo a la izquierda
  ctx.moveTo(-r, r);
  ctx.lineTo(-r, 0);
  ctx.arc(0, 0, r, Math.PI, Math.PI / 2, false);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#fff';
  ctx.font = FONT(700, r * 0.95);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(c.msgs.length || '+'), 0, r * 0.05);
  ctx.restore();
}

// ------------------------------------------------------------------ despacho
export function extraBounds(it: Item): Rect | null {
  switch (it.kind) {
    case 'connector':
      return connectorBounds(it);
    case 'code':
      return { x: it.x, y: it.y, w: it.w, h: codeHeight(it) };
    case 'audio':
    case 'video':
    case 'math':
    case 'chart':
      return { x: it.x, y: it.y, w: it.w, h: it.h };
    case 'comment':
      return { x: it.x - 16, y: it.y - 16, w: 32, h: 32 };
    case 'layer':
    case 'bookmark':
      return { x: 0, y: 0, w: 0, h: 0 };
  }
  return null;
}

export function drawExtra(ctx: CanvasRenderingContext2D, it: Item, zoom: number): boolean {
  switch (it.kind) {
    case 'connector':
      drawConnector(ctx, it, zoom);
      return true;
    case 'audio':
      drawAudio(ctx, it, zoom);
      return true;
    case 'video':
      drawVideo(ctx, it, zoom);
      return true;
    case 'math':
      drawMath(ctx, it, zoom);
      return true;
    case 'code':
      drawCode(ctx, it, zoom);
      return true;
    case 'chart':
      drawChart(ctx, it, zoom);
      return true;
    case 'comment':
      drawComment(ctx, it, zoom);
      return true;
    case 'layer':
    case 'bookmark':
      return true;
  }
  return false;
}
