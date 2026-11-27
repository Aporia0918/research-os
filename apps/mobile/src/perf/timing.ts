import { Capacitor, registerPlugin } from '@capacitor/core';
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
