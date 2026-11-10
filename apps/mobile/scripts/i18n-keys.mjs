// Lists every Chinese UI key: tr('...') first arguments, strings inside trObj(...), and top-level string consts passed to tr(CONST).
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const HAN = /[\u3400-\u9fff]/;
export function collectKeys(root = 'src') {
  const files = []; (function w(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? w(p) : /\.tsx?$/.test(f) && !p.includes('i18n') && files.push(p); } })(root);
  const keys = new Set(); const consts = new Map(); const constRefs = new Set();
  for (const f of files) {
    const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const lits = n => { if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && HAN.test(n.text) && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)) keys.add(n.text); ts.forEachChild(n, lits); };
    const v = n => {
      if (ts.isVariableDeclaration(n) && n.initializer && ts.isStringLiteral(n.initializer) && HAN.test(n.initializer.text)) consts.set(n.name.getText(), n.initializer.text);
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const a = n.arguments[0];
        if (n.expression.text === 'tr' && a) { if (ts.isStringLiteral(a)) keys.add(a.text); else if (ts.isIdentifier(a)) constRefs.add(a.text); }
        if (n.expression.text === 'trObj' && a) lits(a);
      }
      ts.forEachChild(n, v);
    };
    v(sf);
  }
  for (const c of constRefs) if (consts.has(c)) keys.add(consts.get(c));
  return [...keys];
}
if (process.argv[1] && process.argv[1].endsWith('i18n-keys.mjs')) console.log(JSON.stringify(collectKeys(), null, 0));
