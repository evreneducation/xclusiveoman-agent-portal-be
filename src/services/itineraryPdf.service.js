import puppeteer from 'puppeteer';
import sparticuzChromium from '@sparticuz/chromium';
import { env } from '../config/env.js';
import { signItineraryPdfToken, signFdItineraryPdfToken } from './auth.service.js';

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

// Puppeteer's own bundled Chromium (~170MB unpacked, full desktop build) gets
// OOM-killed on Render's small instances the moment it launches, which is why
// the PDF routes 502 there while working fine locally. We instead drive
// @sparticuz/chromium — a stripped, brotli-compressed headless build (~50MB)
// with memory-frugal flags baked into chromium.args — through the same
// Puppeteer API.
//
// Which browser binary getBrowser() launches:
//   1. PUPPETEER_EXECUTABLE_PATH, if set — always wins (a system- or
//      container-provided Chromium/Chrome).
//   2. PDF_CHROMIUM=sparticuz | bundled — explicit override of the default
//      below (e.g. force the bundled full Chrome on a Linux box for headful
//      debugging).
//   3. Default: @sparticuz/chromium on Linux — that's Render *and* a
//      Linux/WSL/Docker dev box, so local matches production exactly. On
//      Windows/macOS it falls back to Puppeteer's bundled Chromium, since
//      @sparticuz ships a Linux-only binary that can't execute there.
const chromiumChoice =
  process.env.PDF_CHROMIUM ||
  (process.platform === 'linux' ? 'sparticuz' : 'bundled');

async function getLaunchOptions() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    };
  }
  if (chromiumChoice === 'sparticuz') {
    // Disables WebGL/graphics stack — this only ever renders a static print
    // page to PDF, and it shaves more resident memory on constrained hosts.
    sparticuzChromium.setGraphicsMode = false;
    return {
      // The @sparticuz build is a headless-only Chromium (built from
      // headless.gn, no GUI) — 'shell' is the mode it supports.
      headless: 'shell',
      // chromium.args already includes --no-sandbox, --disable-setuid-sandbox,
      // --disable-dev-shm-usage, --disable-gpu, --single-process, etc.
      args: sparticuzChromium.args,
      executablePath: await sparticuzChromium.executablePath(),
    };
  }
  return {
    headless: true,
    // --no-sandbox is the standard flag for running Chromium as root inside
    // most containerized hosts (Docker et al.) — without it the sandbox setup
    // Chromium wants often fails to initialize there. Safe here since this
    // only ever renders our own frontend, never arbitrary/third-party URLs.
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = getLaunchOptions()
      .then((opts) => puppeteer.launch(opts))
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

/**
 * Same flow as generateItineraryPdf above, for one FD package's departure
 * itinerary (DepartureDetail.jsx's "Download Itinerary" button) instead of a
 * Custom FIT package_request — renders agent/pages/DepartureItineraryPrint.jsx
 * (which wraps agent/components/FdItineraryDocument.jsx unchanged), sharing
 * this same Chromium instance rather than launching a second one. `userId` is
 * embedded in the short-lived FD pdfToken the print page uses to
 * authenticate its own data fetch (see requireFdPdfToken/
 * departures.controller.js#getDepartureDataForPdf) — the caller
 * (downloadDepartureItineraryPdf) has already verified this departure is
 * published/exists before calling this.
 */
export async function generateFdItineraryPdf({ departureId, userId }) {
  const pdfToken = signFdItineraryPdfToken({ userId, departureId });
  const printUrl = `${env.agentPortalUrl}/departures/${departureId}/print?pdfToken=${encodeURIComponent(pdfToken)}`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1240, height: 1754 });
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: RENDER_TIMEOUT_MS });
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

    return Buffer.from(pdfData);
  } finally {
    await page.close().catch(() => {});
  }
}
