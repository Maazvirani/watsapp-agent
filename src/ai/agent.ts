import { GoogleGenerativeAI, FunctionDeclaration } from '@google/generative-ai';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env';
import { db } from '../db/database';
import { gmailService } from '../integrations/gmailService';
import { googleSheetsService } from '../integrations/googleSheetsService';

export class WhatsAppAiAgent {
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    if (config.geminiApiKey && config.geminiApiKey !== 'demo_key') {
      this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
    }
  }

  async processCustomerMessage(phone: string, customerName: string, userMessage: string): Promise<string> {
    // 1. Log inbound user message in SQLite/JSON DB
    try {
      db.prepare(`
        INSERT INTO conversations (phone, role, content)
        VALUES (?, 'user', ?)
      `).run(phone, userMessage);
    } catch (err) {
      console.error('Error logging user message to DB:', err);
    }

    // 2. Fetch conversation history for memory context
    const historyRows = db.prepare(`
      SELECT role, content FROM conversations
      WHERE phone = ?
      ORDER BY id ASC
      LIMIT 10
    `).all(phone) as { role: string; content: string }[];

    // 3. Try Gemini AI if API key is provided
    if (this.genAI) {
      try {
        const response = await this.runGeminiAgent(phone, customerName, historyRows, userMessage);
        if (response) return response;
      } catch (err: any) {
        console.error('Gemini API call failed, switching to rule engine:', err.message);
      }
    }

    // Smart Draft Agent fallback for instant testability
    return this.runSmartDraftAgent(phone, customerName, userMessage);
  }

  private async runGeminiAgent(
    phone: string,
    customerName: string,
    history: { role: string; content: string }[],
    userMessage: string
  ): Promise<string> {
    if (!this.genAI) return '';

    const createOrderTool: FunctionDeclaration = {
      name: 'create_order',
      description: 'Creates a new customer order, sends confirmation email with clickable link, and updates Google Sheets.',
      parameters: {
        type: 'OBJECT' as any,
        properties: {
          customerName: { type: 'STRING' as any, description: 'Customer full name' },
          customerPhone: { type: 'STRING' as any, description: 'Customer WhatsApp phone number' },
          customerEmail: { type: 'STRING' as any, description: 'Customer email address' },
          orderItems: { type: 'STRING' as any, description: 'Items or services being ordered' },
          totalAmount: { type: 'NUMBER' as any, description: 'Total price in USD' },
        },
        required: ['customerName', 'customerPhone', 'customerEmail', 'orderItems', 'totalAmount'],
      },
    };

    const model = this.genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: `You are an intelligent, friendly 24/7 WhatsApp AI Business Assistant.
Your job is to assist customers with products/services, collect order details, and trigger order placement.

When a customer wants to place an order, make sure you collect:
1. Full Name
2. Email Address
3. Order Items / Products requested
4. Estimated Total Price

When you have these details, call the 'create_order' tool.
Inform the customer that a confirmation email has been sent to their email address and that they must click the 'Confirm Order' button in the email to finalize their order.
Format WhatsApp messages with WhatsApp markdown (bold *text*).`,
      tools: [{ functionDeclarations: [createOrderTool] }],
    });

    const chat = model.startChat({
      history: history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
    });

    const result = await chat.sendMessage(userMessage);
    const response = result.response;
    const functionCalls = response.functionCalls();

    if (functionCalls && functionCalls.length > 0) {
      for (const fc of functionCalls) {
        if (fc.name === 'create_order') {
          const args = fc.args as any;
          return await this.handleCreateOrderTool({
            customerName: args.customerName || customerName,
            customerPhone: args.customerPhone || phone,
            customerEmail: args.customerEmail,
            orderItems: args.orderItems,
            totalAmount: Number(args.totalAmount || 50),
          });
        }
      }
    }

    return response.text() || 'Thank you for reaching out! How can I assist you with your business order today?';
  }

  public async handleCreateOrderTool(params: {
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    orderItems: string;
    totalAmount: number;
  }): Promise<string> {
    const orderId = uuidv4();
    const orderNumber = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
    const token = uuidv4();

    // Save order to DB with PENDING_CONFIRMATION status
    db.prepare(`
      INSERT INTO orders (id, order_number, customer_name, customer_phone, customer_email, order_items, total_amount, status, token)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_CONFIRMATION', ?)
    `).run(orderId, orderNumber, params.customerName, params.customerPhone, params.customerEmail, params.orderItems, params.totalAmount, token);

    // Send confirmation email
    await gmailService.sendOrderConfirmationEmail({
      orderId,
      orderNumber,
      customerName: params.customerName,
      customerEmail: params.customerEmail,
      orderItems: params.orderItems,
      totalAmount: params.totalAmount,
      confirmationToken: token,
    });

    // Record initial order row in Google Sheets draft sync
    await googleSheetsService.syncOrderToSheet({
      orderNumber,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      customerEmail: params.customerEmail,
      orderItems: params.orderItems,
      totalAmount: params.totalAmount,
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date().toISOString(),
    });

    return `🎉 *Order #${orderNumber} Placed!*

Hi *${params.customerName}*, your order for *${params.orderItems}* ($${params.totalAmount.toFixed(2)}) has been created.

📧 *Confirmation Required*: We have sent a confirmation email to *${params.customerEmail}*.
Please open the email and click the *Confirm Order* button to finalize your order.

Once confirmed, our Google Sheets and order team will automatically receive your final verification!`;
  }

  private async runSmartDraftAgent(phone: string, name: string, message: string): Promise<string> {
    const lower = message.toLowerCase();
    const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

    if (emailMatch || lower.includes('order') || lower.includes('buy') || lower.includes('laptop') || lower.includes('item')) {
      const email = emailMatch ? emailMatch[0] : `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`;
      const items = lower.includes('laptop') ? 'Premium Business Laptop' : message.length > 5 ? message : 'Standard Business Package';
      const amount = lower.includes('laptop') ? 1299.0 : 150.00;

      return await this.handleCreateOrderTool({
        customerName: name || 'Valued Customer',
        customerPhone: phone,
        customerEmail: email,
        orderItems: items,
        totalAmount: amount,
      });
    }

    if (lower.includes('status') || lower.includes('my order')) {
      const lastOrder = db.prepare(`
        SELECT * FROM orders WHERE customer_phone = ? ORDER BY created_at DESC LIMIT 1
      `).get(phone) as any;

      if (lastOrder) {
        return `📦 *Order #${lastOrder.order_number} Status*: *${lastOrder.status}*
Items: ${lastOrder.order_items}
Total: $${lastOrder.total_amount.toFixed(2)}
Email: ${lastOrder.customer_email}`;
      } else {
        return `You don't have any active orders right now. Would you like to place a new order? Simply reply with what you'd like to buy and your email address!`;
      }
    }

    return `Hello *${name}*! 👋 Welcome to our 24/7 WhatsApp AI Business Assistant.

How can I help you today?
- *Place an Order*: Reply with the item details and your email address (e.g., "I want to order a Business Laptop, my email is john@example.com").
- *Check Status*: Reply "Check my order status".`;
  }
}

export const aiAgent = new WhatsAppAiAgent();
