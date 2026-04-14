<!-- File: core/database.js -->
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const config = require('./config');

class Database {
    constructor() {
        this.db = new sqlite3.Database(config.DATABASE_PATH);
        this.initDatabase();
    }
    
    initDatabase() {
        // Tabela de mensagens (COM media_type)
        this.db.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                message_id TEXT,
                from_user TEXT NOT NULL,
                to_user TEXT NOT NULL,
                content TEXT,
                media_type TEXT,
                media_url TEXT,
                direction TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Tabela de conversas
        this.db.run(`
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                contact TEXT NOT NULL,
                contact_name TEXT,
                last_message TEXT,
                last_timestamp DATETIME,
                unread_count INTEGER DEFAULT 0,
                UNIQUE(platform, contact)
            )
        `);
        
        console.log('📊 Banco de dados inicializado com sucesso!');
    }
    
    async saveMessage(messageData) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO messages (platform, message_id, from_user, to_user, content, media_type, media_url, direction, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            const params = [
                messageData.platform,
                messageData.messageId || null,
                messageData.from,
                messageData.to,
                messageData.content || '',
                messageData.mediaType || null,
                messageData.mediaUrl || null,
                messageData.direction,
                messageData.timestamp || new Date()
            ];
            
            this.db.run(sql, params, function(err) {
                if (err) {
                    console.error('❌ Erro ao salvar mensagem:', err.message);
                    reject(err);
                } else {
                    this.updateConversation(messageData);
                    resolve(this.lastID);
                }
            }.bind(this));
        });
    }
    
    updateConversation(messageData) {
        const contact = messageData.direction === 'incoming' ? messageData.from : messageData.to;
        
        const sql = `
            INSERT OR REPLACE INTO conversations (platform, contact, contact_name, last_message, last_timestamp, unread_count)
            VALUES (?, ?, ?, ?, ?, 
                COALESCE((SELECT unread_count FROM conversations WHERE platform = ? AND contact = ?), 0) + ?
            )
        `;
        
        const unreadIncrement = messageData.direction === 'incoming' ? 1 : 0;
        
        this.db.run(sql, [
            messageData.platform,
            contact,
            messageData.contactName || null,
            (messageData.content || '').substring(0, 100),
            messageData.timestamp || new Date(),
            messageData.platform,
            contact,
            unreadIncrement
        ]);
    }
    
    async getConversations(limit = 25, offset = 0) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT * FROM conversations 
                ORDER BY last_timestamp DESC
                LIMIT ? OFFSET ?
            `;
            
            this.db.all(sql, [limit, offset], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
    
    async getRecentConversations(limit = 25) {
        return this.getConversations(limit, 0);
    }
    
    async getMessages(contactId, limit = 50) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT * FROM messages 
                WHERE (from_user = ? OR to_user = ?)
                ORDER BY timestamp ASC
                LIMIT ?
            `;
            
            this.db.all(sql, [contactId, contactId, limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
    
    markAsRead(platform, contact) {
        this.db.run(
            'UPDATE conversations SET unread_count = 0 WHERE platform = ? AND contact = ?',
            [platform, contact]
        );
    }
    
    async getConversationsCount() {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT COUNT(*) as count FROM conversations';
            this.db.get(sql, [], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
    }

    async getConversationStats() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT
                    COUNT(*) as total_conversations,
                    COALESCE(SUM(unread_count), 0) as total_unread
                FROM conversations
            `;
            this.db.get(sql, [], (err, row) => {
                if (err) reject(err);
                else resolve({
                    total_conversations: row.total_conversations || 0,
                    total_unread: row.total_unread || 0
                });
            });
        });
    }

    close() {
        this.db.close();
    }
}

module.exports = Database;
