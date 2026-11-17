// Keep in sync with android/app/build.gradle (versionCode / versionName).
export const LOCAL_VERSION_CODE = 5;
export const LOCAL_VERSION_NAME = '1.4';
export const UPDATE_CHANNEL = 'stable';

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
/** Test builds (CI debug APKs) update from the repo's rolling 测试版 pre-release instead of the stable source. */
export const TEST_BUILD = env.VITE_TEST_BUILD === '1';
export const TEST_MANIFEST_URL = 'https://github.com/Aporia0918/research-os/releases/download/test-latest/version.json';
/**
 * Where a test build looks for a newer version.json. GitHub is often unreachable or slow in mainland China, so CI also
 * tags each test build tb-<versionCode> with only its version.json, which jsDelivr serves from several CDNs. A tag never
 * changes, so no CDN cache can hide a new build (a branch address stayed on an old build for hours). The app asks for
 * the next few codes on jsDelivr and for GitHub's copy, all at once; a missing tag just means that build is not out.
 */
export const TEST_PROBE_AHEAD = 3;
export function testManifestUrls(code: number): string[] {
  const probes: string[] = [];
  for (let k = 1; k <= TEST_PROBE_AHEAD; k++) {
    for (const h of ['gcore', 'fastly']) probes.push(`https://${h}.jsdelivr.net/gh/Aporia0918/research-os@tb-${code + k}/version.json`);
  }
  return [...probes, TEST_MANIFEST_URL];
}
/** Shown when every download mirror failed: the release page opens in any browser, with or without the app. */
export const TEST_RELEASE_PAGE = 'https://github.com/Aporia0918/research-os/releases/tag/test-latest';
/** CI sets the code to 100 + run number, the same number gradle gives the APK, so each build is newer than the last. */
const testCode = Number(env.VITE_VERSION_CODE);

/** What this install is and where it looks for a newer one. */
export const CURRENT = TEST_BUILD
  ? { code: Number.isInteger(testCode) && testCode > 0 ? testCode : LOCAL_VERSION_CODE, name: `${LOCAL_VERSION_NAME}.${testCode || 0}`, channel: 'test', sources: testManifestUrls(Number.isInteger(testCode) && testCode > 0 ? testCode : LOCAL_VERSION_CODE) }
  : { code: LOCAL_VERSION_CODE, name: LOCAL_VERSION_NAME, channel: UPDATE_CHANNEL, sources: [] as readonly string[] };
