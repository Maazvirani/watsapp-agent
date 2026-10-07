import fs from 'fs';
import path from 'path';

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const ordersFile = path.join(dataDir, 'orders.json');
const conversationsFile = path.join(dataDir, 'conversations.json');
const sentEmailsFile = path.join(dataDir, 'sent_emails.json');
const sheetsLogFile = path.join(dataDir, 'sheets_log.json');

function loadJson<T>(filePath: string, defaultData: T): T {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return defaultData;
  }
}

function saveJson<T>(filePath: string, data: T) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export interface OrderRecord {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  order_items: string;
  total_amount: number;
  status: string;
  token: string;
  created_at: string;
  confirmed_at: string | null;
  sheets_synced: number;
}

export interface ConversationRecord {
  id: number;
  phone: string;
  role: string;
  content: string;
  created_at: string;
}

export interface SentEmailRecord {
  id: number;
  order_id: string;
  recipient: string;
  subject: string;
  body_html: string;
  confirmation_link: string;
  sent_at: string;
}

export interface SheetsLogRecord {
  id: number;
  order_id: string;
  action: string;
  row_data: string;
  status: string;
  synced_at: string;
}

class JsonDatabase {
  private orders: OrderRecord[] = [];
  private conversations: ConversationRecord[] = [];
  private sentEmails: SentEmailRecord[] = [];
  private sheetsLog: SheetsLogRecord[] = [];

  constructor() {
    this.reload();
  }

  private reload() {
    this.orders = loadJson<OrderRecord[]>(ordersFile, []);
    this.conversations = loadJson<ConversationRecord[]>(conversationsFile, []);
    this.sentEmails = loadJson<SentEmailRecord[]>(sentEmailsFile, []);
    this.sheetsLog = loadJson<SheetsLogRecord[]>(sheetsLogFile, []);
  }

  prepare(sql: string) {
    const self = this;

    return {
      run(...args: any[]) {
        const lower = sql.toLowerCase();

        if (lower.includes('insert into orders')) {
          const [id, order_number, customer_name, customer_phone, customer_email, order_items, total_amount, token] = args;
          const record: OrderRecord = {
            id,
            order_number,
            customer_name,
            customer_phone,
            customer_email,
            order_items,
            total_amount: Number(total_amount),
            status: 'PENDING_CONFIRMATION',
            token,
            created_at: new Date().toISOString(),
            confirmed_at: null,
            sheets_synced: 0,
          };
          self.orders.unshift(record);
          saveJson(ordersFile, self.orders);
          return { changes: 1 };
        }

        if (lower.includes('insert into conversations')) {
          const [phone, role, content] = args;
          const record: ConversationRecord = {
            id: self.conversations.length + 1,
            phone,
            role,
            content,
            created_at: new Date().toISOString(),
          };
          self.conversations.push(record);
          saveJson(conversationsFile, self.conversations);
          return { changes: 1 };
        }

        if (lower.includes('insert into sent_emails')) {
          const [order_id, recipient, subject, body_html, confirmation_link] = args;
          const record: SentEmailRecord = {
            id: self.sentEmails.length + 1,
            order_id,
            recipient,
            subject,
            body_html,
            confirmation_link,
            sent_at: new Date().toISOString(),
          };
          self.sentEmails.unshift(record);
          saveJson(sentEmailsFile, self.sentEmails);
          return { changes: 1 };
        }

        if (lower.includes('insert into sheets_log')) {
          const [order_id, action, row_data, status] = args;
          const record: SheetsLogRecord = {
            id: self.sheetsLog.length + 1,
            order_id,
            action,
            row_data,
            status,
            synced_at: new Date().toISOString(),
          };
          self.sheetsLog.unshift(record);
          saveJson(sheetsLogFile, self.sheetsLog);
          return { changes: 1 };
        }

        if (lower.includes('update orders')) {
          if (lower.includes("status = 'confirmed'")) {
            const [confirmed_at, id] = args;
            const order = self.orders.find(o => o.id === id);
            if (order) {
              order.status = 'CONFIRMED';
              order.confirmed_at = confirmed_at;
              saveJson(ordersFile, self.orders);
            }
          } else if (lower.includes('sheets_synced = 1')) {
            const [order_number] = args;
            const order = self.orders.find(o => o.order_number === order_number);
            if (order) {
              order.sheets_synced = 1;
              saveJson(ordersFile, self.orders);
            }
          }
          return { changes: 1 };
        }

        return { changes: 0 };
      },

      get(...args: any[]): any {
        const lower = sql.toLowerCase();

        if (lower.includes('from orders where token =')) {
          const [token] = args;
          return self.orders.find(o => o.token === token) || null;
        }

        if (lower.includes('from orders where customer_phone =')) {
          const [phone] = args;
          return self.orders.find(o => o.customer_phone === phone) || null;
        }

        if (lower.includes('count(*) as count from orders')) {
          if (lower.includes("where status = 'pending_confirmation'")) {
            return { count: self.orders.filter(o => o.status === 'PENDING_CONFIRMATION').length };
          }
          if (lower.includes("where status = 'confirmed'")) {
            return { count: self.orders.filter(o => o.status === 'CONFIRMED').length };
          }
          return { count: self.orders.length };
        }

        if (lower.includes('count(*) as count from sent_emails')) {
          return { count: self.sentEmails.length };
        }

        if (lower.includes('count(*) as count from sheets_log')) {
          return { count: self.sheetsLog.length };
        }

        return null;
      },

      all(...args: any[]): any[] {
        const lower = sql.toLowerCase();

        if (lower.includes('from conversations')) {
          const [phone] = args;
          let res = self.conversations;
          if (phone) {
            res = res.filter(c => c.phone === phone);
          }
          return res.slice(-10);
        }

        if (lower.includes('from orders')) {
          return self.orders;
        }

        if (lower.includes('from sent_emails')) {
          return self.sentEmails;
        }

        if (lower.includes('from sheets_log')) {
          return self.sheetsLog;
        }

        return [];
      },
    };
  }
}

export const db = new JsonDatabase();

export function initDatabase() {
  console.log('JSON File-based Database initialized successfully.');
}
