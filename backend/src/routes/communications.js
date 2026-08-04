import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { fileURLToPath } from 'url';
import { sendMail } from '../services/mailService.js';
import { newId } from '../util.js';

const router = express.Router();

const BROADCAST_WRITE = [...new Set([...ROLE_GROUPS.REIA_WRITE, ...ROLE_GROUPS.TRADING_WRITE])];
const BOARD_AUDIENCES = ['ALL', 'INTERNAL', 'SELLERS', 'BUYERS'];
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UPLOAD_DIR = path.join(__dirname, '../../uploads/communications');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function resolveRecipients(targetGroups) {
  let groups = [];
  try {
    groups = typeof targetGroups === 'string' ? JSON.parse(targetGroups) : targetGroups;
    if (!Array.isArray(groups)) groups = [String(targetGroups)];
  } catch {
    groups = [String(targetGroups)];
  }

  const users = db.prepare('SELECT id, name, email, role, linked_entity_id FROM users WHERE is_active = 1').all();
  const entities = db.prepare('SELECT id, name, corporate_email as email, entity_type, category FROM entities WHERE status = "APPROVED"').all();

  const recipientMap = new Map();

  for (const g of groups) {
    if (g === 'client_sjvn' || g === 'portfolio') {
      users.filter(u => ['SJVN_ADMIN', 'REIA_USER', 'TRADING_USER', 'FINANCE_USER', 'MANAGEMENT'].includes(u.role)).forEach(u => recipientMap.set(u.email, u));
    }
    if (g === 'client_ntpc') {
      entities.filter(e => e.entity_type === 'SELLER' || (e.name && e.name.toLowerCase().includes('ntpc'))).forEach(e => recipientMap.set(e.email, { id: e.id, name: e.name, email: e.email, role: 'SELLER' }));
      users.filter(u => u.role === 'SELLER').forEach(u => recipientMap.set(u.email, u));
    }
    if (g === 'client_discom') {
      entities.filter(e => e.entity_type === 'BUYER' || (e.name && e.name.toLowerCase().includes('discom'))).forEach(e => recipientMap.set(e.email, { id: e.id, name: e.name, email: e.email, role: 'BUYER' }));
      users.filter(u => u.role === 'BUYER').forEach(u => recipientMap.set(u.email, u));
    }
    if (g === 'role_trader' || g === 'role') {
      users.filter(u => ['TRADING_USER', 'TRADING_CLIENT'].includes(u.role)).forEach(u => recipientMap.set(u.email, u));
    }
    if (g === 'role_plant') {
      users.filter(u => ['REIA_USER', 'SELLER'].includes(u.role)).forEach(u => recipientMap.set(u.email, u));
    }
    if (g === 'role_billing') {
      users.filter(u => ['FINANCE_USER', 'BUYER'].includes(u.role)).forEach(u => recipientMap.set(u.email, u));
    }
    if (g.startsWith('reg_') || g === 'region') {
      users.forEach(u => recipientMap.set(u.email, u));
      entities.forEach(e => recipientMap.set(e.email, { id: e.id, name: e.name, email: e.email, role: e.entity_type }));
    }
  }

  // Fallback: if no specific group matched, send to all internal + active clients
  if (recipientMap.size === 0) {
    users.forEach(u => recipientMap.set(u.email, u));
    entities.forEach(e => recipientMap.set(e.email, { id: e.id, name: e.name, email: e.email, role: e.entity_type }));
  }

  return Array.from(recipientMap.values()).filter(r => r.email && r.email.includes('@'));
}

