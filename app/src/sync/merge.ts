// Mezcla de cambios hechos a la vez en dos sitios (three-way merge).
// base = última versión común · mine = la mía · theirs = la que llega de otro dispositivo.

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Valor simple: si yo no lo he tocado, gana el suyo; si lo he tocado, el mío. */
export function mergeValue<T>(base: T, mine: T, theirs: T): T {
  return same(mine, base) ? theirs : mine;
}

/**
 * Listas de elementos con identidad (trazos, anotaciones…).
 * Se conservan los añadidos de los dos y se quitan los borrados de cualquiera de los dos.
 */
export function mergeSet<T>(base: T[], mine: T[], theirs: T[], key: (x: T) => string): T[] {
  const kb = new Set(base.map(key));
  const km = new Map(mine.map((x) => [key(x), x]));
  const kt = new Map(theirs.map((x) => [key(x), x]));
  const out: T[] = [];
  const seen = new Set<string>();
  // orden: el suyo, y luego lo que he añadido yo
  for (const [k, x] of kt) {
    if (kb.has(k) && !km.has(k)) continue; // lo he borrado yo
    out.push(km.get(k) ?? x);
    seen.add(k);
  }
  for (const [k, x] of km) {
    if (seen.has(k)) continue;
    if (kb.has(k)) continue; // estaba y el otro lo ha borrado
    out.push(x);
  }
  return out;
}

export const strokeKey = (s: { pts: number[]; color: string; size: number }) => `${s.color}|${s.size}|${s.pts.length}|${s.pts.slice(0, 6).join(',')}|${s.pts.slice(-3).join(',')}`;

// ------------------------------------------------------------------ texto por bloques (párrafos)
/** Pares [i, j] de la subsecuencia común más larga entre a y b. */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  // quita prefijo y sufijo comunes (lo normal: casi todo igual)
  let s = 0;
  while (s < n && s < m && a[s] === b[s]) s++;
  let e = 0;
  while (e < n - s && e < m - s && a[n - 1 - e] === b[m - 1 - e]) e++;
  const A = a.slice(s, n - e);
  const B = b.slice(s, m - e);
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs: [number, number][] = [];
  for (let i = 0; i < s; i++) pairs.push([i, i]);
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      pairs.push([i + s, j + s]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  for (let k = 0; k < e; k++) pairs.push([n - e + k, m - e + k]);
  return pairs;
}

/**
 * Mezcla dos versiones de una lista de bloques (p.ej. párrafos de un documento).
 * Devuelve la lista mezclada y, para cada bloque mío, en qué posición ha quedado (-1 si desaparece).
 */
export function mergeBlocks(base: string[], mine: string[], theirs: string[]): { merged: string[]; mineAt: number[] } {
  const pm = lcs(base, mine);
  const pt = lcs(base, theirs);
  const mOf = new Map(pm.map(([b, m]) => [b, m]));
  const tOf = new Map(pt.map(([b, t]) => [b, t]));
  const merged: string[] = [];
  const mineAt = new Array(mine.length).fill(-1);
  let mi = 0;
  let ti = 0;
  // bloques que existían en la base: no son inserciones (o siguen, o alguien los borró)
  const mBase = new Set(pm.map(([, m]) => m));
  const tBase = new Set(pt.map(([, t]) => t));
  const flushInserts = (mUntil: number, tUntil: number) => {
    const mIdx: number[] = [];
    for (let k = mi; k < mUntil; k++) if (!mBase.has(k)) mIdx.push(k);
    const tIns: string[] = [];
    for (let k = ti; k < tUntil; k++) if (!tBase.has(k)) tIns.push(theirs[k]);
    const mIns = mIdx.map((k) => mine[k]);
    // lo insertado por los dos a la vez y que es idéntico, solo una vez
    const same = mIns.length === tIns.length && mIns.every((x, k) => x === tIns[k]);
    mIdx.forEach((k) => {
      mineAt[k] = merged.length;
      merged.push(mine[k]);
    });
    if (!same) merged.push(...tIns);
    mi = mUntil;
    ti = tUntil;
  };
  for (let b = 0; b < base.length; b++) {
    const m = mOf.get(b);
    const t = tOf.get(b);
    if (m === undefined || t === undefined) {
      // borrado (o cambiado) por alguno: lo que haya insertado cada uno ya saldrá como inserción
      continue;
    }
    flushInserts(m, t);
    mineAt[m] = merged.length;
    merged.push(base[b]);
    mi = m + 1;
    ti = t + 1;
  }
  flushInserts(mine.length, theirs.length);
  return { merged, mineAt };
}
