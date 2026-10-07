#!/bin/bash
# macOS: double-click this file to start Spellbook.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js belum terinstall. Download di https://nodejs.org"
  read -p "Tekan Enter untuk keluar..."
  exit 1
fi
[ -d node_modules ] || npm install --omit=dev
node server.js
