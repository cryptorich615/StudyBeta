const crypto = require('crypto');
const { Client } = require('pg');
const salt = crypto.randomBytes(16).toString('hex');
const dk = crypto.scryptSync('Password69', salt, 64).toString('hex');
const hash = salt + ':' + dk;
const client = new Client({ connectionString: 'postgres://postgres:postgres@localhost:5432/studyclaw' });
client.connect().then(() => {
  return client.query('UPDATE users SET password_hash=$1 WHERE email=$2', [hash, 'richm430215@gmail.com']);
}).then(r => { console.log('Updated rows:', r.rowCount, '\nHash:', hash.substring(0,40)+'...'); client.end(); })
.catch(e => { console.error(e); client.end(); });
