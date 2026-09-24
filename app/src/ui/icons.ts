// Iconos SVG en línea (trazo 2px, estilo lineal).
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const icons = {
  pen: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  marker: svg('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
  eraser: svg(
    '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  ),
  select: svg('<path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/>'),
  hand: svg(
    '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  ),
  note: svg('<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/>'),
  undo: svg('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>'),
  redo: svg('<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  more: svg('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
  trash: svg(
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  ),
  copy: svg(
    '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  ),
  front: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>'),
  edit: svg('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>'),
  plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  settings: svg(
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  ),
  sticky: svg('<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/><path d="M8 9c1.5-1.5 3 1.5 4.5 0S15 8 16 9"/>'),
  fit: svg(
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  ),
  image: svg(
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  ),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  text: svg('<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>'),
  stylus: svg('<path d="m14 4 6 6"/><path d="M4 20l1-5L15 5l4 4L9 19z"/><path d="M4 20h4"/>'),
  cloud: svg('<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"/>'),
  folder: svg(
    '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
  ),
  refresh: svg(
    '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M8 16H3v5"/>',
  ),
  listUl: svg('<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  listOl: svg('<path d="M10 6h11"/><path d="M10 12h11"/><path d="M10 18h11"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
  alignLeft: svg('<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>'),
  alignCenter: svg('<path d="M21 6H3"/><path d="M17 12H7"/><path d="M19 18H5"/>'),
  alignRight: svg('<path d="M21 6H3"/><path d="M21 12H9"/><path d="M21 18H7"/>'),
  alignJustify: svg('<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>'),
  pageBreak: svg('<path d="M6 3v5h12V3"/><path d="M6 21v-5h12v5"/><path d="M3 12h2M9 12h2M13 12h2M19 12h2"/>'),
  eraserText: svg('<path d="M4 7V4h16v3"/><path d="M5 20h6"/><path d="M13 4 8 20"/><path d="m15 15 5 5"/><path d="m20 15-5 5"/>'),
  doc: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h6"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M8 9h2"/>'),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>'),
  textSize: svg('<path d="M3 7V5h10v2"/><path d="M8 5v14"/><path d="M6 19h4"/><path d="M14 13v-1h7v1"/><path d="M17.5 12v7"/><path d="M16 19h3"/>'),
  cursorText: svg('<path d="M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1"/><path d="M7 22h1a4 4 0 0 0 4-4v-1"/><path d="M7 2h1a4 4 0 0 1 4 4v1"/>'),
  pdf: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h6"/><path d="M8 13h1.5a1.5 1.5 0 0 1 0 3H8v-3Zm0 3v2"/><path d="M13 13v5h1a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2h-1Z"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
  insert: svg('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8"/><path d="M8 12h8"/>'),
  table: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>'),
  rect: svg('<rect x="3" y="5" width="18" height="14" rx="2"/>'),
  ellipse: svg('<ellipse cx="12" cy="12" rx="9" ry="7"/>'),
  diamond: svg('<path d="M12 2.5 21.5 12 12 21.5 2.5 12Z"/>'),
  line: svg('<path d="M4 20 20 4"/>'),
  arrow: svg('<path d="M4 20 20 4"/><path d="M10 4h10v10"/>'),
  frame: svg('<path d="M3 7h18"/><path d="M3 3v18h18V3z"/><path d="M7 5h4"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  todo: svg('<rect x="3" y="4" width="6" height="6" rx="1"/><path d="m4.5 7 1.2 1.2L8 6"/><path d="M13 7h8"/><rect x="3" y="14" width="6" height="6" rx="1"/><path d="M13 17h8"/>'),
  camera: svg('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>'),
  fill: svg('<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>'),
};
