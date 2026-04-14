const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

class WhatsAppClient {
    constructor(db, router, io) {
        this.db = db;
        this.router = router;
        this.io = io;
        this.client = null;
        this.qrCode = null;
        this.status = 'disconnected';
    }
    
    async initialize() {
        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: './whatsapp-session'
            }),
            puppeteer: {
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ],
                headless: 'new',
                executablePath: process.env.CHROME_BIN || undefined
            },
            restartOnAuthFail: true,
                takeoverOnConflict: true,
            takeoverTimeoutMs: 0
        });
        
        // Evento QR Code
        this.client.on('qr', (qr) => {
            this.qrCode = qr;
            this.status = 'awaiting_qr';
            console.log('📱 QR Code recebido, escaneie com o WhatsApp');
            qrcode.generate(qr, { small: true });
            
            if (this.io) {
                this.io.emit('qr_code', qr);
                this.io.emit('whatsapp_status', this.status);
            }
        });
        
        // Evento Ready
        this.client.on('ready', () => {
            this.status = 'connected';
            console.log('✅ WhatsApp cliente está pronto!');
            
            if (this.io) {
                this.io.emit('whatsapp_status', this.status);
            }
        });
        
        // Evento de Mensagem
        this.client.on('message', async (message) => {
            try {
                console.log(`📩 Nova mensagem WhatsApp de ${message.from}: ${message.body}`);

                const messageData = {
                    platform: 'whatsapp',
                    messageId: message.id.id,
                    from: message.from,
                    to: message.to || message.from,
                    content: message.body,
                    message: message.body,
                    timestamp: new Date(message.timestamp * 1000),
                    direction: 'incoming',
                    hasMedia: message.hasMedia,
                    originalMessage: message
                };

                // Salvar no banco de dados
                await this.db.saveMessage(messageData);

                // Rotear mensagem (encaminha para Telegram e aplica regras)
                if (this.router) {
                    const response = await this.router.routeMessage(messageData);
                    if (response) {
                        await message.reply(response);
                    }
                }

                // Notificar interface web
                if (this.io) {
                    this.io.emit('new_message', {
                        platform: 'whatsapp',
                        from: message.from,
                        message: message.body,
                        timestamp: new Date()
                    });
                }
            } catch (error) {
                console.error('❌ Erro ao processar mensagem:', error);
            }
        });
        
        // Evento de desconexão
        this.client.on('disconnected', (reason) => {
            this.status = 'disconnected';
            console.log('❌ WhatsApp desconectado:', reason);
            
            if (this.io) {
                this.io.emit('whatsapp_status', this.status);
            }
        });
        
        // Evento de erro
        this.client.on('auth_failure', (msg) => {
            console.error('❌ Falha na autenticação:', msg);
        });
        
        // Inicializar cliente
        try {
            await this.client.initialize();
        } catch (error) {
            console.error('❌ Erro ao inicializar WhatsApp:', error);
            throw error;
        }
    }
    
    async sendMessage(to, message) {
        try {
            if (!this.client || this.status !== 'connected') {
                throw new Error('WhatsApp não está conectado');
            }
            
            // Formatar número
            let formattedNumber = to;
            if (!to.includes('@c.us') && !to.includes('@g.us')) {
                // Remove caracteres não numéricos
                const cleanNumber = to.replace(/\D/g, '');
                formattedNumber = `${cleanNumber}@c.us`;
            }
            
            console.log(`📤 Enviando mensagem para: ${formattedNumber}`);
            
            const sentMessage = await this.client.sendMessage(formattedNumber, message);
            
            // Salvar no banco de dados
            await this.db.saveMessage({
                platform: 'whatsapp',
                messageId: sentMessage.id.id,
                from: 'me',
                to: formattedNumber,
                content: message,
                timestamp: new Date(),
                direction: 'outgoing'
            });
            
            console.log(`✅ Mensagem enviada para ${formattedNumber}`);
            return { success: true, messageId: sentMessage.id.id };
        } catch (error) {
            console.error('❌ Erro ao enviar mensagem WhatsApp:', error);
            throw error;
        }
    }
    
    async getChats() {
        try {
            if (!this.client || this.status !== 'connected') {
                return [];
            }
            
            const chats = await this.client.getChats();
            return chats.map(chat => ({
                id: chat.id._serialized,
                name: chat.name || chat.id.user,
                unreadCount: chat.unreadCount,
                lastMessage: chat.lastMessage ? chat.lastMessage.body : null
            }));
        } catch (error) {
            console.error('Erro ao obter chats:', error);
            return [];
        }
    }
}

module.exports = WhatsAppClient;
