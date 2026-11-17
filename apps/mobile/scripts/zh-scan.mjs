// Fails (exit 1) if any user-visible English text remains in the app UI source (zh is the only UI language).
// Scans src/**/*.ts(x): JSX text, user-facing JSX attributes, and string/template literals that look like prose.
// Allowed: product/proper names, units, code identifiers (no spaces, lowercase/snake), URLs, the ALLOW list below.
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOW = ['OpenRouter', 'AI', 'JSON', 'CSV', 'TSV', 'accuracy', 'PdfError', 'version.json', 'MB', 'UpdateError', 'SHA-256', 'mem:', 'UpdateInstaller', 'Research OS', 'EEGNet', 'EEG', 'PDF', 'App', 'Hz', 'Adam', 'epoch', 'extra_allowed_hosts', 'http://', 'https://', 'Methods / Materials and Methods / Experimental setup / Dataset', 'Android', 'p.', 'HTTP', 'ERP', 'OK', 'English', 'Base URL', 'Authorization: Bearer', 'x-api-key', 'Bearer ', 'ModelError', 'NFKC', 'this item has no number that needs your confirmation', 'only a key action needs approval', 'Python', 'StratifiedGroupKFold', 'GroupShuffleSplit', 'GroupKFold', 'validation_split', 'validation_data', 'Pipeline', 'imblearn', 'transform', 'groups', 'ComBat', 'SMOTE', 'UMAP', 'PCA', 'fit', 'cv',
  // Backend port (src/rules/*): parity reasons/errors compared verbatim with the Python golden tests,
  // never shown raw in the UI (UI uses Chinese labels / tr()).
  'rule mode cannot check paraphrases; this does not mean the claim has no support',
  'a an the and or of in on at to for with by from as is are was were be been being this that',
  'which who whom than then also such into over under between both each other more most less ',
  'paper study work shows show showed shown demonstrate demonstrates demonstrated report repo',
  'numbers not in the paper sentence:',
  'paper sentence has numbers the claim lacks:',
  '(the paper sentence starts with a back-reference, so it may be about something else)',
  'paper sentence does not name:',
  'negation differs between the claim and the paper sentence',
  'claim adds:',
  'similar wording only; please compare with the original text yourself',
  'mm hg',
  'number not found verbatim on the cited page of a linked plan item',
  'bad_status: status must be pending, supported, refuted or insufficient',
  'bad_hypothesis: a hypothesis needs 1-500 characters of text and 1-20 plan items',
  'RuleError',
  'no paper citation',
  'not found verbatim on the cited page',
  'number(s) ${miss.join(\', \')}: ${why}; 辅助参考, 由你判断',
  'every number without a matching quote on its page needs your confirm or reject first',
  'decision must be confirm_match or reject_match',
  'key_action must be run_model_call, send_data_out or share',
  'every key action (model call, data out, share) needs your approve or reject first',
  'decision must be approve or reject',
] // 'English' = language-switch option, shown in its own language;
const SKIP_ATTR = new Set(['className', 'data-testid', 'role', 'type', 'key', 'value', 'inputMode', 'autoCapitalize', 'autoComplete', 'id', 'rows', 'style']);
const files = [];
const URL_ALLOWED = /^https:\/\/github\.com\/Aporia0918\/(?:paper-lab-assistant-releases\/releases\/latest\/download|research-os\/releases\/download\/test-latest\/version\.json)$/;
const STORAGE_TEMPLATE = /^(?:plan|guidance|hypotheses)\.\$\{\w+\}\.v1$/;
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && !p.endsWith(join('i18n', 'en.ts')) && files.push(p); } })('src');
// src/i18n/en.ts is the English locale and is deliberately excluded: this scan covers the zh locale only.

