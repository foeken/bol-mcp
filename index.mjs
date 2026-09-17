#!/usr/bin/env node
// bol.com "Shophulp" AI shopping assistant as an MCP server.
//   HTTP (default):  node index.mjs           -> http://localhost:${PORT:-3000}
//   stdio:           node index.mjs --stdio
//   UI:              BOL_UI=text (default) | widget   (widget = MCP Apps product carousel)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const UI = process.env.BOL_UI === "widget" ? "widget" : "text";
const HOST = process.env.BOL_MCP_HOST || "127.0.0.1";
const PORT = Number(process.env.BOL_MCP_PORT || process.env.PORT || "3000");
const BEARER_TOKEN = process.env.BOL_MCP_TOKEN;
const PUBLIC_URL = process.env.BOL_MCP_PUBLIC_URL || `http://${HOST}:${PORT}/mcp`;
const WIDGET_URI = "ui://bol/product-carousel/v2.html";
const WIDGET_MIME = "text/html;profile=mcp-app";

// ponytail: single-turn; the API is OpenAI-chat-shaped, so pass prior messages[] if follow-ups are ever needed.
export async function askBol(question) {
  const res = await fetch("https://www.bol.com/streaming/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", "Accept-Language": "nl", "User-Agent": UA,
      Referer: "https://www.bol.com/nl/nl/sa/?nav=shoppingAgent" },
    body: JSON.stringify({ model: "gemini-3.5-flash", stream: true, user: randomUUID(),
      messages: [{ role: "user", content: question }], metadata: { thinking_level: "MINIMAL" } }),
  });
  if (!res.ok) throw new Error(`bol ${res.status}`);
  let text = "", products = [], groups = [], followUp = "", suggestions = [];
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data:") || line.trim() === "data:[DONE]") continue;
    const ev = JSON.parse(line.slice(5));
    for (const c of ev.choices ?? []) {
      text += c.delta?.content ?? "";
      for (const r of c.result ?? []) {
        if (r.question) followUp = r.question;
        if (r.suggestions) suggestions = r.suggestions;
        if (r.products) {
          groups.push({ title: r.title, summary: r.summary });
          for (const p of r.products) products.push({ id: p.globalId, name: p.title, group: r.title, price: p.price, currency: "EUR",
            seller: p.retailerName, rating: p.averageReviewRating, reviewCount: p.reviewCount, image: p.imageUrl,
            url: "https://www.bol.com" + p.productUrl });
        }
      }
    }
  }
  // Shophulp often answers with groups + a follow-up question instead of prose; synthesize text so the model has something to read.
  if (!text) text = [...groups.map(g => `**${g.title}**: ${g.summary}`), followUp].filter(Boolean).join("\n\n");
  return { text, products, groups, followUp, suggestions };
}

export function build() {
  const s = new McpServer({ name: "bol", version: "0.1.0" });
  s.registerTool("ask_bol",
    { description: "Ask bol.com's Shophulp AI shopping assistant (Dutch marketplace: electronics, books, home, toys, fashion...). Answers in the language of the question (product names stay Dutch). Returns grouped product recommendations with price, seller, rating, image and url, plus a follow-up question and suggestion chips.",
      inputSchema: { question: z.string() },
      _meta: UI === "widget" ? { ui: { resourceUri: WIDGET_URI }, "openai/outputTemplate": WIDGET_URI } : undefined },
    async ({ question }) => { const r = await askBol(question);
      const products = r.products.map(p => `- ${p.name}${p.price == null ? "" : ` — € ${p.price}`}${p.seller ? ` — ${p.seller}` : ""}`).join("\n");
      return { content: [{ type: "text", text: [r.text, products && `Products:\n${products}`].filter(Boolean).join("\n\n") }], structuredContent: r }; });
  if (UI === "widget") s.registerResource("product-carousel", WIDGET_URI, { mimeType: WIDGET_MIME }, async () => ({
    contents: [{ uri: WIDGET_URI, mimeType: WIDGET_MIME, text: readFileSync(new URL("./widget.html", import.meta.url), "utf8"),
      _meta: { ui: { prefersBorder: false, domain: "https://donut.taila4148b.ts.net", csp: { resourceDomains: ["https://media.s-bol.com"] } } } }] }));
  return s;
}

function authorized(req) {
  if (!BEARER_TOKEN) return false;
  const expected = Buffer.from(`Bearer ${BEARER_TOKEN}`);
  const supplied = Buffer.from(req.headers.authorization || "");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function writeJson(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

const argv = process.argv.slice(2);
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (!isMain) {
  // imported as a library: export only
} else if (argv.includes("--check")) {
  const r = await askBol("Wat is de goedkoopste Ubiquiti access point?");
  console.assert(r.text.length > 20 && r.products.length > 0 && r.products[0].image, "check failed", r);
  console.log("ok:", r.text.slice(0, 160).replace(/\n/g, " "), "| products:", r.products.length, "| groups:", r.groups.length, "| ui:", UI);
} else if (argv.includes("--stdio")) {
  await build().connect(new StdioServerTransport());
} else {
  if (!BEARER_TOKEN || BEARER_TOKEN.length < 24) throw new Error("BOL_MCP_TOKEN is required and must contain at least 24 characters");
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error(`Invalid BOL_MCP_PORT: ${process.env.BOL_MCP_PORT}`);
  createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname === "/health") {
      writeJson(res, 200, { ok: true, service: "bol-mcp" });
      return;
    }
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      writeJson(res, 200, { resource: PUBLIC_URL, bearer_methods_supported: ["header"] });
      return;
    }
    if (url.pathname !== "/mcp") {
      writeJson(res, 404, { error: "not_found" });
      return;
    }
    if (!authorized(req)) {
      writeJson(res, 401, { jsonrpc: "2.0", error: { code: -32001, message: "Authentication required" }, id: null }, {
        "www-authenticate": `Bearer resource_metadata="${new URL("./.well-known/oauth-protected-resource/mcp", PUBLIC_URL)}"`,
      });
      return;
    }
    try {
      const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); // stateless
      await build().connect(t); await t.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) writeJson(res, 500, { error: "internal_error" });
      else res.end();
      console.error(`bol-mcp request error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }).listen(PORT, HOST, () => console.error(`bol-mcp (${UI}) on http://${HOST}:${PORT}`));
}
