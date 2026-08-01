import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { fileURLToPath } from 'url';

const router = express.Router();

// Sending a mass email / in-app broadcast is an outward-facing act. Without this
// every authenticated user — including seller, buyer and trading-client
// counterparties — could mail every group on the platform.
const BROADCAST_WRITE = [...new Set([...ROLE_GROUPS.REIA_WRITE, ...ROLE_GROUPS.TRADING_WRITE])];

// broadcast_messages.audience is read back by alerts.js with
// `audience IN ('ALL','INTERNAL','SELLERS','BUYERS')`, so an arbitrary
// target_groups string here would produce a message the board can never show.
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
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit for emails
});

// POST /api/communications/broadcast
router.post('/broadcast', requireAuth, requireRole(...BROADCAST_WRITE), upload.array('files', 10), async (req, res) => {
  try {
    const { subject, body_html, target_groups, channels } = req.body;
    
    if (!subject || !body_html || !target_groups) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const parsedChannels = channels ? JSON.parse(channels) : ['email'];
    const attachmentPaths = req.files ? req.files.map(f => `/uploads/communications/${f.filename}`) : [];
    const logId = `comm_${uuidv4().replace(/-/g, '').substring(0, 16)}`;

    db.prepare(`
      INSERT INTO communication_logs (id, subject, body_html, sender_id, target_groups, channels, attachment_paths)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId, 
      subject, 
      body_html, 
      req.user.id, 
      target_groups, 
      JSON.stringify(parsedChannels),
      JSON.stringify(attachmentPaths)
    );

    if (parsedChannels.includes('email')) {
      // TODO: Actually dispatch emails using Nodemailer
      console.log(`[Email Mock] Dispatched bulk email '${subject}' with ${attachmentPaths.length} attachments.`);
    }

    if (parsedChannels.includes('in_app')) {
      // Insert global broadcast message for In-App channel
      const msgId = `bcast_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
      db.prepare(`
        INSERT INTO broadcast_messages (id, title, message, severity, audience, created_by, created_by_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        msgId,
        subject,
        body_html,
        'INFO',
        BOARD_AUDIENCES.includes(target_groups) ? target_groups : 'INTERNAL',
        req.user.id,
        req.user.name || 'System'
      );
      console.log(`[In-App Mock] Dispatched in-app broadcast '${subject}'.`);
    }

    res.json({ message: 'Broadcast initiated successfully', logId });
  } catch (error) {
    console.error('Error in broadcast:', error);
    res.status(500).json({ error: 'Failed to initiate broadcast' });
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
