const assert = require('node:assert/strict');
assert.equal(process.env.NODE_ENV, 'test');
const state = { messages: [], failNext: false };
const path = require.resolve('../helpers/sendEmail');
require.cache[path] = { id: path, filename: path, loaded: true, exports: async message => {
  state.messages.push(message);
  if (state.failNext) { state.failNext = false; throw new Error('fixture mail failure'); }
} };
module.exports = state;
