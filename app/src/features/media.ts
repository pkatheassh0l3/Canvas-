// Notas de voz y vídeos (YouTube o archivo).
import type { BoardView } from '../board/boardView';
import type { AudioItem, VideoItem } from '../types';
import { addAsset, assetStreamUrl, assetUrl } from '../assets';
import { h, toast, uid } from '../util';
import { icons } from '../ui/icons';
import { askText } from '../ui/dialogs';
import { pickFile } from '../docs/importers';
import { AUDIO_BASE_H, AUDIO_BASE_W, fmtTime, getPlaying, setPlaying, youtubeId } from '../board/extra';

// ------------------------------------------------------------------ notas de voz
export function recordVoice(b: BoardView) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast('Este dispositivo no permite grabar audio desde la app');
    return;
  }
  let rec: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let t0 = 0;
  let timer: any = null;
  let cancelled = false;
  const time = h('div', { class: 'rec-time' }, '0:00');
  const status = h('p', { class: 'panel-hint' }, 'Pulsa para empezar a grabar');
  const btn = h('button', { class: 'rec-btn', title: 'Grabar', onclick: () => (rec ? stop() : start()) }, h('span', {}));
  const close = () => {
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    bg.remove();
  };
  const bg = h(
    'div',
    { class: 'modal-bg' },
    h(
      'div',
      { class: 'modal small rec-modal' },
      h('h2', {}, 'Nota de voz'),
      time,
      btn,
      status,
      h(
        'div',
        { class: 'row end' },
        h(
          'button',
          {
            class: 'btn ghost',
            onclick: () => {
              cancelled = true;
              if (rec && rec.state !== 'inactive') rec.stop();
              close();
            },
          },
          'Cancelar',
        ),
      ),
    ),
  );
  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      status.textContent = 'No hay permiso para usar el micrófono';
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      if (cancelled) return;
      const duration = (performance.now() - t0) / 1000;
      const type = (rec!.mimeType || 'audio/webm').split(';')[0];
      const blob = new Blob(chunks, { type });
      close();
      if (duration < 0.5) return;
      const asset = await addAsset(blob);
      const title = (await askText('Título de la nota (opcional)', '', 'Aceptar')) ?? '';
      const [cx, cy] = b.viewCenter();
      const w = AUDIO_BASE_W / b.view.zoom;
      const hh = AUDIO_BASE_H / b.view.zoom;
      const a: AudioItem = { id: uid(), rev: 0, by: '', z: b.doc.nextZ(), kind: 'audio', x: cx - w / 2, y: cy - hh / 2, w, h: hh, asset, duration, title };
      b.doc.add([a]);
      b.setTool('select');
      b.selection = new Set([a.id]);
      b.refreshUI();
    };
    rec.start(250);
    t0 = performance.now();
    btn.classList.add('on');
    status.textContent = 'Grabando… pulsa para terminar';
    timer = setInterval(() => (time.textContent = fmtTime((performance.now() - t0) / 1000)), 250);
  }
  function stop() {
    rec?.stop();
    clearInterval(timer);
  }
  document.body.append(bg);
}

export async function toggleAudio(b: BoardView, a: AudioItem) {
  const cur = getPlaying();
  if (cur?.id === a.id) {
    if (cur.el.paused) cur.el.play();
    else cur.el.pause();
    b.markDirty();
    return;
  }
  cur?.el.pause();
  const url = await assetStreamUrl(a.asset);
  if (!url) return toast('El audio no está disponible sin conexión');
  const el = new Audio(url);
  setPlaying({ id: a.id, el });
  const redraw = () => b.markDirty();
  el.addEventListener('timeupdate', redraw);
  el.addEventListener('pause', redraw);
  el.addEventListener('ended', () => {
    setPlaying(null);
    redraw();
  });
  el.play().catch(() => toast('No se pudo reproducir el audio'));
}

// ------------------------------------------------------------------ vídeos
async function videoThumb(file: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = URL.createObjectURL(file);
    v.addEventListener('loadeddata', () => (v.currentTime = Math.min(1, (v.duration || 2) / 3)));
    v.addEventListener('seeked', () => {
      const c = document.createElement('canvas');
      const k = Math.min(1, 640 / (v.videoWidth || 640));
      c.width = Math.round((v.videoWidth || 640) * k);
      c.height = Math.round((v.videoHeight || 360) * k);
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((bl) => resolve(bl), 'image/jpeg', 0.8);
      URL.revokeObjectURL(v.src);
    });
    v.addEventListener('error', () => resolve(null));
    setTimeout(() => resolve(null), 8000);
  });
}

