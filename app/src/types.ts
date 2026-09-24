// Modelo de datos compartido con el servidor (server/index.js).
// Cada elemento se sincroniza de forma independiente: gana el de mayor (rev, by).

export interface BaseItem {
  id: string;
  rev: number; // marca de versión (ms, siempre creciente por elemento)
  by: string; // id del dispositivo que hizo el último cambio
  z: number; // orden de apilado
  deleted?: boolean; // lápida: se conserva para propagar borrados
  rot?: number; // giro en radianes alrededor del centro
  locked?: boolean; // bloqueado: no se mueve, redimensiona ni borra
  group?: string; // id de grupo: se seleccionan juntos
  layer?: string; // id de la capa (sin capa = capa principal)
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

/** Formato de una celda de tabla. */
export interface CellFmt {
  b?: boolean; // negrita
  i?: boolean; // cursiva
  u?: boolean; // subrayado
  s?: boolean; // tachado
  color?: string; // color del texto
  bg?: string; // relleno
  al?: 'left' | 'center' | 'right';
  nf?: 'general' | 'number' | 'currency' | 'percent' | 'date' | 'datetime' | 'time' | 'text';
  dec?: number; // decimales
}

/** Tabla / hoja de cálculo. Las celdas guardan lo escrito ("=SUMA(A1:A3)" en las fórmulas). */
export interface TableItem extends BaseItem {
  kind: 'table';
  x: number;
  y: number;
  w: number;
  h: number; // calculado al guardar (altura según el texto)
  cells: string[][]; // [fila][columna]
  header: boolean; // primera fila como cabecera
  fs: number; // tamaño de letra en unidades del mundo
  fmt?: Record<string, CellFmt>; // "fila,columna" → formato
  colW?: number[]; // ancho relativo de cada columna (1 = normal)
}

export type ShapeKind = 'rect' | 'ellipse' | 'diamond' | 'triangle' | 'line' | 'arrow';

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
  text?: string[]; // texto de cada página (para la búsqueda)
  ann: Record<string, PdfAnnotation[]>; // por índice de página ("0", "1"…)
}

/** Extremo de un conector: pegado a un elemento (id) o suelto en un punto. */
export interface ConnectorEnd {
  id?: string;
  x: number;
  y: number;
}

/** Línea/flecha que une dos elementos y los sigue al moverlos. */
export interface ConnectorItem extends BaseItem {
  kind: 'connector';
  from: ConnectorEnd;
  to: ConnectorEnd;
  stroke: string;
  sw: number;
  arrow: 'end' | 'both' | 'none';
  curve: boolean;
  label: string;
}

/** Capa (no se dibuja): agrupa elementos para ocultarlos o bloquearlos juntos. */
export interface LayerItem extends BaseItem {
  kind: 'layer';
  name: string;
  order: number;
  hidden: boolean;
  lockedLayer: boolean;
}

/** Vista guardada (marcador de zona). */
export interface BookmarkItem extends BaseItem {
  kind: 'bookmark';
  name: string;
  x: number;
  y: number;
  zoom: number;
  order: number;
}

export interface CommentMsg {
  id: string;
  author: string;
  text: string;
  at: number;
}

/** Hilo de comentarios anclado a un punto de la pizarra. */
export interface CommentItem extends BaseItem {
  kind: 'comment';
  x: number;
  y: number;
  msgs: CommentMsg[];
  resolved: boolean;
}

/** Nota de voz. */
export interface AudioItem extends BaseItem {
  kind: 'audio';
  x: number;
  y: number;
  w: number;
  h: number;
  asset: string;
  duration: number; // segundos
  title: string;
}

/** Vídeo de YouTube o archivo de vídeo. */
export interface VideoItem extends BaseItem {
  kind: 'video';
  x: number;
  y: number;
  w: number;
  h: number;
  source: 'youtube' | 'file';
  ytId?: string;
  asset?: string;
  thumb?: string; // asset con fotograma
  title: string;
}

/** Fórmula matemática (LaTeX) renderizada como SVG. */
export interface MathItem extends BaseItem {
  kind: 'math';
  x: number;
  y: number;
  w: number;
  h: number;
  tex: string;
  color: string;
  svg: string;
  ratio: number; // alto/ancho natural del SVG
  svgW?: number; // ancho natural del SVG (px)
}

/** Bloque de código con resaltado. */
export interface CodeItem extends BaseItem {
  kind: 'code';
  x: number;
  y: number;
  w: number;
  h: number; // calculado
  code: string;
  lang: string;
}

export type ChartKind = 'bar' | 'line' | 'pie';

/** Gráfico a partir de una tabla (se actualiza si cambia la tabla). */
export interface ChartItem extends BaseItem {
  kind: 'chart';
  x: number;
  y: number;
  w: number;
  h: number;
  chart: ChartKind;
  table?: string;
  data: string[][]; // copia de la tabla por si se borra
  title: string;
}

export type Item =
  | StrokeItem
  | NoteItem
  | TextItem
  | DocItem
  | ImageItem
  | TableItem
  | ShapeItem
  | FrameItem
  | LinkItem
  | TodoItem
  | PdfItem
  | ConnectorItem
  | LayerItem
  | BookmarkItem
  | CommentItem
  | AudioItem
  | VideoItem
  | MathItem
  | CodeItem
  | ChartItem;
/** Elementos con caja (x, y, w, h) que se pueden redimensionar con el tirador. */
export type BoxItem =
  | NoteItem
  | DocItem
  | ImageItem
  | TableItem
  | ShapeItem
  | FrameItem
  | LinkItem
  | TodoItem
  | PdfItem
  | AudioItem
  | VideoItem
  | MathItem
  | CodeItem
  | ChartItem;

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  itemCount?: number;
  synced?: boolean; // existe en el servidor
  thumb?: string; // miniatura local (dataURL)
  access?: 'owner' | 'edit' | 'view'; // permiso de la cuenta actual (servidor con usuarios)
  ownerName?: string;
  shared?: boolean; // el propietario lo ha compartido con alguien
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Tool = 'pen' | 'marker' | 'eraser' | 'select' | 'hand' | 'note' | 'text' | 'doc' | 'shape' | 'connector' | 'laser' | 'comment';

export function isNewer(a: BaseItem, b?: BaseItem): boolean {
  if (!b) return true;
  if (a.rev !== b.rev) return a.rev > b.rev;
  return String(a.by) > String(b.by);
}
