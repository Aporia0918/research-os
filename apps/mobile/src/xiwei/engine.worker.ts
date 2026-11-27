// 析微引擎在手机里跑：Pyodide（WebAssembly 版 Python）加载 build_site.py 打进 public/engine 的文件，全在本机，
// 不连外网。收 {id, name, args}，回 {id, out}；out 是 xiwei.api.call 的 JSON 文本。
interface Py {
  unpackArchive(data: ArrayBuffer, format: 'zip', o: { extractDir: string }): void;
  pyimport(name: string): { path: { insert(i: number, p: string): void }; call(name: string, args: string): string };
}

const LOADER = '/engine/pyodide.mjs'; // copied in at build time, not a module Vite or TypeScript should resolve

async function boot(): Promise<(name: string, args: string) => string> {
  const { loadPyodide } = (await import(/* @vite-ignore */ LOADER)) as { loadPyodide(o: { indexURL: string }): Promise<Py> };
  const [py, zip] = await Promise.all([loadPyodide({ indexURL: '/engine/' }), fetch('/engine/site.zip').then(r => r.arrayBuffer())]);
  py.unpackArchive(zip, 'zip', { extractDir: '/site' });
  py.pyimport('sys').path.insert(0, '/site');
  const api = py.pyimport('xiwei.api');
  return (name, args) => api.call(name, args);
}

const ready = boot();

self.onmessage = async (ev: MessageEvent<{ id: number; name: string; args: string }>) => {
  const { id, name, args } = ev.data;
  try {
    self.postMessage({ id, out: (await ready)(name, args) });
  } catch (e) {
    self.postMessage({ id, out: JSON.stringify({ ok: false, error: `引擎没加载起来（${(e as Error).message}）` }) });
  }
};
