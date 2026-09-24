// Cliente WebSocket de sincronización en tiempo real con reconexión automática.
import type { Item, ProjectMeta } from './types';
import { isNewer } from './types';
import { hasServer, wsUrl } from './settings';

export type SyncStatus = 'local' | 'connecting' | 'online' | 'offline';

export interface SyncHost {
  /** Elementos actuales en el tablero (para comparar con el snapshot del NAS). */
  allItems(): Iterable<Item>;
  /** Aplica cambios que vienen del NAS. */
  applyRemote(items: Item[]): void;
  onStatus(s: SyncStatus): void;
  onMeta?(m: ProjectMeta): void;
  onRemoved?(): void;
}

export class SyncClient {
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: any = null;
  private closed = false;
  private outbox = new Map<string, Item>();
  private flushTimer: any = null;
  private seq = 0;
  status: SyncStatus = 'local';

  constructor(
    private projectId: string,
    private projectName: string,
    private host: SyncHost,
  ) {
    if (hasServer()) this.connect();
    else this.setStatus('local');
    window.addEventListener('online', this.kick);
  }

  private kick = () => {
    if (this.status === 'offline') {
      clearTimeout(this.timer);
      this.retry = 0;
      this.connect();
    }
  };

  private setStatus(s: SyncStatus) {
    this.status = s;
    this.host.onStatus(s);
  }

  private connect() {
    if (this.closed) return;
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(this.projectId, this.projectName));
    } catch {
      return this.scheduleReconnect();
    }
    this.ws = ws;
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onclose = (ev) => {
      this.ws = null;
      if (ev.code === 4404) {
        this.closed = true;
        this.host.onRemoved?.();
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    if (this.closed) return;
    this.setStatus('offline');
    const delay = Math.min(30000, 1000 * 2 ** this.retry++) * (0.7 + Math.random() * 0.6);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private onMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.t === 'snapshot') {
      this.retry = 0;
      const server = new Map<string, Item>((msg.items as Item[]).map((i) => [i.id, i]));
      const incoming: Item[] = [];
      for (const it of server.values()) incoming.push(it);
      // lo que tengo yo más nuevo (cambios hechos sin conexión) → lo subo
      const toSend: Item[] = [];
      for (const mine of this.host.allItems()) {
        const s = server.get(mine.id);
        if (isNewer(mine, s)) toSend.push(mine);
      }
      this.host.applyRemote(incoming);
      this.setStatus('online');
      if (msg.meta) this.host.onMeta?.(msg.meta);
      for (const it of toSend) this.outbox.set(it.id, it);
      this.flush();
    } else if (msg.t === 'ops') {
      this.host.applyRemote(msg.ops);
    } else if (msg.t === 'meta') {
      this.host.onMeta?.(msg.meta);
    }
  }

  /** Encola un cambio local; se envían agrupados cada ~50 ms. */
  push(items: Item[]) {
    for (const it of items) this.outbox.set(it.id, it);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 50);
  }

  private flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== 'online') return;
    if (!this.outbox.size) return;
    const ops = [...this.outbox.values()];
    this.outbox.clear();
    // si el socket se cae antes del ack, el snapshot de la reconexión detecta la diferencia
    this.ws.send(JSON.stringify({ t: 'ops', seq: ++this.seq, ops }));
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    window.removeEventListener('online', this.kick);
    this.flush();
    this.ws?.close();
  }
}
