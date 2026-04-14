class MessageRouter {
    constructor(db) {
        this.db = db;
        this.whatsappClient = null;
        this.telegramClient = null;
        this.rules = [];
        
        // Carregar regras padrão
        this.loadDefaultRules();
    }
    
    setClients(whatsappClient, telegramClient) {
        this.whatsappClient = whatsappClient;
        this.telegramClient = telegramClient;
    }
    
    loadDefaultRules() {
        // Regra: Encaminhar todas as mensagens do WhatsApp para Telegram
        this.rules.push({
            name: 'forward_to_telegram',
            condition: (message) => message.platform === 'whatsapp' && message.direction === 'incoming',
            action: async (message) => {
                if (this.telegramClient) {
                    await this.telegramClient.forwardFromWhatsApp(message.originalMessage);
                }
            }
        });
        
        // Regra: Resposta automática para saudações
        this.rules.push({
            name: 'auto_greeting',
            condition: (message) => {
                const greetings = ['olá', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'hello', 'hi'];
                const body = message.message || message.content || message.body || '';
                const msgLower = body.toLowerCase();
                return greetings.some(greeting => msgLower.includes(greeting));
            },
            action: async (message) => {
                const responses = {
                    'whatsapp': 'Olá! Eu sou um bot automatizado. Como posso ajudar?',
                    'telegram': 'Olá! Recebi sua mensagem via Telegram.'
                };
                return responses[message.platform] || 'Olá!';
            }
        });
    }
    
    async routeMessage(messageData) {
        console.log(`🔄 Roteando mensagem de ${messageData.platform}: ${messageData.message}`);
        
        let response = null;
        
        // Aplicar regras
        for (const rule of this.rules) {
            if (rule.condition(messageData)) {
                console.log(`⚡ Aplicando regra: ${rule.name}`);
                
                try {
                    const result = await rule.action(messageData);
                    if (result && typeof result === 'string') {
                        response = result;
                    }
                } catch (error) {
                    console.error(`Erro na regra ${rule.name}:`, error);
                }
            }
        }
        
        return response;
    }
    
    addRule(rule) {
        this.rules.push(rule);
    }
    
    removeRule(ruleName) {
        this.rules = this.rules.filter(rule => rule.name !== ruleName);
    }
}

module.exports = MessageRouter;
