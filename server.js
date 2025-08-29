/* server.js - Playwright PDF microservice (debug build) */
const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json({ limit: "20mb" }));

// Health
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

/** Launch Chromium with Docker-safe flags */
async function launchBrowser() {
  return chromium.launch({
    // --no-sandbox is common for containers; --disable-dev-shm-usage avoids blank renders on low /dev/shm
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

/** Core render to PDF */
async function renderPdfFromHtml({ html, baseURL, format = "Letter", margin = {}, filename = "document.pdf" }) {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ baseURL: baseURL || undefined });

    // Force screen CSS to dodge hostile @media print rules
    await page.emulateMedia({ media: "screen" });

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
  const { html, baseURL = null, format = "Letter", margin = {}, filename = "document.pdf" } = req.body || {};
  if (!html || typeof html !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'html' field" });
  }

  console.log(`[PDF] in html bytes=${Buffer.byteLength(html, "utf8")}, format=${format}`);

  try {
    const pdf = await renderPdfFromHtml({ html, baseURL, format, margin, filename });
    console.log(`[PDF] out bytes=${pdf.length}`);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.status(200).send(pdf);
  } catch (err) {
    console.error("PDF rendering failed:", err);
    res.status(500).json({ error: "PDF rendering failed", details: String(err?.message ?? err) });
  }
});

/** SELFTEST: hardcoded HTML → PDF (no inputs, isolates service) */
app.get("/selftest", async (_req, res) => {
  const html = `<!doctype html><html><head><meta charset="utf-8">
  <style>body{font:16px/1.4 Arial,sans-serif} h1{color:#3a47ff}</style></head>
  <body><h1>Selftest OK</h1><p>This PDF proves Chromium can render text.</p></body></html>`;
  try {
    const pdf = await renderPdfFromHtml({ html, filename: "selftest.pdf" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="selftest.pdf"`);
    res.status(200).send(pdf);
  } catch (e) {
    res.status(500).json({ error: "Selftest failed", details: String(e?.message ?? e) });
  }
});

/** DEBUG: returns a screenshot + echoes HTML (to compare with PDF) */
app.post("/pdf-debug", async (req, res) => {
  const { html, baseURL = null } = req.body || {};
  if (!html || typeof html !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'html' field" });
  }

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ baseURL: baseURL || undefined });
    await page.emulateMedia({ media: "screen" });
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
