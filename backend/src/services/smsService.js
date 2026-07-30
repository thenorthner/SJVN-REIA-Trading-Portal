/**
 * SMS delivery via the TextGuru gateway.
 *
 * Mirrors mailService: when the gateway is configured and SMS is switched on it
 * sends for real; otherwise it writes the message to backend/outbox/ so the
 * flow can be built and tested without credentials. Credentials come from env
 * or master data — never from code.
 */
import fs from 'fs';
import path from 'path';
import { getParam } from '../mastersService.js';

const OUTBOX_DIR = path.join(process.cwd(), 'outbox');

function envOrParam(envKey, paramKey, fallback = '') {
  if (process.env[envKey]) return process.env[envKey];
  try {
    const v = getParam(paramKey, null);
    if (v != null && v !== '') return String(v);
  } catch { /* masters may not be ready at boot */ }
  return fallback;
}

export function getSmsConfig() {
  const apiKey = envOrParam('TEXTGURU_API_KEY', 'textguru_api_key', '');
  const senderId = envOrParam('TEXTGURU_SENDER', 'textguru_sender_id', '');
  const baseUrl = envOrParam('TEXTGURU_URL', 'textguru_url', 'https://www.textguru.in/api/');
  // The gateway is only "live" when explicitly enabled AND keyed. Either off
  // and it stays in outbox mode, so a stray true can't start billing SMS.
  const enabled = String(envOrParam('SMS_ENABLED', 'sms_enabled', 'false')) === 'true';
  return { enabled, live: enabled && !!apiKey, apiKey, senderId, baseUrl };
}

/**
 * Reduce a number to the 10-digit Indian mobile the gateway expects, dropping
 * +91/91/0 prefixes and any spacing. Returns null if it is not a plausible
 * 10-digit mobile, so junk never reaches the gateway.
 */
export function normalizeInPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  let n = digits;
  if (n.length === 12 && n.startsWith('91')) n = n.slice(2);
  else if (n.length === 11 && n.startsWith('0')) n = n.slice(1);
  return /^[6-9]\d{9}$/.test(n) ? n : null;
}

function ensureOutbox() {
  if (!fs.existsSync(OUTBOX_DIR)) fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  return OUTBOX_DIR;
}

/**
 * @param {{ to: string, text: string, templateId?: string }} opts
 * @returns {Promise<{ ok: boolean, mode: string, to?: string, provider_ref?: string, error?: string }>}
 */
export async function sendSms(opts) {
  const cfg = getSmsConfig();
  const to = normalizeInPhone(opts.to);
  if (!to) return { ok: false, mode: 'NONE', error: `Not a valid Indian mobile number: ${opts.to}` };
  const text = String(opts.text || '').trim();
  if (!text) return { ok: false, mode: 'NONE', error: 'Empty SMS body' };

  if (cfg.live) {
    try {
      const params = new URLSearchParams({
        APIKEY: cfg.apiKey,
        senderid: cfg.senderId,
        number: to,
        message: text,
        format: 'json',
      });
      if (opts.templateId) params.set('templateid', opts.templateId);
      const resp = await fetch(`${cfg.baseUrl}?${params.toString()}`);
      const body = await resp.text();
      if (!resp.ok) return { ok: false, mode: 'TEXTGURU', to, error: `HTTP ${resp.status}: ${body.slice(0, 200)}` };
      // TextGuru echoes a message id / status string; keep it as the provider ref.
      return { ok: true, mode: 'TEXTGURU', to, provider_ref: body.slice(0, 120) };
    } catch (err) {
      return { ok: false, mode: 'TEXTGURU', to, error: err.message };
    }
  }

  // Dev / not-yet-configured fallback: record the SMS in the outbox.
  const dir = ensureOutbox();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const metaPath = path.join(dir, `${stamp}_SMS_${to}.json`);
  fs.writeFileSync(metaPath, JSON.stringify({
    at: new Date().toISOString(),
    mode: 'FILE_OUTBOX',
    channel: 'SMS',
    to,
    sender_id: cfg.senderId || null,
    template_id: opts.templateId || null,
    text,
    note: cfg.enabled
      ? 'SMS enabled but textguru_api_key not set — written to outbox instead of sent.'
      : 'SMS disabled (sms_enabled != true) — written to outbox instead of sent.',
  }, null, 2));

  return { ok: true, mode: 'FILE_OUTBOX', to, provider_ref: path.basename(metaPath) };
}
