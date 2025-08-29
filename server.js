/* server.js - Playwright PDF microservice (diagnostic + robust) */
const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

/** Launch Chromium with Docker-safe flags */
async function launchBrowser() {
  return chromium.launch({
    // /dev/shm issues and sandboxing cause lots of "blank PDF" cases in containers
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none"
    ],
  });
}

/** Attach verbose listeners so we see what's failing (fonts, CSP, JS errors, etc.) */
function attachDebug(page) {
  page.on("console", msg => console.log("[console]", msg.type(), msg.text()));
  page.on("pageerror", err => console.error("[pageerror]", err));
  page.on("requestfailed", req => {
    const f = req.failure();
    console.error("[requestfailed]", req.url(), f && f.errorText);
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url)) {
      console.log("[font-response]", res.status(), url);
    }
  });
}

/** Ensure we never produce invisible text (service-side guard) */
const VISIBILITY_CSS = `
  html,body{background:#fff !important;}
  *{-webkit-text-fill-color: initial !important; color:#0b1220 !important;}
`;

/** If fonts are flaky, we can force system fonts so text always shows */
const SYSTEM_FONT_CSS = `
  body, h1, h2, h3, h4, p, li, blockquote { font-family: Arial, sans-serif !important; }
`;

/** Render PDF from HTML with visibility guard; optionally force system fonts */
async function renderPdfFromHtml({ html, baseURL, format = "Letter", margin = {}, filename = "document.pdf", forceSystemFonts = false }) {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ baseURL: baseURL || undefined });

    attachDebug(page);

    // Use "screen" CSS to avoid destructive @media print overrides
    await page.emulateMedia({ media: "screen" });

    // Inject a visibility patch before content (prevents theme/print rules hiding text)
    await page.addStyleTag({ content: VISIBILITY_CSS });
    if (forceSystemFonts) {
      await page.addStyleTag({ content: SYSTEM_FONT_CSS });
    }

    // Load content and wait for network + fonts
    await page.setContent(html, { waitUntil: "networkidle", timeout: 30000 });
    try { await page.evaluateHandle("document.fonts && document.fonts.ready"); } catch (_) {}

    const pdf = await page.pdf({
      format,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "12mm", right: "12mm", bottom: "16mm", left: "12mm", ...margin },
      displayHeaderFooter: false
    });

    return pdf;
  } finally {
    if (browser) await browser.close();
  }
}

/** Main PDF endpoint */
app.post("/pdf", async (req, res) => {
  const { html, baseURL = null, format = "Letter", margin = {}, filename = "document.pdf", forceSystemFonts = false } = req.body || {};
  if (!html || typeof html !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'html' field" });
  }

  console.log(`[PDF] in html bytes=${Buffer.byteLength(html, "utf8")} format=${format} forceSystemFonts=${!!forceSystemFonts}`);

  try {
    const pdf = await renderPdfFromHtml({ html, baseURL, format, margin, filename, forceSystemFonts });
    console.log(`[PDF] out bytes=${pdf.length}`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    return res.status(200).send(pdf);
  } catch (err) {
    console.error("PDF rendering failed:", err);
    return res.status(500).json({ error: "PDF rendering failed", details: String(err?.message ?? err) });
  }
});

/** Hardcoded self-test (proves Chromium can render text) */
app.get("/selftest", async (_req, res) => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font:16px/1.4 Arial,sans-serif} h1{color:#3a47ff}
  </style></head><body>
  <h1>Selftest OK</h1><p>This PDF proves Chromium can render text.</p></body></html>`;
  try {
    const pdf = await renderPdfFromHtml({ html, filename: "selftest.pdf", forceSystemFonts: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="selftest.pdf"`);
    res.status(200).send(pdf);
  } catch (e) {
    res.status(500).json({ error: "Selftest failed", details: String(e?.message ?? e) });
  }
});

/** Screenshot debugger: lets us compare what Chromium rendered before PDF step */
app.post("/pdf-debug", async (req, res) => {
  const { html, baseURL = null, forceSystemFonts = false } = req.body || {};
  if (!html || typeof html !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'html' field" });
  }
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ baseURL: baseURL || undefined });
    attachDebug(page);
    await page.emulateMedia({ media: "screen" });
    await page.addStyleTag({ content: VISIBILITY_CSS });
    if (forceSystemFonts) await page.addStyleTag({ content: SYSTEM_FONT_CSS });
    await page.setContent(html, { waitUntil: "networkidle", timeout: 30000 });
    try { await page.evaluateHandle("document.fonts && document.fonts.ready"); } catch (_) {}

    const png = await page.screenshot({ fullPage: true, type: "png" });
    const b64 = Buffer.from(png).toString("base64");
    res.status(200).json({ screenshot_base64: b64, html_len: html.length });
  } catch (e) {
    res.status(500).json({ error: "pdf-debug failed", details: String(e?.message ?? e) });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PDF server listening on :${PORT}`));
