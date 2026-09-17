const {
  randomUUID
} = require('node:crypto');

function newId() {
  return randomUUID();
}

module.exports.newId = newId;
