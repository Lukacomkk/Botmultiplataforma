<!-- File: core/config.js -->
require('dotenv').config();

const config = {
    PORT: process.env.PORT || 3000,
    
    // Telegram
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_AUTHORIZED_USERS: process.env.TELEGRAM_AUTHORIZED_USERS 
        ? process.env.TELEGRAM_AUTHORIZED_USERS.split(',') 
        : [],
    
    // WhatsApp
    WHATSAPP_SESSION_PATH: process.env.WHATSAPP_SESSION_PATH || './whatsapp-session',
    
    // Banco de Dados
    DATABASE_PATH: process.env.DATABASE_PATH || './database.sqlite',
    
    // Paginação
    CONVERSATIONS_PER_PAGE: parseInt(process.env.CONVERSATIONS_PER_PAGE) || 25,
    
    // Segurança
    API_KEY: process.env.API_KEY,
    JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    
    // Logging
    LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};

// Verificar configurações obrigatórias
const required = ['TELEGRAM_BOT_TOKEN'];
const missing = required.filter(key => !config[key]);

if (missing.length > 0) {
    console.warn('⚠️  Configurações ausentes:', missing.join(', '));
}

module.exports = config;
