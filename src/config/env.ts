import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  nodeEnv: process.env.NODE_ENV || 'development',

  geminiApiKey: process.env.GEMINI_API_KEY || '',
  
  meta: {
    whatsappToken: process.env.META_WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.META_PHONE_NUMBER_ID || '',
    verifyToken: process.env.META_VERIFY_TOKEN || 'whatsapp_ai_verify_secret_123',
  },

  email: {
    user: process.env.GMAIL_USER || '',
    pass: process.env.GMAIL_PASS || '',
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
  },

  googleSheets: {
    sheetId: process.env.GOOGLE_SHEETS_ID || '',
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    privateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n') || '',
  },

  enableMockMode: process.env.ENABLE_MOCK_MODE === 'true' || !process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'demo_key',
};
