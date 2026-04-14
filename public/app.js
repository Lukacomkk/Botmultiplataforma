// Conectar ao Socket.IO
const socket = io();

// Estado da aplicação
let currentConversation = null;
let conversations = [];

// Elementos DOM
const whatsappStatusEl = document.getElementById('whatsapp-status');
const telegramStatusEl = document.getElementById('telegram-status');
const qrContainer = document.getElementById('qr-container');
const conversationsList = document.getElementById('conversations-list');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const currentContactEl = document.getElementById('current-contact');
const platformSelect = document.getElementById('platform-select');

// Inicializar Socket.IO
socket.on('connect', () => {
    console.log('Conectado ao servidor');
    socket.emit('get_status');
});

socket.on('qr_code', (qr) => {
    qrContainer.innerHTML = '';
    
    // Gerar QR Code usando uma API online (simplificado)
    const qrImage = document.createElement('img');
    qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qr)}`;
    qrImage.alt = 'QR Code WhatsApp';
    qrContainer.appendChild(qrImage);
    
    showNotification('QR Code gerado! Escaneie com o WhatsApp');
});

socket.on('whatsapp_status', (status) => {
    const statusEl = whatsappStatusEl.querySelector('.status-indicator');
    const textEl = whatsappStatusEl.querySelector('span:last-child');
    
    statusEl.className = 'status-indicator';
    
    if (status === 'connected') {
        statusEl.classList.add('connected');
        textEl.textContent = 'WhatsApp: Conectado';
        showNotification('WhatsApp conectado com sucesso!');
    } else if (status === 'awaiting_qr') {
        statusEl.classList.add('awaiting_qr');
        textEl.textContent = 'WhatsApp: Aguardando QR Code';
    } else {
        statusEl.classList.add('disconnected');
        textEl.textContent = 'WhatsApp: Desconectado';
    }
});

socket.on('telegram_status', (status) => {
    const statusEl = telegramStatusEl.querySelector('.status-indicator');
    const textEl = telegramStatusEl.querySelector('span:last-child');
    
    statusEl.className = 'status-indicator';
    
    if (status === 'connected') {
        statusEl.classList.add('connected');
        textEl.textContent = 'Telegram: Conectado';
    } else {
        statusEl.classList.add('disconnected');
        textEl.textContent = 'Telegram: Desconectado';
    }
});

socket.on('new_message', (data) => {
    console.log('Nova mensagem recebida:', data);
    
    // Se a mensagem for da conversa atual, adicionar ao chat
    if (currentConversation && currentConversation.contact === data.from) {
        addMessageToChat(data.message, 'incoming', data.timestamp);
    }
    
    // Atualizar lista de conversas
    loadConversations();
    
    showNotification(`Nova mensagem de ${data.from}`);
});

// Gerar QR Code
function generateQR() {
    socket.emit('get_qr');
    showNotification('Solicitando QR Code...');
}

// Carregar conversas
async function loadConversations() {
    try {
        const response = await fetch('/api/conversations');
        const data = await response.json();
        
        if (data.success) {
            conversations = data.conversations;
            renderConversations();
        }
    } catch (error) {
        console.error('Erro ao carregar conversas:', error);
    }
}

// Renderizar lista de conversas
function renderConversations() {
    conversationsList.innerHTML = '';
    
    if (conversations.length === 0) {
        conversationsList.innerHTML = '<p class="no-conversations">Nenhuma conversa encontrada</p>';
        return;
    }
    
    conversations.forEach(conversation => {
        const item = document.createElement('div');
        item.className = `conversation-item ${currentConversation?.id === conversation.id ? 'active' : ''}`;
        item.dataset.id = conversation.id;
        item.dataset.contact = conversation.contact;
        item.dataset.platform = conversation.platform;
        
        item.innerHTML = `
            <div class="conversation-header">
                <span class="conversation-name">${conversation.contact}</span>
                <span class="conversation-platform">${conversation.platform}</span>
            </div>
            <div class="conversation-last-message">${conversation.last_message || 'Sem mensagens'}</div>
            <div class="conversation-time">${formatTime(conversation.last_timestamp)}</div>
        `;
        
        item.addEventListener('click', () => selectConversation(conversation));
        conversationsList.appendChild(item);
    });
}

// Selecionar conversa
async function selectConversation(conversation) {
    currentConversation = conversation;
    currentContactEl.textContent = `${conversation.contact} (${conversation.platform})`;
    
    // Atualizar seleção visual
    document.querySelectorAll('.conversation-item').forEach(item => {
        item.classList.remove('active');
    });
    event.currentTarget.classList.add('active');
    
    // Habilitar entrada de mensagem
    messageInput.disabled = false;
    sendButton.disabled = false;
    
    // Carregar mensagens
    await loadMessages(conversation.contact);
}

// Carregar mensagens
async function loadMessages(contact) {
    try {
        const response = await fetch(`/api/conversations/${contact}/messages`);
        const data = await response.json();
        
        if (data.success) {
            messagesContainer.innerHTML = '';
            data.messages.forEach(message => {
                addMessageToChat(
                    message.content,
                    message.direction === 'incoming' ? 'incoming' : 'outgoing',
                    message.timestamp
                );
            });
            
            // Rolagem para o final
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    } catch (error) {
        console.error('Erro ao carregar mensagens:', error);
        messagesContainer.innerHTML = '<p class="error">Erro ao carregar mensagens</p>';
    }
}

// Adicionar mensagem ao chat
function addMessageToChat(message, type, timestamp) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${type}`;
    
    const time = timestamp ? formatTime(timestamp) : formatTime(new Date());
    
    messageEl.innerHTML = `
        <div class="message-content">${escapeHtml(message)}</div>
        <div class="message-time">${time}</div>
    `;
    
    messagesContainer.appendChild(messageEl);
    
    // Rolagem para o final
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Enviar mensagem
async function sendMessage() {
    const message = messageInput.value.trim();
    const platform = platformSelect.value;
    
    if (!message || !currentConversation) {
        showNotification('Digite uma mensagem e selecione uma conversa');
        return;
    }
    
    try {
        const response = await fetch('/api/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                to: currentConversation.contact,
                message: message,
                platform: platform
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Adicionar mensagem ao chat
            addMessageToChat(message, 'outgoing', new Date());
            
            // Limpar campo de entrada
            messageInput.value = '';
            
            // Atualizar conversas
            loadConversations();
            
            showNotification('Mensagem enviada com sucesso!');
        } else {
            showNotification(`Erro: ${data.error}`);
        }
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        showNotification('Erro ao enviar mensagem');
    }
}

