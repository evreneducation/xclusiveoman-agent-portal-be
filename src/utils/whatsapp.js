// Rule 72: https://wa.me/<e164_number>?text=<url_encoded_message>
// MVP scope only needs the deep link — no WhatsApp Business API calls (doc §3.2).
export function buildWhatsAppLink(e164Number, message) {
  const digitsOnly = (e164Number || '').replace(/[^\d]/g, '');
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`;
}
