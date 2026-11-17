// 论文附带的数据集、代码链接 (板块修改总结: merged into 科研, hung on that paper's debts). Rules only, no model: the links a
// paper prints for its code and data are found on its pages by the hosts that serve code or research data; the user
// confirms which to keep and can add any http(s) link by hand.

export type LinkKind = 'code' | 'dataset';
export interface PaperLink { kind: LinkKind; url: string; page?: number }

const CODE = /^(?:[\w-]+\.)*(?:github\.com|gitlab\.com|gitee\.com|bitbucket\.org|codeocean\.com)\//i;
const DATA = new RegExp('^(?:[\\w-]+\\.)*(?:zenodo\\.org|figshare\\.com|osf\\.io|datadryad\\.org|kaggle\\.com|physionet\\.org|openneuro\\.org|' +
  'dataverse\\.[\\w.]+|data\\.mendeley\\.com|huggingface\\.co/datasets|ncbi\\.nlm\\.nih\\.gov/geo|scidb\\.cn)/|' +
  '^doi\\.org/10\\.(?:5281|6084|5061|17632|18112|7910|13026|57760)/', 'i');
const FIND = /https?:\/\/[^\s<>"'）)\]】，。；、]+|\b(?:www\.)?(?:github\.com|gitlab\.com|gitee\.com|bitbucket\.org|codeocean\.com|zenodo\.org|figshare\.com|osf\.io|datadryad\.org|kaggle\.com|physionet\.org|openneuro\.org|huggingface\.co|scidb\.cn)\/[^\s<>"'）)\]】，。；、]+|\b10\.\d{4,9}\/[^\s<>"'）)\]】，。；、]+/gi;

/** One link as stored: https, no trailing punctuation, a bare DOI as a doi.org link; null for anything else. */
export function cleanLink(raw: string): string | null {
  let s = raw.trim().replace(/[.,;:!?'"]+$/, '');
  if (/^10\.\d{4,9}\//.test(s)) s = new URL(s, 'https://doi.org/').href;
  else if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.href.replace(/^http:/, 'https:').replace(/\/$/, '');
  } catch { return null; }
}

/** What a link is for, or null when its host serves neither code nor research data. */
export function kindOf(url: string): LinkKind | null {
  const rest = url.replace(/^https?:\/\/(?:www\.)?/i, '');
  return CODE.test(rest) ? 'code' : DATA.test(rest) ? 'dataset' : null;
}

/** The code and data links printed in a paper, with the first page each appears on, once each, code first. */
export function findLinks(pages: string[]): PaperLink[] {
  const seen = new Map<string, PaperLink>();
  pages.forEach((text, i) => {
    for (const m of text.matchAll(FIND)) {
      const url = cleanLink(m[0]);
      const kind = url && kindOf(url);
      if (url && kind && !seen.has(url.toLowerCase())) seen.set(url.toLowerCase(), { kind, url, page: i + 1 });
    }
  });
  return [...seen.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'code' ? -1 : 1));
}
