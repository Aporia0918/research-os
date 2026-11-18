/** Aggregate durations only. Never include file text, an address, or a secret in a timing record. */
export const importStages: { stage: string; ms: number }[] = [];
export function resetImportTimings(): void { importStages.length = 0; }
export async function timed<T>(stage: string, work: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  try { return await work(); }
  finally { importStages.push({ stage, ms: Math.round((performance.now() - start) * 10) / 10 }); }
}

/**
 * Logs one line the moment the first screen can take input, so a cold-start run can time it from logcat
 * (.github/workflows/perf-android.yml). Carries a number only, once per launch.
 */
let readyLogged = false;
export function markReady(): void {
  if (readyLogged) return;
  readyLogged = true;
  console.info(`[perf] ready ${Math.round(performance.now())}`);
}
