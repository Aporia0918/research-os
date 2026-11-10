#!/usr/bin/env bash
# Fail if any .apk / .apk.zip pair differs. .apk.zip is a RENAMED COPY (plain cp),
# never a compressed archive: users strip the .zip suffix before installing.
set -u
root="${1:-$(cd "$(dirname "$0")/../.." && pwd)/phone-package}"
bad=0
n=0
while IFS= read -r -d '' z; do
  a="${z%.zip}"
  if [ ! -f "$a" ]; then printf 'MISSING_APK %s\n' "$z"; bad=1; continue; fi
  if [ "$(sha256sum "$a" | cut -d' ' -f1)" != "$(sha256sum "$z" | cut -d' ' -f1)" ]; then
    printf 'MISMATCH %s\n' "$z"; bad=1
  else
    printf 'OK %s\n' "$z"
  fi
  n=$((n + 1))
done < <(find "$root" -name '*.apk.zip' -print0)
printf 'pairs=%d exit=%d\n' "$n" "$bad"
exit "$bad"
