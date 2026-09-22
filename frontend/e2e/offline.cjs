// Preloaded into the browser suite's server (node --require). Every hostname
// other than this machine fails to resolve, so no button pressed in a test can
// reach CERC, IEX, PXIL, NOAR, an SMTP relay or anything else outside.
//
// Blocking at name resolution covers every HTTP client the backend uses —
// global fetch, node-fetch and the http/https modules all resolve through dns.
const dns = require('dns');

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
const blocked = (hostname) => Object.assign(
  new Error(`outbound network is blocked in the browser suite (${hostname})`),
  { code: 'ENOTFOUND', hostname },
);

const lookup = dns.lookup;
dns.lookup = function e2eLookup(hostname, options, callback) {
  if (LOCAL.has(hostname)) return lookup.call(this, hostname, options, callback);
  const cb = typeof options === 'function' ? options : callback;
  process.nextTick(() => cb(blocked(hostname)));
  return undefined;
};

const promisesLookup = dns.promises.lookup;
dns.promises.lookup = async function e2eLookup(hostname, ...rest) {
  if (LOCAL.has(hostname)) return promisesLookup.call(this, hostname, ...rest);
  throw blocked(hostname);
};
