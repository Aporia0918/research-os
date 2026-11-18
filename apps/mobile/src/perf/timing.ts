import { Capacitor, registerPlugin } from '@capacitor/core';
/** Aggregate durations only. Never include file text, an address, or a secret in a timing record. */
export const importStages: { stage: string; ms: number }[] = [];
export function resetImportTimings(): void { importStages.length = 0; }
export async function timed<T>(stage: string, work: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  try { return await work(); }
  finally { importStages.push({ stage, ms: Math.round((performance.now() - start) * 10) / 10 }); }
}

/**
 * Tells the native side, once per launch, that the first screen can take input; it writes one fixed logcat line that a
 * cold-start run times (.github/workflows/perf-android.yml). No data goes with it, and nothing happens off Android.
 */
const perf = registerPlugin<{ ready(): Promise<void> }>('Perf');
let readySent = false;
export function markReady(): void {
  if (readySent || !Capacitor.isNativePlatform()) return;
  readySent = true;
  void perf.ready().catch(() => {});
}
