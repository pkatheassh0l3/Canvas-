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

/** Cuadro de texto libre sobre la pizarra. */
export interface TextItem extends BaseItem {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  size: number; // tamaño de letra en unidades del mundo
  color: string;
}

/** Vista previa del documento para dibujarla en la pizarra sin renderizar HTML. */
export interface DocPreview {
  blocks: { t: string; s: 'h' | 'p' }[];
  img?: string; // asset de la primera página (PDF importado / imagen inicial)
}

/** Documento de texto enriquecido (estilo Word). Se ve como una pila de folios. */
export interface DocItem extends BaseItem {
  kind: 'doc';
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  html: string; // HTML saneado; las imágenes son <img data-asset="id">
  pages: number;
  preview: DocPreview;
}

export type Item = StrokeItem | NoteItem | TextItem | DocItem;

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

export type Tool = 'pen' | 'marker' | 'eraser' | 'select' | 'hand' | 'note' | 'text' | 'doc';

export function isNewer(a: BaseItem, b?: BaseItem): boolean {
  if (!b) return true;
  if (a.rev !== b.rev) return a.rev > b.rev;
  return String(a.by) > String(b.by);
}
