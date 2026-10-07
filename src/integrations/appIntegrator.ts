import { config } from '../config/env';

export interface AppWebhookPayload {
  eventName: 'ORDER_CREATED' | 'ORDER_CONFIRMED' | 'CUSTOMER_LEAD' | 'CUSTOM_EVENT';
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  details: any;
  timestamp: string;
}

export class AppIntegratorService {
  private zapierWebhookUrl: string = process.env.ZAPIER_WEBHOOK_URL || '';
  private makeWebhookUrl: string = process.env.MAKE_WEBHOOK_URL || '';
  private customWebhookUrl: string = process.env.CUSTOM_WEBHOOK_URL || '';

  async triggerAllApps(payload: AppWebhookPayload): Promise<{ success: boolean; appsTriggered: string[] }> {
    const appsTriggered: string[] = [];

    // 1. Zapier Integration (Connects to 5,000+ Apps: Shopify, HubSpot, Salesforce, Stripe, etc.)
    if (this.zapierWebhookUrl) {
      try {
        await fetch(this.zapierWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        appsTriggered.push('Zapier (Shopify, CRM, Stripe)');
      } catch (err) {
        console.error('Zapier integration error:', err);
      }
    }

    // 2. Make.com Integration
    if (this.makeWebhookUrl) {
      try {
        await fetch(this.makeWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        appsTriggered.push('Make.com');
      } catch (err) {
        console.error('Make.com integration error:', err);
      }
    }

    // 3. Custom REST API Webhook Integration
    if (this.customWebhookUrl) {
      try {
        await fetch(this.customWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        appsTriggered.push('Custom API Webhook');
      } catch (err) {
        console.error('Custom Webhook error:', err);
      }
    }

    console.log(`[APP INTEGRATOR ENGINE] Event '${payload.eventName}' sent to apps:`, appsTriggered.length > 0 ? appsTriggered.join(', ') : 'Local Log (No external webhooks configured)');
    
    return {
      success: true,
      appsTriggered,
    };
  }
}

export const appIntegrator = new AppIntegratorService();
