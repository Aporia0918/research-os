#!/usr/bin/env bash
# List every place app code can reach the network: fetch(, axios, XMLHttpRequest, WebSocket/EventSource/sendBeacon,
# Java HttpURLConnection/URL, literal http(s) URLs, IPs, localhost and ports. Scans shipped code only:
# src/**/*.ts(x), index.html, capacitor.config.ts, android/app/src/main/java. Usage: network-scan.sh [root]
set -u
root="${1:-.}"
cd "$root" || exit 2
pat='fetch\(|=\s*fetch\b|\baxios\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|HttpURLConnection|new URL\(|openConnection|https?://|\b[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b|localhost|_PORT\b|:[0-9]{4,5}\b'
targets=(src index.html capacitor.config.ts android/app/src/main/java)
existing=(); for t in "${targets[@]}"; do [ -e "$t" ] && existing+=("$t"); done
rg -n --no-heading -e "$pat" --glob '*.ts' --glob '*.tsx' --glob '*.html' --glob '*.java' "${existing[@]}" \
  | grep -v "^src/i18n/en.ts:" | sort
echo "## total pattern hits above"
echo "## call sites (who triggers a request)"
rg -n --no-heading -e 'new ResearchOsClient|ResearchOsClient\(|makeClient|getClient|useClient|\bclient\.[a-zA-Z]+\(|\bchat\(|withFallback\(|fetchManifest\w*\(|autoCheckUpdate\(|Native\.download|platformDownloader\(|fetchDownloader\(' \
  --glob '*.ts' --glob '*.tsx' src | grep -v '^src/i18n/en.ts:' | grep -vE ':\s*(export )?(async )?function ' | sort
