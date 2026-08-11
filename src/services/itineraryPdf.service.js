import puppeteer from 'puppeteer';
import { env } from '../config/env.js';
import { signItineraryPdfToken } from './auth.service.js';

// Server-side itinerary PDF generation — renders the *actual* agent frontend
// (agent/pages/ItineraryPrint.jsx, which wraps the existing
// agent/components/ItineraryDocument.jsx unchanged) in a real headless
// Chromium via Puppeteer, then exports that render to PDF. This replaces the
// old window.print()-in-the-agent's-own-browser flow: browser/OS print
// engines apply their own stylesheet (backgrounds stripped unless
// "background graphics" is on, different flex/grid rounding, forced margins/
// headers), which is why the old PDF drifted from the on-screen Tailwind
// design. Puppeteer instead uses the same Chromium rendering path the design
// was built against, deterministically, regardless of which browser/OS the
// agent who clicked "Download PDF" happens to be running.
//
// Doesn't duplicate ItineraryDocument's HTML/CSS here — Puppeteer just
// navigates to the live frontend route and captures what it renders.

// One browser instance reused across requests — launching a fresh Chromium
// process per PDF (~1-2s) would make every download noticeably slower for no
// benefit; a browser stays cheap to hold open between requests, only pages
// are created/torn down per PDF. Re-launched lazily if it ever disconnects
// (crashed, killed by the OS under memory pressure, etc.).
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        // --no-sandbox is the standard flag for running Chromium as root
        // inside most containerized hosts (Docker et al.) — without it the
        // sandbox setup Chromium wants often fails to initialize there. Safe
        // here since this only ever renders our own frontend, never
        // arbitrary/third-party URLs.
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        // Respected as-is by Puppeteer if set — lets a deployment point at a
        // system-installed Chromium/Chrome instead of the bundled one (see
        // the deployment notes in this task's summary) without any code
        // change here.
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      })
      .catch((err) => {
        browserPromise = null; // let the next call retry instead of caching a rejected launch forever
        throw err;
      });
  }
  const browser = await browserPromise;
  if (!browser.connected) {
    browserPromise = null;
    return getBrowser();
  }
  return browser;
}

// How long to wait for the print page to load + fetch its data + render +
// finish loading images, before giving up. Generous but bounded — a hung
// render (e.g. the data endpoint never responding) must fail the download
// request rather than hold the connection open indefinitely.
const RENDER_TIMEOUT_MS = 25000;

/**
 * Renders agent/pages/ItineraryPrint.jsx for one package request and returns
 * the resulting PDF as a Buffer. `userId` is embedded in the short-lived
 * pdfToken the print page uses to authenticate its own data fetch (see
 * requirePdfToken/itineraryPdfData.controller.js) — the caller
 * (downloadItineraryPdf) has already verified that user may access this
 * packageRequestId before calling this.
 */
export async function generateItineraryPdf({ packageRequestId, userId }) {
  const pdfToken = signItineraryPdfToken({ userId, packageRequestId });
  const printUrl = `${env.agentPortalUrl}/itinerary/${packageRequestId}/print?pdfToken=${encodeURIComponent(pdfToken)}`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // A wide, print-shaped viewport so the document's sm:/lg: Tailwind
    // breakpoints render the same "desktop" layout the on-screen preview
    // uses, rather than the mobile-narrow one.
    await page.setViewport({ width: 1240, height: 1754 });

    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: RENDER_TIMEOUT_MS });

    // networkidle0 only proves the network went quiet — it doesn't prove
    // React finished rendering or every <img> finished loading. The print
    // page sets window.__PDF_READY__ once both are true (see
    // ItineraryPrint.jsx), so wait for that explicit signal on top rather
    // than trusting network activity alone.
    await page.waitForFunction('window.__PDF_READY__ === true', { timeout: RENDER_TIMEOUT_MS });

    const renderError = await page.evaluate(() => window.__PDF_ERROR__ || null);
    if (renderError) {
      throw new Error(`Itinerary failed to render: ${renderError}`);
    }

    const pdfData = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    // page.pdf() resolves a Uint8Array, not a Node Buffer — Express's
    // res.send() only recognizes an actual Buffer as binary (Buffer.isBuffer),
    // otherwise it silently falls back to JSON-serializing it as
    // {"0":37,"1":80,...}. Wrap it here so every caller gets a real Buffer.
    return Buffer.from(pdfData);
  } finally {
    await page.close().catch(() => {}); // best-effort — a close failure shouldn't mask the real result/error above
  }
}
