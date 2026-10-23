#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ "$(uname -s)" != "Darwin" ]; then
  echo "山兔 Mac 便携版只能在 macOS 上运行。"
  exit 1
fi
case "$(uname -m)" in
  arm64|aarch64) NODE="$ROOT/runtime/node-arm64" ;;
  x86_64) NODE="$ROOT/runtime/node-x64" ;;
  *) echo "不支持的 Mac 架构：$(uname -m)"; exit 1 ;;
esac
if [ ! -x "$NODE" ]; then
  echo "缺少当前 Mac 架构的内置 Node 运行时：$NODE"
  exit 1
fi
cd "$ROOT"
export SHANTU_WEB_PORT=8787
exec "$NODE" "$ROOT/server.mjs"
