// Modelo de datos compartido con el servidor (server/index.js).
// Cada elemento se sincroniza de forma independiente: gana el de mayor (rev, by).

export interface BaseItem {
  id: string;
  rev: number; // marca de versión (ms, siempre creciente por elemento)
  by: string; // id del dispositivo que hizo el último cambio
  z: number; // orden de apilado
  deleted?: boolean; // lápida: se conserva para propagar borrados
}

/** Trazo en coordenadas locales: [x, y, presión, x, y, presión, ...] */
export interface StrokeData {
  pts: number[];
  color: string;
  size: number;
  tool: 'pen' | 'marker';
  pressure: boolean; // true si viene de un lápiz con presión real
}

export interface StrokeItem extends BaseItem, StrokeData {
  kind: 'stroke';
}

export interface NoteItem extends BaseItem {
  kind: 'note';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  text: string;
  /** Espacio de coordenadas en el que se dibujó el sketch (se escala al redimensionar). */
  baseW: number;
  baseH: number;
  strokes: StrokeData[];
}

export type Item = StrokeItem | NoteItem;

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  itemCount?: number;
  synced?: boolean; // existe en el servidor
  thumb?: string; // miniatura local (dataURL)
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Tool = 'pen' | 'marker' | 'eraser' | 'select' | 'hand' | 'note';

export function isNewer(a: BaseItem, b?: BaseItem): boolean {
  if (!b) return true;
  if (a.rev !== b.rev) return a.rev > b.rev;
  return String(a.by) > String(b.by);
}
