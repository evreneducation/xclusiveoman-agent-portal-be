function buildWhatsAppLink(e164Number, message) {
  const digitsOnly = (e164Number || '').replace(/[^\d]/g, '');
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`;
}

module.exports.buildWhatsAppLink = buildWhatsAppLink;
