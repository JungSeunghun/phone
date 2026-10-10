#!/bin/bash
set -euo pipefail
if ! command -v brew >/dev/null; then
  printf 'Homebrew를 먼저 설치하세요: https://brew.sh\n'
  exit 1
fi
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install --cask android-platform-tools
