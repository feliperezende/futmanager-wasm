#!/usr/bin/env bash
# Compila o motor (WASM), roda os testes e monta o site estático em ./dist
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack não encontrado. Instale com: cargo install wasm-pack" >&2
  exit 1
fi
if command -v rustup >/dev/null 2>&1; then
  rustup target add wasm32-unknown-unknown >/dev/null
fi

if [[ "${SKIP_TESTS:-0}" != "1" ]]; then
  cargo test --release
fi
wasm-pack build --target web --release

rm -rf dist
mkdir -p dist/www dist/pkg
cp -r www/. dist/www/
cp pkg/futmanager.js pkg/futmanager_bg.wasm dist/pkg/
cat > dist/index.html <<'HTML'
<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=www/"><a href="www/">FutManager 98</a>
HTML
touch dist/.nojekyll
echo "Site pronto em ./dist  (ex.: python3 -m http.server -d dist 8080)"