// POST /api/communications/broadcast
router.post('/broadcast', requireAuth, requireRole(...BROADCAST_WRITE), upload.array('files', 10), async (req, res) => {
  try {
    const { subject, body_html, target_groups, channels } = req.body;
    
    if (!subject || !body_html || !target_groups) {
      return res.status(400).json({ error: 'Missing required fields (subject, body, target_groups)' });
    }

    const parsedChannels = channels ? (typeof channels === 'string' ? JSON.parse(channels) : channels) : ['email', 'in_app'];
    const attachmentPaths = req.files ? req.files.map(f => `/uploads/communications/${f.filename}`) : [];
    const logId = `comm_${uuidv4().replace(/-/g, '').substring(0, 16)}`;

    // Store in communication logs
    db.prepare(`
      INSERT INTO communication_logs (id, subject, body_html, sender_id, target_groups, channels, attachment_paths)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId, 
      subject, 
      body_html, 
      req.user.id, 
      typeof target_groups === 'string' ? target_groups : JSON.stringify(target_groups), 
      JSON.stringify(parsedChannels),
      JSON.stringify(attachmentPaths)
    );

    const recipients = resolveRecipients(target_groups);
    const emailList = recipients.map(r => r.email).filter(Boolean);

    let emailResult = { ok: false, mode: 'SKIPPED', recipients_count: 0 };
    if (parsedChannels.includes('email') && emailList.length > 0) {
      const mailAttachments = (req.files || []).map(f => ({
        filename: f.originalname || f.filename,
        path: f.path,
        contentType: f.mimetype,
      }));

      emailResult = await sendMail({
        to: emailList,
        subject: `[SJVN Trading Broadcast] ${subject}`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 680px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <div style="background: #003366; color: #ffffff; padding: 18px 24px;">
              <h2 style="margin: 0; font-size: 18px; letter-spacing: 0.5px;">SJVN REIA & Power Trading Portal</h2>
              <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Official Operational Broadcast Communication</div>
            </div>
            <div style="padding: 24px; background: #ffffff;">
              <div style="font-size: 16px; font-weight: bold; color: #0f172a; margin-bottom: 16px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">
                ${subject}
              </div>
              <div style="font-size: 14px; color: #334155; margin-bottom: 24px;">
                ${body_html}
              </div>
              <div style="padding: 12px; background: #f8fafc; border-radius: 6px; font-size: 11px; color: #64748b;">
                <strong>Sender:</strong> ${req.user.name || 'SJVN Power Trading Desk'} (${req.user.email})<br/>
                <strong>Dispatched At:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST<br/>
                <strong>Reference ID:</strong> ${logId}
              </div>
            </div>
          </div>
        `,
        text: `${subject}\n\n${stripHtml(body_html)}\n\nSender: ${req.user.name} | Ref: ${logId}`,
        attachments: mailAttachments,
      });
      console.log(`[Email Dispatch] Bulk email '${subject}' sent to ${emailList.length} recipients (Mode: ${emailResult.mode}).`);
    }

    let inAppCount = 0;
    if (parsedChannels.includes('in_app')) {
      // 1. Post to global / filtered broadcast board
      const msgId = `bcast_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
      db.prepare(`
        INSERT INTO broadcast_messages (id, title, message, severity, audience, created_by, created_by_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        msgId,
        subject,
        body_html,
        'INFO',
        'ALL',
        req.user.id,
        req.user.name || 'System'
      );

      // 2. Insert into notifications table for recipient users for live notification bell 🔔
      const insertNotification = db.prepare(`
        INSERT INTO notifications (id, user_id, role, type, message)
        VALUES (?, ?, ?, ?, ?)
      `);

      const notifyUsers = recipients.filter(r => r.id && r.id.startsWith('USR'));
      notifyUsers.forEach(u => {
        try {
          insertNotification.run(
            `notif_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
            u.id,
            u.role || null,
            'BROADCAST',
            `[Broadcast] ${subject}`
          );
          inAppCount += 1;
        } catch { /* skip if error */ }
      });
      console.log(`[In-App Dispatch] In-app notification posted to board and ${inAppCount} user alerts.`);
    }

    res.json({
      message: 'Broadcast dispatched successfully',
      logId,
      email_status: {
        dispatched: parsedChannels.includes('email'),
        recipients_count: emailList.length,
        mode: emailResult.mode,
      },
      in_app_status: {
        dispatched: parsedChannels.includes('in_app'),
        notifications_count: inAppCount,
      }
    });
  } catch (error) {
    console.error('Error in broadcast:', error);
    res.status(500).json({ error: 'Failed to initiate broadcast: ' + (error.message || 'Server error') });
  }
});

// GET /api/communications/logs
router.get('/logs', requireAuth, (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT c.*, u.name as sender_name 
      FROM communication_logs c
      LEFT JOIN users u ON c.sender_id = u.id
      ORDER BY c.sent_at DESC
      LIMIT 100
    `).all();

    res.json(logs);
  } catch (error) {
    console.error('Error fetching communication logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// GET /api/communications/inbox
router.get('/inbox', requireAuth, (req, res) => {
  try {
    // In a real app, we would parse target_groups to match req.user.role / req.user.linked_entity_id.
    // For this prototype, we return all broadcasts that the user hasn't hidden.
    const inbox = db.prepare(`
      SELECT c.*, u.name as sender_name 
      FROM communication_logs c
      LEFT JOIN users u ON c.sender_id = u.id
      WHERE c.id NOT IN (SELECT message_id FROM user_hidden_messages WHERE user_id = ?)
      ORDER BY c.sent_at DESC
      LIMIT 100
    `).all(req.user.id);

    res.json(inbox);
  } catch (error) {
    console.error('Error fetching inbox:', error);
    res.status(500).json({ error: 'Failed to fetch inbox' });
  }
});

// POST /api/communications/inbox/hide
router.post('/inbox/hide', requireAuth, (req, res) => {
  try {
    const { message_id } = req.body;
    if (!message_id) return res.status(400).json({ error: 'Missing message_id' });

    db.prepare(`
      INSERT OR IGNORE INTO user_hidden_messages (id, user_id, message_id)
      VALUES (?, ?, ?)
    `).run(`uhm_${uuidv4().replace(/-/g, '').substring(0, 16)}`, req.user.id, message_id);

    res.json({ message: 'Message hidden successfully' });
  } catch (error) {
    console.error('Error hiding message:', error);
    res.status(500).json({ error: 'Failed to hide message' });
  }
});

export default router;
