import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config/env';
import { initDatabase, db } from './db/database';
import { metaCloudApi } from './whatsapp/metaCloudApi';
import { aiAgent } from './ai/agent';
import { googleSheetsService } from './integrations/googleSheetsService';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Initialize SQLite database
initDatabase();

// ==========================================
// 1. Meta WhatsApp Cloud API Webhook Routes
// ==========================================

// Webhook Verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  const result = metaCloudApi.verifyWebhook(mode, token, challenge);
  if (result) {
    res.status(200).send(result);
  } else {
    res.sendStatus(403);
  }
});

// Webhook Event Receiver (POST)
app.post('/webhook', async (req, res) => {
  // Always return 200 OK fast to Meta
  res.sendStatus(200);

  const parsedMsg = metaCloudApi.parseInboundMessage(req.body);
  if (!parsedMsg) return;

  console.log(`Received Meta WhatsApp message from ${parsedMsg.from} (${parsedMsg.name}): "${parsedMsg.body}"`);

  // Process message through AI Agent
  const aiReply = await aiAgent.processCustomerMessage(parsedMsg.from, parsedMsg.name, parsedMsg.body);

  // Send WhatsApp message back to customer
  await metaCloudApi.sendWhatsAppMessage(parsedMsg.from, aiReply);
});

