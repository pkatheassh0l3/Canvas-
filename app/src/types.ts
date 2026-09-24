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

/** Imagen pegada o importada. */
export interface ImageItem extends BaseItem {
  kind: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  asset: string;
}

/** Tabla sencilla (texto por celda). */
export interface TableItem extends BaseItem {
  kind: 'table';
  x: number;
  y: number;
  w: number;
  h: number; // calculado al guardar (altura según el texto)
  cells: string[][]; // [fila][columna]
  header: boolean; // primera fila como cabecera
  fs: number; // tamaño de letra en unidades del mundo
}

export type ShapeKind = 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow';

/** Forma geométrica o flecha. Las líneas van de (x, y) a (x + w, y + h); w/h pueden ser negativos. */
export interface ShapeItem extends BaseItem {
  kind: 'shape';
  shape: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  fill: string; // 'none' o color
  sw: number; // grosor en unidades del mundo
  label: string;
}

/** Marco / sección para agrupar zonas de la pizarra. Se dibuja siempre por debajo. */
export interface FrameItem extends BaseItem {
  kind: 'frame';
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  color: string;
}

/** Tarjeta de enlace a una web. */
export interface LinkItem extends BaseItem {
  kind: 'link';
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
  title: string;
}

/** Lista de tareas con casillas. */
export interface TodoItem extends BaseItem {
  kind: 'todo';
  x: number;
  y: number;
  w: number;
  h: number; // calculado según el número de tareas
  title: string;
  items: { t: string; done: boolean }[];
}

/** Anotación sobre una página de PDF. Coordenadas normalizadas: el ancho de página vale 1000. */
export type PdfAnnotation =
  | ({ t: 'ink'; id: string } & StrokeData)
  | { t: 'mark'; id: string; style: 'highlight' | 'underline' | 'strike'; color: string; rects: [number, number, number, number][] };

/** PDF importado: solo lectura, con anotaciones encima. */
export interface PdfItem extends BaseItem {
  kind: 'pdf';
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  file: string; // asset con el PDF original
  thumb: string; // asset con la imagen de la primera página
  pages: number;
  sizes: [number, number][]; // tamaño de cada página en puntos PDF
  ann: Record<string, PdfAnnotation[]>; // por índice de página ("0", "1"…)
}

export type Item = StrokeItem | NoteItem | TextItem | DocItem | ImageItem | TableItem | ShapeItem | FrameItem | LinkItem | TodoItem | PdfItem;
/** Elementos con caja (x, y, w, h) que se pueden redimensionar con el tirador. */
export type BoxItem = NoteItem | DocItem | ImageItem | TableItem | ShapeItem | FrameItem | LinkItem | TodoItem | PdfItem;

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

export type Tool = 'pen' | 'marker' | 'eraser' | 'select' | 'hand' | 'note' | 'text' | 'doc' | 'shape';

export function isNewer(a: BaseItem, b?: BaseItem): boolean {
  if (!b) return true;
  if (a.rev !== b.rev) return a.rev > b.rev;
  return String(a.by) > String(b.by);
}
