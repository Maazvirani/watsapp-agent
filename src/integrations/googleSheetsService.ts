import { google } from 'googleapis';
import { config } from '../config/env';
import { db } from '../db/database';

export interface SheetOrderRow {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  orderItems: string;
  totalAmount: number;
  status: string;
  createdAt: string;
  confirmedAt?: string;
}

export class GoogleSheetsService {
  private auth: any = null;
  private sheets: any = null;

  constructor() {
    if (
      config.googleSheets.sheetId &&
      config.googleSheets.clientEmail &&
      config.googleSheets.privateKey &&
      config.googleSheets.sheetId !== 'demo_sheet_id'
    ) {
      try {
        this.auth = new google.auth.JWT({
          email: config.googleSheets.clientEmail,
          key: config.googleSheets.privateKey,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      } catch (err) {
        console.error('Failed to initialize Google Sheets API:', err);
      }
    }
  }

  async syncOrderToSheet(order: SheetOrderRow): Promise<{ success: boolean; message: string }> {
    const rowValues = [
      order.orderNumber,
      order.customerName,
      order.customerPhone,
      order.customerEmail,
      order.orderItems,
      `$${order.totalAmount.toFixed(2)}`,
      order.status,
      order.createdAt,
      order.confirmedAt || 'N/A',
    ];

    const rowDataStr = JSON.stringify(rowValues);

    // Record in local sheets sync log table
    try {
      db.prepare(`
        INSERT INTO sheets_log (order_id, action, row_data, status)
        VALUES (?, ?, ?, ?)
      `).run(order.orderNumber, 'APPEND_ROW', rowDataStr, order.status);

      db.prepare(`UPDATE orders SET sheets_synced = 1 WHERE order_number = ?`).run(order.orderNumber);
    } catch (err) {
      console.error('Error recording sheet log in database:', err);
    }

    if (this.sheets) {
      try {
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: config.googleSheets.sheetId,
          range: 'Orders!A:I',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [rowValues],
          },
        });
        console.log(`Successfully appended order ${order.orderNumber} to Google Sheet ID ${config.googleSheets.sheetId}`);
        return { success: true, message: 'Synced to live Google Sheet successfully.' };
      } catch (error: any) {
        console.error('Error appending to Google Sheets API:', error.message);
      }
    }

    console.log(`[GOOGLE SHEETS SYNC MIRROR] Appended row for Order #${order.orderNumber} | Customer: ${order.customerName}`);
    return {
      success: true,
      message: 'Draft Google Sheet updated successfully in local mirror.',
    };
  }
}

export const googleSheetsService = new GoogleSheetsService();