// ==========================================
// 2. Email Order Confirmation Link Endpoint
// ==========================================
app.get('/api/orders/confirm', async (req, res) => {
  const token = req.query.token as string;
  if (!token) {
    return res.status(400).send('<h1>Invalid Request</h1><p>Missing confirmation token.</p>');
  }

  const order = db.prepare(`SELECT * FROM orders WHERE token = ?`).get(token) as any;
  if (!order) {
    return res.status(404).send('<h1>Order Not Found</h1><p>The confirmation link is invalid or expired.</p>');
  }

  const nowIso = new Date().toISOString();

  if (order.status !== 'CONFIRMED') {
    // Update order in database
    db.prepare(`
      UPDATE orders 
      SET status = 'CONFIRMED', confirmed_at = ? 
      WHERE id = ?
    `).run(nowIso, order.id);

    // Send automated WhatsApp confirmation notification back to customer
    const confirmMessage = `✅ *ORDER CONFIRMED!*

Hello *${order.customer_name}*, thank you for confirming Order *#${order.order_number}*!
We have received your email confirmation. Your order for *${order.order_items}* ($${order.total_amount.toFixed(2)}) is now officially locked in.

Our Google Sheets and fulfillment system have been automatically updated! 🚀`;

    await metaCloudApi.sendWhatsAppMessage(order.customer_phone, confirmMessage);

    // Sync updated CONFIRMED status to Google Sheets
    await googleSheetsService.syncOrderToSheet({
      orderNumber: order.order_number,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      customerEmail: order.customer_email,
      orderItems: order.order_items,
      totalAmount: order.total_amount,
      status: 'CONFIRMED',
      createdAt: order.created_at,
      confirmedAt: nowIso,
    });
  }

  // Render Confirmation Landing Page
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Order Confirmed | WhatsApp AI Business</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 40px; text-align: center; max-width: 500px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
        .icon { font-size: 64px; margin-bottom: 20px; }
        h1 { color: #22c55e; margin: 0 0 10px 0; font-size: 28px; }
        p { color: #94a3b8; font-size: 16px; line-height: 1.6; }
        .order-box { background: #0f172a; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: left; }
        .badge { display: inline-block; background: #22c55e; color: #022c22; font-weight: bold; padding: 4px 12px; border-radius: 9999px; font-size: 12px; text-transform: uppercase; }
        .btn-dashboard { display: inline-block; background: #3b82f6; color: white; text-decoration: none; font-weight: bold; padding: 12px 24px; border-radius: 6px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">✅</div>
        <h1>Order Confirmed!</h1>
        <p>Thank you, <strong>${order.customer_name}</strong>. Your order has been successfully verified and confirmed.</p>
        
        <div class="order-box">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
            <strong style="color:#f8fafc;">Order #${order.order_number}</strong>
            <span class="badge">CONFIRMED</span>
          </div>
          <p style="margin: 4px 0; font-size: 14px;">Items: ${order.order_items}</p>
          <p style="margin: 4px 0; font-size: 14px;">Total: $${order.total_amount.toFixed(2)}</p>
        </div>

        <p>A notification has been sent to your WhatsApp number (<strong>${order.customer_phone}</strong>) and your Google Sheets record has been updated live!</p>
        <a href="/" class="btn-dashboard">Back to Business Dashboard</a>
      </div>
    </body>
    </html>
  `);
});

// ==========================================
// 3. WhatsApp Web Simulator API (For Browser Testing)
// ==========================================
app.post('/api/sim/whatsapp', async (req, res) => {
  const { phone = '+14155552671', name = 'Alex Johnson', message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Process customer message through AI Agent
  const aiReply = await aiAgent.processCustomerMessage(phone, name, message);

  // Send reply (logged in conversations table)
  await metaCloudApi.sendWhatsAppMessage(phone, aiReply);

  // Return fresh state to simulator dashboard
  const conversations = db.prepare(`SELECT * FROM conversations WHERE phone = ? ORDER BY id ASC`).all(phone);
  const orders = db.prepare(`SELECT * FROM orders ORDER BY created_at DESC`).all();
  const sentEmails = db.prepare(`SELECT * FROM sent_emails ORDER BY id DESC`).all();
  const sheetsLog = db.prepare(`SELECT * FROM sheets_log ORDER BY id DESC`).all();

  res.json({
    reply: aiReply,
    conversations,
    orders,
    sentEmails,
    sheetsLog,
  });
});

// ==========================================
// 4. Dashboard Data APIs
// ==========================================
app.get('/api/dashboard/stats', (req, res) => {
  const totalOrders = (db.prepare(`SELECT COUNT(*) as count FROM orders`).get() as any).count;
  const pendingOrders = (db.prepare(`SELECT COUNT(*) as count FROM orders WHERE status = 'PENDING_CONFIRMATION'`).get() as any).count;
  const confirmedOrders = (db.prepare(`SELECT COUNT(*) as count FROM orders WHERE status = 'CONFIRMED'`).get() as any).count;
  const sentEmailsCount = (db.prepare(`SELECT COUNT(*) as count FROM sent_emails`).get() as any).count;
  const sheetsSyncedCount = (db.prepare(`SELECT COUNT(*) as count FROM sheets_log`).get() as any).count;

  res.json({
    totalOrders,
    pendingOrders,
    confirmedOrders,
    sentEmailsCount,
    sheetsSyncedCount,
    mockMode: config.enableMockMode,
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

app.get('/api/dashboard/orders', (req, res) => {
  const orders = db.prepare(`SELECT * FROM orders ORDER BY created_at DESC`).all();
  res.json(orders);
});

app.get('/api/dashboard/emails', (req, res) => {
  const emails = db.prepare(`SELECT * FROM sent_emails ORDER BY id DESC`).all();
  res.json(emails);
});

app.get('/api/dashboard/sheets', (req, res) => {
  const sheets = db.prepare(`SELECT * FROM sheets_log ORDER BY id DESC`).all();
  res.json(sheets);
});

app.get('/api/dashboard/conversations', (req, res) => {
  const phone = (req.query.phone as string) || '+14155552671';
  const conversations = db.prepare(`SELECT * FROM conversations WHERE phone = ? ORDER BY id ASC`).all(phone);
  res.json(conversations);
});

// Start Express Server
app.listen(config.port, () => {
  console.log(`====================================================`);
  console.log(`🚀 24/7 WhatsApp AI Business Server is Running!`);
  console.log(`📍 Local Dashboard & Webhook URL: ${config.baseUrl}`);
  console.log(`📲 Meta WhatsApp Webhook Endpoint: ${config.baseUrl}/webhook`);
  console.log(`✉️ Email Confirmation Endpoint: ${config.baseUrl}/api/orders/confirm`);
  console.log(`====================================================`);
});
