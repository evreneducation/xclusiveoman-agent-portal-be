import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Marketing Center (email channel) — a branded HTML wrapper for the plain
// subject/body an admin composes in Compose's Message card (there's no rich
// text editor there, only a Textarea). Previously every marketing email
// (Send Test and Send Campaign — marketingSend.service.js /
// marketing.controller.js) went out as unstyled plain text; this is the
// first HTML template anywhere in the backend, so it's kept generic/
// reusable (not Marketing-specific in its own code) even though today only
// Marketing's two send paths call it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A local file, not a remote/frontend URL: the same PNG the FE's own
// Login/AgentLayout/ItineraryDocument pages already use
// (xclusiveoman-agent-portal-fe/public/Xclusive_Oman_Logo_2.png, copied
// here once) — read straight off disk and attached as a real MIME part
// referenced by `cid:`, the most broadly-supported way to guarantee an
// inline image actually renders in a recipient's mail client. A hot-linked
// frontend dev-server URL wouldn't be reachable by anyone but this machine,
// and Outlook's desktop (Word-engine) renderer doesn't reliably support
// base64 data-URI images the way browsers do.
export const LOGO_ATTACHMENT_PATH = path.resolve(__dirname, '..', 'assets', 'xclusive-oman-logo.png');
const LOGO_CID = 'xclusive-oman-logo';

// Same brand tokens as the admin/agent frontends' own Tailwind config
// (tailwind.config.js: ink #16233f, accent #d1642f, accent-soft #fbe1cf) —
// a branded email should read as the same product, not a mismatched
// one-off palette invented just for this template.
const INK = '#16233f';
const ACCENT = '#d1642f';
const ACCENT_SOFT = '#fbe1cf';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Task 11 (Open & Click Tracking) — Compose's Message body has no rich text
// editor, so a URL an admin types is otherwise just escaped plain text,
// never a real, clickable link; without auto-linkifying it first, click
// tracking would have nothing to ever track for a real campaign. Matches
// bare http(s) URLs and trims a handful of common trailing
// sentence/closing punctuation characters that would otherwise get pulled
// into the link target (e.g. "see https://x.com." shouldn't link to
// "https://x.com.").
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

function stripTrailingPunctuation(url) {
  return url.replace(TRAILING_PUNCTUATION, '');
}

// A marker unlikely to ever occur naturally in an admin-typed message and,
// being plain letters/digits, passes through escapeHtml() completely
// unchanged — so it survives the paragraph-building pass below intact and
// can be swapped for a real anchor tag afterward, without needing to touch
// (or re-parse) already-escaped HTML.
function linkToken(index) {
  return `##XCLTRACKLINK${index}##`;
}

// Finds every URL in the raw body text (before any HTML escaping) and
// replaces each with a numbered token; `links[i]` is the real destination
// for `linkToken(i)`. Kept as its own pass over the *whole* body (not
// per-paragraph) so link numbering stays correct across paragraph breaks.
function extractLinks(bodyText) {
  const links = [];
  const tokenized = String(bodyText || '').replace(URL_PATTERN, (rawUrl) => {
    links.push(stripTrailingPunctuation(rawUrl));
    return linkToken(links.length - 1);
  });
  return { tokenized, links };
}

// Compose's Message body (already link-tokenized above) -> safe HTML: one
// <p> per blank-line-separated block, single line breaks within a block
// preserved as <br>. The raw string (aside from the link tokens, which are
// plain alphanumerics) is never trusted as HTML; every character is
// escaped before any tag goes around it, so a body containing "<" or "&"
// (or an attempted script tag) can never alter the template's markup.
function textToHtmlParagraphs(tokenizedText) {
  const blocks = tokenizedText.split(/\n{2,}/).filter((b) => b.trim().length > 0);
  if (blocks.length === 0) return '';
  return blocks
    .map(
      (block) =>
        `<p style="margin:0 0 16px; font-size:14px; line-height:1.6; color:${INK};">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`
    )
    .join('');
}

