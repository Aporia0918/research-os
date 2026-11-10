import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'dev.paperlab.assistant', appName: 'Paper Lab Assistant', webDir: 'dist',
  // Native HTTP (bypasses WebView CORS) and native cookie store so the computer session cookie works.
  plugins: { CapacitorHttp: { enabled: true }, CapacitorCookies: { enabled: true } },
  server: { androidScheme: 'https', cleartext: true },
};
export default config;