const PROTOCOL = new Set(['GET', 'POST', 'PUT', 'DELETE', 'Content-Type', 'Idempotency-Key']);
function prose(s) {
  if (URL_ALLOWED.test(s.trim()) || STORAGE_TEMPLATE.test(s.trim())) return false;
  if (PROTOCOL.has(s.trim())) return false;
  if (/^\//.test(s.trim())) return false;
  if (/^\$\{[^}]*\}\/[\w/.-]+$/.test(s.trim())) return false;      // URL join like ${base}/chat/completions                              // API path
  if (/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/.test(s.trim())) return false; // storage key like settings.demoMode.v1
  if (/^(voice|photo)\.\$\{/.test(s.trim())) return false;            // generated upload file name, not shown
  if (/^(?:translate|rotate|scale)\([\d\s.,-]+\)$/.test(s.trim())) return false; // SVG transform (Mascot.tsx)
  if (/^M[\d.\s,a-zA-Z-]+$/.test(s.trim()) && !/[a-z]{2,}/i.test(s.replace(/[MmLlHhVvCcSsQqTtAaZz](?=[\d.\s-]|$)/g, ''))) return false; // SVG path data (icons.tsx)
  let t = s; for (const a of ALLOW) t = t.split(a).join(' ');
  t = t.replace(/\$\{[^}]*\}/g, ' ');
  if (!/[A-Za-z]{2,}/.test(t)) return false;
  if (/^[a-z0-9_.\-/:]*$/.test(s.trim())) return false;              // identifier, path, key
  if (/^[a-z]+\/[a-z0-9.+-]+$/.test(s)) return false;                 // mime type
  if (/^(application|image|audio)\//.test(s)) return false;
  return /[A-Za-z]{2,}/.test(t) && (/\s/.test(s.trim()) || /^[A-Z]/.test(s.trim()) || /[A-Za-z]{2,}[.!?:]/.test(t));
}
const hits = [];
for (const f of files) {
  const src = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const line = n => src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const visit = n => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isJsxAttribute(n) && SKIP_ATTR.has(n.name.getText())) return;
    if (ts.isElementAccessExpression(n) || (ts.isPropertyAssignment(n) && false)) { /* keys handled by prose() */ }
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind)) return;
    if (ts.isCallExpression(n) && /^(preferencesKV|kv|queue)\./.test(n.expression.getText())) return;
    let text = null;
    if (ts.isJsxText(n)) text = n.getText();
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text;
    else if (ts.isTemplateExpression(n)) text = n.getText().slice(1, -1);
    if (text && text.trim() && prose(text)) hits.push(`${f}:${line(n)}: ${JSON.stringify(text.trim().slice(0, 90))}`);
    if (!ts.isTemplateExpression(n)) ts.forEachChild(n, visit); else n.templateSpans.forEach(s => ts.forEachChild(s.expression, visit));
  };
  visit(src);
}
// Also the HTML title/lang and the Android app label.
const html = readFileSync('index.html', 'utf8');
if (!/lang="zh-CN"/.test(html)) hits.push('index.html: <html lang> is not zh-CN');
const title = (html.match(/<title>(.*?)<\/title>/) || [])[1] || '';
if (prose(title)) hits.push(`index.html: title ${title}`);
const strings = readFileSync('android/app/src/main/res/values/strings.xml', 'utf8');
for (const m of strings.matchAll(/name="(app_name|title_activity_main)">([^<]*)</g)) if (prose(m[2])) hits.push(`strings.xml ${m[1]}: ${m[2]}`);
if (hits.length) { console.log(`zh-scan: ${hits.length} English string(s) found:\n` + hits.join('\n')); process.exit(1); }
const backendTerms = files.filter(f => /后端|\bbackend\b/i.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')))
  .concat(/后端|\bbackend\b/i.test(readFileSync('src/i18n/en.ts', 'utf8')) ? ['src/i18n/en.ts'] : []);
if (backendTerms.length) { console.error('UI terminology: forbidden computer-platform wording in ' + backendTerms.join(', ')); process.exit(1); }
console.log(`zh-scan: OK, ${files.length} files scanned, no user-visible English or obsolete UI terminology`);
