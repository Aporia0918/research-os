// 析微走一遍主线，在真的 Chrome 里点 App（CI 用 runner 自带的 Chrome）：读题 → 条件卡 → 做变式 → 交答案 → 指出漏看的条件。
// 它查的是 Node 冒烟测不到的那段：Vite 打出来的 Web Worker 能不能在浏览器里把 Pyodide 和 site.zip 加载起来。
// 用法：先 npm run build（public/engine 里要有 build_site.py 的输出），再 node scripts/xiwei-browser-smoke.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 4173;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('console', (m) => !m.text().includes('Failed to load resource') && console.error('console:', m.type(), m.text()));
  page.on('worker', (w) => console.error('worker started:', w.url()));
  await page.addInitScript(() => localStorage.setItem('CapacitorStorage.profile.v1', JSON.stringify({ who: 'college', slots: [], remind: false })));
  for (let i = 0; ; i += 1) { // wait for vite preview
    try { await page.goto(`http://127.0.0.1:${PORT}/`); break; } catch (e) { if (i > 30) throw e; await page.waitForTimeout(500); }
  }
  const t0 = Date.now();
  await page.getByTestId('xiwei-input').fill('求极限 lim(x→0⁺) |x|/x');
  await page.getByRole('button', { name: '读题' }).click();
  await page.getByTestId('xiwei-card').waitFor({ timeout: 120_000 });
  const loaded = Date.now() - t0;
  await page.getByRole('button', { name: '做变式' }).click();
  const question = await page.locator('[data-testid=xiwei-variant] .xiwei-q').innerText();
  await page.getByTestId('xiwei-answer').fill('不存在');
  console.error('answer box:', await page.getByTestId('xiwei-answer').inputValue());
  await page.getByRole('button', { name: '交答案' }).click();
  await page.waitForTimeout(2000);
  console.error('2 s after submit:', await page.locator('main').innerText());
  const result = await page.getByTestId('xiwei-result').innerText({ timeout: 30_000 })
    .catch(async (e) => { console.error('screen:', await page.locator('main').innerText()); throw e; });
  console.log(JSON.stringify({ firstAnswerMs: loaded, totalMs: Date.now() - t0, question, result: result.split('\n').slice(0, 3) }));
  if (!result.includes('漏看了一处条件')) process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