// Atualizar conversas
function refreshConversations() {
    loadConversations();
    showNotification('Conversas atualizadas');
}

// Utilitários
function showNotification(text) {
    const notification = document.getElementById('notification');
    const notificationText = document.getElementById('notification-text');
    
    notificationText.textContent = text;
    notification.classList.add('show');
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit'
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
// Sincronizar Histórico
async function syncHistory() {
    if (!confirm("Isso vai puxar as mensagens mais recentes dos seus chats. Pode demorar um pouco. Deseja continuar?")) {
        return;
    }
    
    showNotification('Iniciando sincronização...');
    
    try {
        const response = await fetch('/api/sync', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            showNotification(data.message);
        } else {
            showNotification(`Erro: ${data.error}`);
        }
    } catch (error) {
        console.error('Erro ao sincronizar:', error);
        showNotification('Erro ao solicitar sincronização.');
    }
}

// Ouvir quando a sincronização terminar pelo Socket
socket.on('notification', (msg) => {
    showNotification(msg);
    loadConversations(); // Atualiza a lista quando acabar
});
// Event Listeners
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Tecla Escape para limpar seleção
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        currentConversation = null;
        messageInput.disabled = true;
        sendButton.disabled = true;
        currentContactEl.textContent = 'Selecione uma conversa';
        messagesContainer.innerHTML = `
            <div class="welcome-message">
                <i class="fas fa-robot"></i>
                <h2>Bem-vindo ao Bot Multiplataforma</h2>
                <p>Selecione uma conversa à esquerda para começar a enviar mensagens.</p>
            </div>
        `;
        
        // Remover seleção visual
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.classList.remove('active');
        });
    }
});

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    loadConversations();
    
    // Atualizar a cada 30 segundos
    setInterval(loadConversations, 30000);
});
