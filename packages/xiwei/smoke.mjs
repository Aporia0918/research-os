// 在 Node 里用和手机同一套 Pyodide 文件跑一遍引擎：加载、读题、出变式、判分。CI 用它确认打出来的 site.zip 能用。
// 用法：node smoke.mjs <build_site.py 的输出目录>
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = resolve(process.argv[2]);
const { loadPyodide } = await import(pathToFileURL(`${dir}/pyodide.mjs`).href);
const t0 = performance.now();
const py = await loadPyodide({ indexURL: `${dir}/` });
// 和手机上的 engine.worker.ts 同一套加载方式
py.unpackArchive(readFileSync(`${dir}/site.zip`).buffer, 'zip', { extractDir: '/site' });
py.pyimport('sys').path.insert(0, '/site');
const api = py.pyimport('xiwei.api');
const call = (name, args) => JSON.parse(api.call(name, JSON.stringify(args)));
const r = call('read', { text: '求极限 lim(x→0⁺) |x|/x' });
const g = call('generate', { problem: r.problem });
const gr = call('grade', { original: r.problem, variant: g.variant.problem, answer: '不存在' });
const ms = Math.round(performance.now() - t0);
console.log(JSON.stringify({ ms, variant: g.variant.segments.map((s) => s[0]).join(''), answer: g.variant.answer.text, verdict: gr.verdict }));
if (!r.ok || !g.ok || !g.variant || !gr.ok || gr.verdict !== 'missed') process.exit(1); // the phone reads ok first
