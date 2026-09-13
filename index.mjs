#!/usr/bin/env node
// bol.com "Shophulp" AI shopping assistant as an MCP server.
//   HTTP (default):  node index.mjs           -> http://localhost:${PORT:-3000}
//   stdio:           node index.mjs --stdio
//   UI:              BOL_UI=text (default) | widget   (widget = MCP Apps product carousel)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const UI = process.env.BOL_UI === "widget" ? "widget" : "text";
const WIDGET_URI = "ui://bol/product-carousel.html";
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
    { description: "Ask bol.com's Shophulp AI shopping assistant (Dutch marketplace: electronics, books, home, toys, fashion...). Ask in Dutch for best results. Returns grouped product recommendations with price, seller, rating, image and url, plus a follow-up question and suggestion chips.",
      inputSchema: { question: z.string() },
      _meta: UI === "widget" ? { ui: { resourceUri: WIDGET_URI }, "openai/outputTemplate": WIDGET_URI } : undefined },
    async ({ question }) => { const r = await askBol(question);
      return { content: [{ type: "text", text: r.text }], structuredContent: r }; });
  if (UI === "widget") s.registerResource("product-carousel", WIDGET_URI, { mimeType: WIDGET_MIME }, async () => ({
    contents: [{ uri: WIDGET_URI, mimeType: WIDGET_MIME, text: readFileSync(new URL("./widget.html", import.meta.url), "utf8"),
      _meta: { ui: { prefersBorder: false, csp: { resourceDomains: ["https://media.s-bol.com"] } } } }] }));
  return s;
}

const argv = process.argv.slice(2);
if (argv.includes("--check")) {
  const r = await askBol("Wat is de goedkoopste Ubiquiti access point?");
  console.assert(r.text.length > 20 && r.products.length > 0 && r.products[0].image, "check failed", r);
  console.log("ok:", r.text.slice(0, 160).replace(/\n/g, " "), "| products:", r.products.length, "| groups:", r.groups.length, "| ui:", UI);
} else if (argv.includes("--stdio")) {
  await build().connect(new StdioServerTransport());
} else {
  const port = Number(process.env.PORT) || 3000;
  createServer(async (req, res) => {
    const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); // stateless
    await build().connect(t); await t.handleRequest(req, res);
  }).listen(port, () => console.error(`bol-mcp (${UI}) on http://localhost:${port}`));
}
