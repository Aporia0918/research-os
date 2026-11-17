// Keep in sync with android/app/build.gradle (versionCode / versionName).
export const LOCAL_VERSION_CODE = 5;
export const LOCAL_VERSION_NAME = '1.4';
export const UPDATE_CHANNEL = 'stable';

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
/** Test builds (CI debug APKs) update from the repo's rolling 测试版 pre-release instead of the stable source. */
export const TEST_BUILD = env.VITE_TEST_BUILD === '1';
export const TEST_MANIFEST_URL = 'https://github.com/Aporia0918/research-os/releases/download/test-latest/version.json';
/** CI sets the code to 100 + run number, the same number gradle gives the APK, so each build is newer than the last. */
const testCode = Number(env.VITE_VERSION_CODE);

/** What this install is and where it looks for a newer one. */
export const CURRENT = TEST_BUILD
  ? { code: Number.isInteger(testCode) && testCode > 0 ? testCode : LOCAL_VERSION_CODE, name: `${LOCAL_VERSION_NAME}.${testCode || 0}`, channel: 'test', source: TEST_MANIFEST_URL }
  : { code: LOCAL_VERSION_CODE, name: LOCAL_VERSION_NAME, channel: UPDATE_CHANNEL, source: '' };
