class SessionManager {
    constructor(whatsappClient, io) {
        this.client = whatsappClient;
        this.io = io;
        this.healthCheckInterval = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 10000;
    }

    startMonitoring() {
        // Verifica saúde da sessão a cada 60 segundos
        this.healthCheckInterval = setInterval(() => this._healthCheck(), 60000);
        console.log('🔍 Monitoramento de sessão iniciado');
    }

    stopMonitoring() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    async _healthCheck() {
        if (!this.client) return;

        if (this.client.status === 'disconnected') {
            console.warn(`⚠️ WhatsApp desconectado. Tentativa ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts}`);

            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                await this._attemptReconnect();
            } else {
                console.error('❌ Máximo de tentativas de reconexão atingido.');
                this.stopMonitoring();
            }
        } else if (this.client.status === 'connected') {
            this.reconnectAttempts = 0;
        }
    }

    async _attemptReconnect() {
        console.log(`🔄 Aguardando ${this.reconnectDelay / 1000}s antes de reconectar...`);
        await new Promise(r => setTimeout(r, this.reconnectDelay));

        try {
            if (this.client.client) {
                await this.client.client.initialize();
                console.log('✅ Reconexão iniciada');
            }
        } catch (err) {
            console.error('❌ Erro ao reconectar:', err.message);
        }
    }

    getStatus() {
        return {
            status: this.client?.status || 'unknown',
            reconnectAttempts: this.reconnectAttempts,
            monitoring: !!this.healthCheckInterval
        };
    }
}

module.exports = SessionManager;
