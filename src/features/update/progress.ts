/** Pourcentage téléchargé, ou null si la taille totale est inconnue. */
export function progressPercent(done: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.round((done / total) * 100));
}

/** Taille lisible : 512 o, 1,5 Ko, 12,3 Mo. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  const units = ["Ko", "Mo", "Go"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1).replace(".", ",")} ${units[i]}`;
}
