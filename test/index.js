const testAdapter = require('./unit/adapter');
const adapter = require('../src');

require('dotenv').config();

testAdapter(adapter, {
  loginUrl: process.env.SF_LOGIN_URL,
  username: process.env.SF_USERNAME,
  password: process.env.SF_PASSWORD,
  version: process.env.SF_API_VERSION,
});