// Turns each `##XCLTRACKLINKn##` token left over from extractLinks/
// textToHtmlParagraphs above into a real anchor tag — `{{TRACK_LINK_n}}` is
// left as the `href` placeholder, resolved per-recipient afterward by
// resolveTrackedLinks() below (Send Campaign) or straight to the real URL
// (Send Test, which has no recipient to track — see marketing.controller.js
// #sendTest's own comment).
function insertLinkAnchors(html, links) {
  return html.replace(/##XCLTRACKLINK(\d+)##/g, (_, idxStr) => {
    const idx = Number(idxStr);
    const url = links[idx];
    if (url === undefined) return '';
    return `<a href="{{TRACK_LINK_${idx}}}" style="color:${ACCENT}; text-decoration:underline;">${escapeHtml(url)}</a>`;
  });
}

/**
 * Wraps a plain subject + body into a branded HTML email — table-based
 * layout with only inline styles (email clients, unlike browsers, don't
 * reliably support external/`<style>` CSS; Outlook's Word engine in
 * particular), a single ~600px column, logo header, accent divider, and a
 * light branded footer.
 *
 * Returns `{ html, attachments, links }`. `attachments` must be passed
 * straight through to email.service.js#sendEmail's own `attachments` param
 * alongside `html` — otherwise the `cid:` logo reference resolves to
 * nothing. `html` contains `{{TRACK_LINK_0}}`, `{{TRACK_LINK_1}}`, …
 * placeholders (one per entry in `links`, same order/index) wherever a URL
 * was auto-linkified from the body — resolve them with resolveTrackedLinks()
 * below before sending. There is no pixel placeholder here at all (unlike
 * links, which live inline in the body); call appendTrackingPixel()
 * separately, only when a real recipient exists to attribute the open to.
 */
export function buildMarketingEmailHtml({ subject, bodyText }) {
  const { tokenized, links } = extractLinks(bodyText);
  const bodyHtml = insertLinkAnchors(textToHtmlParagraphs(tokenized), links);

  const html = `<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#f4f4f2;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:8px; overflow:hidden; border:1px solid ${BORDER};">
            <tr>
              <td style="background:${INK}; padding:24px 32px;">
                <img src="cid:${LOGO_CID}" alt="Xclusive Oman" width="150" style="display:block; height:auto; border:0; max-width:150px;" />
              </td>
            </tr>
            <tr>
              <td style="height:4px; background:${ACCENT}; line-height:4px; font-size:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:32px; font-family:Arial, Helvetica, sans-serif;">
                ${subject ? `<h1 style="margin:0 0 20px; font-size:20px; line-height:1.35; color:${INK}; font-family:Arial, Helvetica, sans-serif;">${escapeHtml(subject)}</h1>` : ''}
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background:${ACCENT_SOFT};">
                <p style="margin:0; font-size:11px; line-height:1.6; color:${MUTED}; font-family:Arial, Helvetica, sans-serif;">
                  Xclusive Oman — B2B &amp; MICE Trade Portal. This message was sent to you as a registered Xclusive Oman trade partner.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const attachments = [
    {
      filename: 'xclusive-oman-logo.png',
      path: LOGO_ATTACHMENT_PATH,
      cid: LOGO_CID,
      contentDisposition: 'inline',
    },
  ];

  return { html, attachments, links };
}

// Resolves every `{{TRACK_LINK_n}}` placeholder buildMarketingEmailHtml()
// left in `html` to a real href, via `resolveUrl(realDestinationUrl, index)`
// — the caller decides what that resolves to: a signed click-tracking URL
// (Send Campaign — marketingSend.service.js, one call per recipient, since
// each needs its own token) or the real URL unchanged (Send Test — no
// recipient row exists to attribute a click to, so nothing to track).
export function resolveTrackedLinks(html, links, resolveUrl) {
  let out = html;
  links.forEach((url, index) => {
    out = out.split(`{{TRACK_LINK_${index}}}`).join(resolveUrl(url, index));
  });
  return out;
}

// Appends the 1x1 open-tracking pixel just before </body> — kept as its own
// step (never a placeholder baked into the base template) so a template
// with no tracking desired (Send Test) simply never calls this, rather
// than needing to strip/blank out a leftover `<img src="">` (an empty `src`
// is a real footgun in some browsers/clients, historically triggering a
// request to the current page itself). width/height are real attributes,
// not just CSS, so the pixel is genuinely 1x1 even if inline styles are
// stripped by an aggressive email client.
export function appendTrackingPixel(html, pixelUrl) {
  const pixelTag = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block; border:0;" />`;
  return html.includes('</body>') ? html.replace('</body>', `${pixelTag}</body>`) : `${html}${pixelTag}`;
}
