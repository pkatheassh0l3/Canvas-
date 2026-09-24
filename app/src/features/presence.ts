// Presencia en tiempo real: cursores de los demás dispositivos y puntero láser.
import type { BoardView } from '../board/boardView';
import { settings } from '../settings';

const COLORS = ['#e5484d', '#f76b15', '#30a46c', '#0090ff', '#8e4ec6', '#d6409f', '#12a594', '#b8860b'];
export function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

interface LaserPt {
  x: number;
  y: number;
  t: number;
}
interface Remote {
  x: number;
  y: number;
  name: string;
  color: string;
  t: number;
  laser: LaserPt[];
}

const LASER_LIFE = 1100;

export class Presence {
  remote = new Map<string, Remote>();
  local: LaserPt[] = [];
  private lastSend = 0;
  private laserBuf: number[] = [];
  private raf = 0;

  constructor(private b: BoardView) {}

  get myColor() {
    return colorFor(settings.clientId);
  }
  get myName() {
    return settings.userName || 'Dispositivo ' + settings.clientId.slice(0, 4);
  }

  cursor(x: number, y: number) {
    const now = performance.now();
    if (now - this.lastSend < 80) return;
    this.lastSend = now;
    this.b.sync.sendRaw({ t: 'cursor', x: Math.round(x), y: Math.round(y), name: this.myName, color: this.myColor, tool: this.b.tool });
  }

  laser(x: number, y: number, start: boolean, end = false) {
    const t = performance.now();
    if (start) this.local.push({ x: NaN, y: NaN, t }); // corte entre trazos
    this.local.push({ x, y, t });
    this.laserBuf.push(Math.round(x), Math.round(y));
    if (this.laserBuf.length >= 8 || end) {
      this.b.sync.sendRaw({ t: 'laser', pts: this.laserBuf, end, name: this.myName, color: this.myColor });
      this.laserBuf = [];
    }
    this.animate();
  }

  onMessage(msg: any) {
    if (msg.t === 'leave') {
      this.remote.delete(msg.client);
    } else {
      const r: Remote = this.remote.get(msg.client) ?? { x: 0, y: 0, name: msg.name, color: msg.color, t: 0, laser: [] };
      r.name = msg.name || r.name;
      r.color = msg.color || r.color;
      r.t = performance.now();
      if (msg.t === 'cursor') {
        r.x = msg.x;
        r.y = msg.y;
      } else if (msg.t === 'laser') {
        const now = performance.now();
        for (let i = 0; i < msg.pts.length; i += 2) r.laser.push({ x: msg.pts[i], y: msg.pts[i + 1], t: now });
        if (msg.end) r.laser.push({ x: NaN, y: NaN, t: now });
        r.x = msg.pts[msg.pts.length - 2] ?? r.x;
        r.y = msg.pts[msg.pts.length - 1] ?? r.y;
        this.animate();
      }
      this.remote.set(msg.client, r);
    }
    this.b.schedule();
  }

  private animate() {
    if (this.raf) return;
    const tick = () => {
      this.raf = 0;
      this.b.schedule();
      const now = performance.now();
      const alive = this.local.some((p) => now - p.t < LASER_LIFE) || [...this.remote.values()].some((r) => r.laser.some((p) => now - p.t < LASER_LIFE));
      if (alive) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private drawTrail(ctx: CanvasRenderingContext2D, pts: LaserPt[], color: string, zoom: number) {
    const now = performance.now();
    while (pts.length && now - pts[0].t > LASER_LIFE) pts.shift();
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (isNaN(a.x) || isNaN(b.x)) continue;
      const life = 1 - (now - b.t) / LASER_LIFE;
      ctx.strokeStyle = color;
      ctx.globalAlpha = Math.max(0, life);
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.lineWidth = (3 + 4 * life) / zoom;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D) {
    const z = this.b.view.zoom;
    this.drawTrail(ctx, this.local, '#ff2d55', z);
    const now = performance.now();
    for (const [id, r] of this.remote) {
      if (now - r.t > 8000 && !r.laser.length) {
        this.remote.delete(id);
        continue;
      }
      this.drawTrail(ctx, r.laser, r.color, z);
      if (now - r.t > 6000) continue;
      // flecha del cursor + nombre
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.scale(1 / z, 1 / z);
      ctx.fillStyle = r.color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 17);
      ctx.lineTo(4.5, 13);
      ctx.lineTo(8, 20);
      ctx.lineTo(11, 18.5);
      ctx.lineTo(7.5, 11.5);
      ctx.lineTo(13, 11.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.font = '600 11px system-ui, sans-serif';
      const w = ctx.measureText(r.name).width;
      ctx.beginPath();
      ctx.roundRect(12, 20, w + 12, 18, 9);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.name, 18, 29);
      ctx.restore();
    }
  }
}
