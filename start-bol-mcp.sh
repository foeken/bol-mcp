#!/bin/zsh
set -euo pipefail

export HOME="/Users/andre.foeken"
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
export BOL_MCP_HOST="127.0.0.1"
export BOL_MCP_PORT="23385"
export BOL_MCP_PUBLIC_URL="https://donut.taila4148b.ts.net/bol/mcp"
export BOL_UI="widget"
export BOL_MCP_TOKEN="$(security find-generic-password -a andre.foeken -s bol-mcp-token -w)"

cd "/Users/andre.foeken/Code/bol-mcp"
exec /opt/homebrew/bin/node index.mjs
