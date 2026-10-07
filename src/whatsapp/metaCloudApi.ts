import { config } from '../config/env';
import { db } from '../db/database';

export interface WhatsAppInboundMessage {
  from: string; // phone number e.g. +14155552671
  name: string;
  messageId: string;
  body: string;
  timestamp: number;
}

export class MetaCloudApiService {
  verifyWebhook(mode: string | undefined, token: string | undefined, challenge: string | undefined): string | null {
    if (mode === 'subscribe' && token === config.meta.verifyToken) {
      console.log('Meta WhatsApp Webhook verified successfully!');
      return challenge || null;
    }
    return null;
  }

  parseInboundMessage(body: any): WhatsAppInboundMessage | null {
    try {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (!message) return null;

      const contact = value?.contacts?.[0];
      return {
        from: message.from,
        name: contact?.profile?.name || 'Customer',
        messageId: message.id,
        body: message.text?.body || '',
        timestamp: parseInt(message.timestamp || `${Date.now() / 1000}`, 10),
      };
    } catch (err) {
      console.error('Error parsing WhatsApp inbound message:', err);
      return null;
    }
  }

  async sendWhatsAppMessage(to: string, messageText: string): Promise<boolean> {
    // Log outbound assistant message to conversation store
    try {
      db.prepare(`
        INSERT INTO conversations (phone, role, content)
        VALUES (?, 'assistant', ?)
      `).run(to, messageText);
    } catch (err) {
      console.error('Error logging WhatsApp assistant message to DB:', err);
    }

    if (config.meta.whatsappToken && config.meta.phoneNumberId && config.meta.phoneNumberId !== 'demo_phone_id') {
      try {
        const url = `https://graph.facebook.com/v21.0/${config.meta.phoneNumberId}/messages`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.meta.whatsappToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: to,
            type: 'text',
            text: { body: messageText },
          }),
        });

        if (response.ok) {
          console.log(`WhatsApp message sent to ${to} via Meta Cloud API.`);
          return true;
        } else {
          const errorData = await response.json();
          console.error('Meta WhatsApp API error response:', errorData);
        }
      } catch (err: any) {
        console.error('Error calling Meta WhatsApp Graph API:', err.message);
      }
    }

    console.log(`[WHATSAPP SIMULATOR OUTBOUND] To: ${to} | Message: "${messageText}"`);
    return true;
  }
}

export const metaCloudApi = new MetaCloudApiService();
