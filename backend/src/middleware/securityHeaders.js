/**
 * HTTP security headers (GIGW 3.0 security domain, CERT-In guidelines), set on
 * every response without a dependency.
 *
 * The Content-Security-Policy allows only this origin for script — the page has
 * no inline script (the pre-paint preferences script is /prefs-boot.js) — and
 * Google Fonts for the stylesheet and font files. Inline *style* attributes are
 * allowed because React's `style={{}}` renders them; they cannot run code.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

export function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  // Browsers act on HSTS only over HTTPS, so sending it on the plain-HTTP hop
  // behind the proxy is harmless and means it is there once TLS terminates here.
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // The legacy XSS auditor did more harm than good; current guidance is to turn it off.
  res.setHeader('X-XSS-Protection', '0');
  // API answers carry account data; no shared or browser cache keeps them.
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}
