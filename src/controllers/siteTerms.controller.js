const {
  siteTermsModel
} = require('../models/siteTerms.model.js');

async function getSiteTerms(req, res, next) {
  try {
    const row = await siteTermsModel.get();
    res.json({ terms: row });
  } catch (err) {
    next(err);
  }
}

module.exports.getSiteTerms = getSiteTerms;

async function updateSiteTerms(req, res, next) {
  try {
    const row = await siteTermsModel.upsert(req.body.bodyHtml);
    res.json({ terms: row });
  } catch (err) {
    next(err);
  }
}

module.exports.updateSiteTerms = updateSiteTerms;
