const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

// Configurações
require('./core/config');
const Database = require('./core/database');
const WhatsAppClient = require('./whatsapp/whatsapp-client');
const TelegramBot = require('./telegram/telegram-bot');
const MessageRouter = require('./core/message-router');
const SessionManager = require('./whatsapp/session-manager');

class BotServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        
        this.db = new Database();
        this.whatsapp = null;
        this.telegram = null;
        this.router = new MessageRouter(this.db);
        this.sessionManager = null;
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketIO();
        this.setupClients();
    }
    
    setupMiddleware() {
        this.app.use(cors());
        this.app.use(bodyParser.json());
        this.app.use(bodyParser.urlencoded({ extended: true }));
        this.app.use(express.static(path.join(__dirname, 'public')));
    }
    
    setupRoutes() {
        // API para enviar mensagens
        this.app.post('/api/send', async (req, res) => {
            try {
                const { to, message, platform } = req.body;
                
                if (platform === 'whatsapp' && this.whatsapp) {
                    const result = await this.whatsapp.sendMessage(to, message);
                    res.json({ success: true, result });
                } else if (platform === 'telegram' && this.telegram) {
                    const result = await this.telegram.sendMessage(to, message);
                    res.json({ success: true, result });
                } else {
                    res.status(400).json({ success: false, error: 'Plataforma inválida' });
                }
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });
        
        // API para obter conversas
        this.app.get('/api/conversations', async (req, res) => {
            try {
                const conversations = await this.db.getConversations();
                res.json({ success: true, conversations });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });
        
        // API para obter mensagens de uma conversa
        this.app.get('/api/conversations/:id/messages', async (req, res) => {
            try {
                const messages = await this.db.getMessages(req.params.id);
                res.json({ success: true, messages });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // API para sincronizar histórico do WhatsApp
        this.app.post('/api/sync', async (req, res) => {
            try {
                if (!this.whatsapp || this.whatsapp.status !== 'connected') {
                    return res.status(400).json({ success: false, error: 'WhatsApp não está conectado' });
                }

                res.json({ success: true, message: 'Sincronização iniciada em background' });

                // Executar sync em background
                this._syncWhatsAppHistory();
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // API para listar contatos do WhatsApp
        this.app.get('/api/contacts', async (req, res) => {
            try {
                if (!this.whatsapp || this.whatsapp.status !== 'connected') {
                    return res.status(400).json({ success: false, error: 'WhatsApp não está conectado' });
                }

                const contacts = await this.whatsapp.client.getContacts();
                const filtered = contacts
                    .filter(c => c.isMyContact && !c.isGroup)
                    .map(c => ({
                        id: c.id._serialized,
                        name: c.name || c.pushname || c.id.user,
                        number: c.id.user
                    }));

                res.json({ success: true, contacts: filtered });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // API de status geral
        this.app.get('/api/status', (req, res) => {
            res.json({
                success: true,
                whatsapp: this.whatsapp?.status || 'disconnected',
                telegram: this.telegram?.status || 'disconnected',
                session: this.sessionManager?.getStatus() || null
            });
        });
    }

    async _syncWhatsAppHistory() {
        try {
            const chats = await this.whatsapp.client.getChats();
            let count = 0;

            for (const chat of chats.slice(0, 50)) {
                try {
                    const msgs = await chat.fetchMessages({ limit: 10 });
                    for (const m of msgs) {
                        await this.db.saveMessage({
                            platform: 'whatsapp',
                            messageId: m.id.id,
                            from: m.fromMe ? 'me' : m.from,
                            to: m.fromMe ? m.to : 'me',
                            content: m.body,
                            timestamp: new Date(m.timestamp * 1000),
                            direction: m.fromMe ? 'outgoing' : 'incoming'
                        }).catch(() => {});
                    }
                    count++;
                } catch {}
            }

            this.io.emit('notification', `✅ Histórico sincronizado: ${count} chats`);
        } catch (err) {
            console.error('Erro no sync:', err);
            this.io.emit('notification', `❌ Erro na sincronização: ${err.message}`);
        }
    }
    
    setupSocketIO() {
        this.io.on('connection', (socket) => {
            console.log('Cliente conectado via Socket.IO');
            
            // Enviar QR Code do WhatsApp quando solicitado
            socket.on('get_qr', () => {
                if (this.whatsapp && this.whatsapp.qrCode) {
                    socket.emit('qr_code', this.whatsapp.qrCode);
                }
            });
            
            // Enviar status do WhatsApp
            socket.on('get_status', () => {
                if (this.whatsapp) {
                    socket.emit('whatsapp_status', this.whatsapp.status);
                }
                if (this.telegram) {
                    socket.emit('telegram_status', this.telegram.status);
                }
            });
            
            socket.on('disconnect', () => {
                console.log('Cliente desconectado');
            });
        });
    }
    
    async setupClients() {
        try {
            // Inicializar WhatsApp
            this.whatsapp = new WhatsAppClient(this.db, this.router, this.io);
            await this.whatsapp.initialize();
            
            // Inicializar Telegram
            this.telegram = new TelegramBot(this.db, this.router, this.whatsapp);
            await this.telegram.initialize();
            
            // Conectar roteador
            this.router.setClients(this.whatsapp, this.telegram);

            // Iniciar monitoramento de sessão
            this.sessionManager = new SessionManager(this.whatsapp, this.io);
            this.sessionManager.startMonitoring();

            console.log('✅ Todos os clientes foram inicializados');
        } catch (error) {
            console.error('❌ Erro ao inicializar clientes:', error);
        }
    }
    
    start(port = 3000) {
        this.server.listen(port, () => {
            console.log(`🚀 Servidor rodando na porta ${port}`);
            console.log(`🌐 Interface web: http://localhost:${port}`);
            console.log(`🤖 Telegram bot inicializado`);
            console.log(`📱 WhatsApp cliente inicializado`);
        });
    }
}

// Iniciar servidor
const botServer = new BotServer();
botServer.start(3000);