export function insertVideo(b: BoardView) {
  const bg = h(
    'div',
    { class: 'modal-bg', onclick: (e: Event) => e.target === bg && bg.remove() },
    h(
      'div',
      { class: 'modal small' },
      h('h2', {}, 'Añadir vídeo'),
      h(
        'div',
        { class: 'choice-grid' },
        h('button', { class: 'ip-item', onclick: () => (bg.remove(), addYoutube(b)) }, h('span', { html: icons.youtube }), h('em', {}, 'Enlace de YouTube')),
        h('button', { class: 'ip-item', onclick: () => (bg.remove(), addVideoFile(b)) }, h('span', { html: icons.video }), h('em', {}, 'Archivo de vídeo')),
      ),
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => bg.remove() }, 'Cancelar')),
    ),
  );
  document.body.append(bg);
}

function placeVideo(b: BoardView, v: Omit<VideoItem, 'x' | 'y' | 'w' | 'h' | 'id' | 'rev' | 'by' | 'z' | 'kind'>, ratio = 9 / 16) {
  const [cx, cy] = b.viewCenter();
  const w = 480 / b.view.zoom;
  const hh = w * ratio;
  const it: VideoItem = { id: uid(), rev: 0, by: '', z: b.doc.nextZ(), kind: 'video', x: cx - w / 2, y: cy - hh / 2, w, h: hh, ...v };
  b.doc.add([it]);
  b.setTool('select');
  b.selection = new Set([it.id]);
  b.refreshUI();
}

export async function addYoutube(b: BoardView, url?: string) {
  url ??= (await askText('Enlace del vídeo de YouTube', 'https://www.youtube.com/watch?v=', 'Añadir')) ?? '';
  const id = youtubeId(url);
  if (!id) return url && toast('No parece un enlace de YouTube');
  placeVideo(b, { source: 'youtube', ytId: id, title: '' });
}

async function addVideoFile(b: BoardView) {
  const f = await pickFile('video/*');
  if (!f) return;
  if (f.size > 500 * 1024 * 1024) return toast('El vídeo supera 500 MB');
  const t = toast('Guardando vídeo…', 60000);
  try {
    const thumbBlob = await videoThumb(f);
    const asset = await addAsset(f.type ? f : new Blob([f], { type: 'video/mp4' }));
    const thumb = thumbBlob ? await addAsset(thumbBlob) : undefined;
    let ratio = 9 / 16;
    if (thumbBlob) {
      const img = await createImageBitmap(thumbBlob);
      ratio = img.height / img.width || ratio;
    }
    placeVideo(b, { source: 'file', asset, thumb, title: f.name.replace(/\.[^.]+$/, '') }, ratio);
  } finally {
    t.remove();
  }
}

export async function openVideo(v: VideoItem) {
  let player: HTMLElement;
  if (v.source === 'youtube' && v.ytId) {
    player = h('iframe', {
      class: 'video-frame',
      src: `https://www.youtube-nocookie.com/embed/${v.ytId}?autoplay=1&rel=0`,
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      allowfullscreen: true,
      referrerpolicy: 'strict-origin-when-cross-origin',
    });
  } else {
    const url = v.asset ? await assetStreamUrl(v.asset) : null;
    if (!url) return toast('El vídeo no está disponible sin conexión');
    player = h('video', { class: 'video-frame', src: url, controls: true, autoplay: true, playsInline: true });
  }
  const close = () => bg.remove();
  const bg = h(
    'div',
    { class: 'modal-bg video-bg', onclick: (e: Event) => e.target === bg && close() },
    h(
      'div',
      { class: 'video-wrap' },
      player,
      h(
        'div',
        { class: 'row end' },
        v.source === 'youtube' &&
          h('button', { class: 'btn', onclick: () => window.open(`https://www.youtube.com/watch?v=${v.ytId}`, '_blank') }, 'Abrir en YouTube'),
        h('button', { class: 'btn primary', onclick: close }, 'Cerrar'),
      ),
    ),
  );
  document.body.append(bg);
}

export { assetUrl };
