// Fórmulas matemáticas: se escriben en LaTeX y se convierten a SVG con MathJax (sin conexión).
import type { BoardView } from '../board/boardView';
import type { MathItem } from '../types';
import { h, uid } from '../util';

// El paquete precompilado de MathJax (con todas las extensiones de TeX) se sirve como archivo aparte
// y se carga con <script>: sus módulos CommonJS no funcionan bien empaquetados.
import mathjaxUrl from 'mathjax-full/es5/tex-svg-full.js?url';

let mj: Promise<(tex: string) => { svg: string; w: number; h: number }> | null = null;

function loadMathJax() {
  mj ??= new Promise<any>((resolve, reject) => {
    const w = window as any;
    if (w.MathJax?.tex2svg) return resolve(w.MathJax);
    w.MathJax = {
      // sin el paquete "html" (\href, \class…): la fórmula nunca incluye enlaces ni atributos arbitrarios
      tex: { packages: { '[-]': ['html', 'bussproofs'] } },
      svg: { fontCache: 'none' },
      options: { enableMenu: false },
      startup: { typeset: false, ready: () => { w.MathJax.startup.defaultReady(); w.MathJax.startup.promise.then(() => resolve(w.MathJax), reject); } },
    };
    const s = document.createElement('script');
    s.src = mathjaxUrl;
    s.async = true;
    s.onerror = () => reject(new Error('No se pudo cargar MathJax'));
    document.head.append(s);
  }).then((MJ) => (tex: string) => {
    const node: Element = MJ.tex2svg(tex, { display: true, em: 16, ex: 8, containerWidth: 1200 });
    const el = node.querySelector('svg')!;
    let svg = el.outerHTML;
    // tamaño en px (MathJax lo da en "ex")
    const ex = 8.5;
    const w = parseFloat(svg.match(/width="([\d.]+)ex"/)?.[1] ?? '10') * ex;
    const hh = parseFloat(svg.match(/height="([\d.]+)ex"/)?.[1] ?? '3') * ex;
    svg = svg.replace(/width="[\d.]+ex"/, `width="${w}"`).replace(/height="[\d.]+ex"/, `height="${hh}"`);
    if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    return { svg, w, h: hh };
  });
  mj.catch(() => (mj = null));
  return mj;
}

const SNIPPETS: [string, string][] = [
  ['a/b', '\\frac{a}{b}'],
  ['√', '\\sqrt{x}'],
  ['xⁿ', 'x^{n}'],
  ['xᵢ', 'x_{i}'],
  ['Σ', '\\sum_{i=1}^{n} '],
  ['∫', '\\int_{a}^{b} f(x)\\,dx'],
  ['lím', '\\lim_{x \\to \\infty} '],
  ['matriz', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'],
  ['sistema', '\\begin{cases} x + y = 1 \\\\ x - y = 3 \\end{cases}'],
  ['α β γ', '\\alpha \\beta \\gamma'],
  ['π', '\\pi'],
  ['≤ ≥ ≠', '\\leq \\geq \\neq'],
  ['→', '\\rightarrow'],
  ['∞', '\\infty'],
  ['H₂O', '\\ce{H2O}'],
];

export function editMath(b: BoardView, existing?: MathItem) {
  const ta = h('textarea', { class: 'code-input', rows: 4, spellcheck: false, value: existing?.tex ?? 'E = mc^2' }) as HTMLTextAreaElement;
  const preview = h('div', { class: 'math-preview' }, 'Cargando…');
  const err = h('p', { class: 'panel-hint err' });
  let last: { svg: string; w: number; h: number } | null = null;
  let render: ((t: string) => { svg: string; w: number; h: number }) | null = null;
  const update = () => {
    if (!render) return;
    try {
      last = render(ta.value);
      err.textContent = /data-mjx-error|merror/.test(last.svg) ? 'Revisa la fórmula: hay un error de sintaxis' : '';
      // vista previa como imagen: nunca se inserta el SVG en la página
      preview.replaceChildren(h('img', { src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(last.svg), alt: '' }));
    } catch (e: any) {
      err.textContent = String(e?.message || e);
    }
  };
  let t: any;
  ta.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(update, 150);
  });
  ta.addEventListener('keydown', (e) => e.stopPropagation());
  const close = () => bg.remove();
  const save = () => {
    if (!last || !ta.value.trim()) return close();
    const scale = 1.6 / b.view.zoom;
    const w = last.w * scale;
    const hh = last.h * scale;
    if (existing) {
      const cur = b.doc.get(existing.id);
      if (cur?.kind === 'math') {
        // mantiene la escala: mismo tamaño de letra que antes
        const k = cur.w / (cur.svgW ?? last.w);
        const nw = last.w * k;
        b.doc.commit([{ ...cur, tex: ta.value, svg: last.svg, ratio: last.h / last.w, svgW: last.w, w: nw, h: last.h * k }]);
      }
    } else {
      const [cx, cy] = b.viewCenter();
      const m: MathItem = { id: uid(), rev: 0, by: '', z: b.doc.nextZ(), kind: 'math', x: cx - w / 2, y: cy - hh / 2, w, h: hh, tex: ta.value, color: b.color === '#ffffff' ? '#1f2328' : b.color, svg: last.svg, ratio: last.h / last.w, svgW: last.w };
      b.doc.add([m]);
      b.setTool('select');
      b.selection = new Set([m.id]);
      b.refreshUI();
    }
    close();
  };
  const bg = h(
    'div',
    { class: 'modal-bg' },
    h(
      'div',
      { class: 'modal wide' },
      h('h2', {}, 'Fórmula (LaTeX)'),
      h(
        'div',
        { class: 'snippets' },
        ...SNIPPETS.map(([label, tex]) =>
          h(
            'button',
            {
              class: 'chip',
              onclick: () => {
                const s = ta.selectionStart;
                ta.setRangeText(tex, s, ta.selectionEnd, 'end');
                ta.focus();
                update();
              },
            },
            label,
          ),
        ),
      ),
      ta,
      preview,
      err,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, 'Cancelar'), h('button', { class: 'btn primary', onclick: save }, existing ? 'Guardar' : 'Añadir')),
    ),
  );
  document.body.append(bg);
  ta.focus();
  loadMathJax()
    .then((fn) => {
      render = fn;
      update();
    })
    .catch((e) => {
      console.error(e);
      preview.textContent = 'No se pudo cargar el motor de fórmulas';
    });
}
