import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { collectKeys } from './i18n-keys.mjs';
const source=ts.createSourceFile('en.ts', readFileSync('src/i18n/en.ts','utf8'),ts.ScriptTarget.Latest,true);
const dictionary=new Map();
function visit(n){if(ts.isStringLiteral(n)&&ts.isPropertyAssignment(n.parent)&&n.parent.initializer===n){let k=n.parent.name;if(ts.isStringLiteral(k)||ts.isIdentifier(k)) dictionary.set(k.text,n.text);}ts.forEachChild(n,visit)}visit(source);
const missing=collectKeys().filter(k=>!dictionary.get(k));
export const EN=JSON.stringify(missing);
