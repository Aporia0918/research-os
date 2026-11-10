# usage: python3 scripts/en-add.py <json-file-with-{zh: en}>  — appends entries to src/i18n/en.ts (dev helper)
import json, sys
add = json.load(open(sys.argv[1])); p = 'src/i18n/en.ts'; s = open(p).read()
i = s.rstrip().rfind('};'); body = ''.join(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},\n' for k, v in add.items() if json.dumps(k, ensure_ascii=False) + ':' not in s)
open(p, 'w').write(s[:i] + body + '};\n')
