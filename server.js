const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.post("/pdf", async (req, res) => {
  const { html, baseURL = null, format = "Letter", margin = {}, filename = "document.pdf" } = req.body || {};
  if (!html || typeof html !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'html' field" });
  }

  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ baseURL: baseURL || undefined });

    await page.setContent(html, { waitUntil: "networkidle", timeout: 30000 });
    try { await page.evaluateHandle("document.fonts && document.fonts.ready"); } catch (_) {}

    const pdf = await page.pdf({
      format,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "12mm", right: "12mm", bottom: "16mm", left: "12mm", ...margin },
      displayHeaderFooter: false
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.status(200).send(pdf);
  } catch (err) {
    console.error("PDF rendering failed:", err);
    res.status(500).json({ error: "PDF rendering failed", details: String(err?.message ?? err) });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PDF server listening on :${PORT}`));
