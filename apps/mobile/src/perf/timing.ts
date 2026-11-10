/** Aggregate durations only. Never include file text, an address, or a secret in a timing record. */
export const importStages: { stage: string; ms: number }[] = [];
export function resetImportTimings(): void { importStages.length = 0; }
export async function timed<T>(stage: string, work: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  try { return await work(); }
  finally { importStages.push({ stage, ms: Math.round((performance.now() - start) * 10) / 10 }); }
}
