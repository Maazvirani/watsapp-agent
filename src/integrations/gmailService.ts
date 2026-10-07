import nodemailer from 'nodemailer';
import { config } from '../config/env';
import { db } from '../db/database';

export interface OrderEmailPayload {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  orderItems: string;
  totalAmount: number;
  confirmationToken: string;
}

export class GmailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    if (config.email.user && config.email.pass && config.email.user !== 'demo.business@gmail.com') {
      this.transporter = nodemailer.createTransport({
        host: config.email.host,
        port: config.email.port,
        secure: config.email.port === 465,
        auth: {
          user: config.email.user,
          pass: config.email.pass,
        },
      });
    }
  }

  async sendOrderConfirmationEmail(payload: OrderEmailPayload): Promise<{ success: boolean; confirmationLink: string; message: string }> {
    const confirmationLink = `${config.baseUrl}/api/orders/confirm?token=${payload.confirmationToken}`;
    const subject = `Order Confirmation Required - Order #${payload.orderNumber}`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 20px; color: #333; }
          .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          .header { background: #128C7E; color: white; padding: 24px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 24px; }
          .order-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 16px 0; }
          .btn-confirm { display: inline-block; background-color: #25D366; color: white !important; font-size: 18px; font-weight: bold; text-decoration: none; padding: 14px 32px; border-radius: 6px; margin: 20px 0; text-align: center; box-shadow: 0 4px 6px rgba(37,211,102,0.3); }
          .footer { background: #f1f5f9; padding: 16px; text-align: center; font-size: 12px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>WhatsApp Business AI Order Confirmation</h1>
          </div>
          <div class="content">
            <p>Hello <strong>${payload.customerName}</strong>,</p>
            <p>Thank you for chatting with us on WhatsApp! Your order has been placed and is currently pending your final confirmation.</p>
            
            <div class="order-card">
              <h3 style="margin-top:0;">Order Summary (#${payload.orderNumber})</h3>
              <p><strong>Items:</strong> ${payload.customerName ? payload.orderItems : 'Standard Package'}</p>
              <p><strong>Total Amount:</strong> $${payload.totalAmount.toFixed(2)}</p>
              <p><strong>Status:</strong> <span style="color: #d97706; font-weight: bold;">Pending Confirmation</span></p>
            </div>

            <p style="text-align: center; margin: 30px 0;">
              <a href="${confirmationLink}" class="btn-confirm" target="_blank">Click Here to Confirm Order</a>
            </p>
            
            <p>Once you click the button above, your order will automatically be confirmed, recorded in our system, and our team will process it immediately!</p>
          </div>
          <div class="footer">
            <p>This automated message was sent by your WhatsApp AI Business Assistant.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Always record in SQLite sent_emails table for 100% draft testability
    try {
      db.prepare(`
        INSERT INTO sent_emails (order_id, recipient, subject, body_html, confirmation_link)
        VALUES (?, ?, ?, ?, ?)
      `).run(payload.orderId, payload.customerEmail, subject, htmlContent, confirmationLink);
    } catch (err) {
      console.error('Error logging sent email to DB:', err);
    }

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: `"${config.email.user}" <${config.email.user}>`,
          to: payload.customerEmail,
          subject: subject,
          html: htmlContent,
        });
        console.log(`Real email dispatched via Gmail SMTP to ${payload.customerEmail}`);
        return { success: true, confirmationLink, message: `Confirmation email sent to ${payload.customerEmail}` };
      } catch (error: any) {
        console.error('Gmail SMTP error, falling back to draft mode:', error.message);
      }
    }

    console.log(`[DRAFT MODE EMAIL GENERATED] Recipient: ${payload.customerEmail} | Link: ${confirmationLink}`);
    return {
      success: true,
      confirmationLink,
      message: `Draft confirmation email created for ${payload.customerEmail}. You can test the confirm link in the Web Dashboard.`,
    };
  }
}

export const gmailService = new GmailService();
