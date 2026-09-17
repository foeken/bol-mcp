#!/bin/zsh
set -euo pipefail

export HOME="/Users/andre.foeken"
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
export BOL_MCP_HOST="127.0.0.1"
export BOL_MCP_PORT="23385"
export BOL_UI="widget"
TAILSCALE_HOST="$(tailscale status --json | /opt/homebrew/bin/node --input-type=module -e 'let input=""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => process.stdout.write(JSON.parse(input).Self.DNSName.replace(/\\.$/, "")))')"
export BOL_MCP_PUBLIC_URL="${BOL_MCP_PUBLIC_URL:-https://${TAILSCALE_HOST}/bol/mcp}"
export BOL_MCP_WIDGET_DOMAIN="${BOL_MCP_WIDGET_DOMAIN:-https://${TAILSCALE_HOST}}"
export BOL_MCP_TOKEN="$(security find-generic-password -a andre.foeken -s bol-mcp-token -w)"

cd "/Users/andre.foeken/Code/bol-mcp"
exec /opt/homebrew/bin/node index.mjs
