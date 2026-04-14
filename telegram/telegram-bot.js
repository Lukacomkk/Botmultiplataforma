const TelegramBot = require('node-telegram-bot-api');
const { MessageMedia } = require('whatsapp-web.js');
const fetch = require('node-fetch');

class TelegramBotClient {
    constructor(db, router, whatsappClient = null) {
        this.db = db;
        this.router = router;
        this.whatsappClient = whatsappClient;
        this.bot = null;
        this.status = 'disconnected';
        this.authorizedUsers = process.env.TELEGRAM_AUTHORIZED_USERS
            ? process.env.TELEGRAM_AUTHORIZED_USERS.split(',').map(s => s.trim())
            : [];

        // cache: contactId → nome
        this.contactCache = new Map();
        // userState por userId: fluxo de envio
        // msgState por message_id: link conversa → contactId (para reply)
        this.userState = new Map();
        this.msgState = new Map();
    }

    async initialize() {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            console.log('⚠️ Token do Telegram não configurado.');
            return;
        }

        this.bot = new TelegramBot(token, { polling: true });
        this.status = 'connected';
        console.log('🤖 Telegram Bot inicializado com Menu Interativo!');

        // ── Comandos ──────────────────────────────────────────
        this.bot.onText(/\/start/, (msg) => this._cmd(msg, () => this.showMainMenu(msg.chat.id)));
        this.bot.onText(/^\/c$/, (msg) => this._cmd(msg, () => this.showConversationsPage(msg.chat.id, 1)));
        this.bot.onText(/^\/contatos$/, (msg) => this._cmd(msg, () => this.showContactsPage(msg.chat.id, 1)));
        this.bot.onText(/^\/ler (\S+)/, (msg, m) => this._cmd(msg, () => this.openConversation(msg.chat.id, m[1])));
        this.bot.onText(/^\/w (\S+) (.+)/, (msg, m) => this._cmd(msg, () => this.sendWhatsAppMessage(msg.chat.id, m[1], m[2])));

        // ── Callbacks inline ──────────────────────────────────
        this.bot.on('callback_query', async (query) => {
            if (!this.isAuthorized(query.from.id)) return;
            await this._handleCallback(query);
        });

        // ── Mensagens de texto / mídia (state machine + reply) ──
        this.bot.on('message', async (msg) => {
            if (!this.isAuthorized(msg.from.id)) return;
            if (msg.text && msg.text.startsWith('/')) return;

            // Reply sobre uma mensagem de conversa
            if (msg.reply_to_message) {
                const contactId = this._extractContactFromReply(msg.reply_to_message);
                if (contactId) {
                    await this._handleReply(msg, contactId);
                    return;
                }
            }

            // Fluxo de envio (state machine)
            const state = this.userState.get(msg.from.id);
            if (state) await this._handleFlowMessage(msg, state);
        });
    }

    // ══════════════════════════════════════════════════════════
    // HELPERS INTERNOS
    // ══════════════════════════════════════════════════════════

    async _cmd(msg, fn) {
        if (!this.isAuthorized(msg.from.id)) return;
        try { await fn(); } catch (err) { console.error('Erro no cmd:', err); }
    }

    async _handleCallback(query) {
        const { data, message, from } = query;
        const chatId = message.chat.id;
        const msgId = message.message_id;

        try {
            // Limpar state de fluxo ao navegar no menu
            if (['menu_main', 'menu_conversations', 'menu_contacts', 'menu_send', 'menu_stats', 'menu_help'].includes(data)) {
                this.userState.delete(from.id);
            }

            if (data === 'menu_main')          await this.showMainMenu(chatId, msgId);
            else if (data === 'menu_conversations') await this.showConversationsPage(chatId, 1, msgId);
            else if (data === 'menu_contacts')  await this.showContactsPage(chatId, 1, msgId);
            else if (data === 'menu_send')      await this._startSendFlow(chatId, from.id, msgId);
            else if (data === 'menu_stats')     await this.showStats(chatId, msgId);
            else if (data === 'menu_help')      await this.showHelp(chatId, msgId);
            else if (data.startsWith('conv_page_')) {
                const page = parseInt(data.split('_')[2]);
                await this.showConversationsPage(chatId, page, msgId);
            }
            else if (data.startsWith('conv_open_')) {
                const contactId = data.slice('conv_open_'.length);
                await this.openConversation(chatId, contactId);
            }
            else if (data.startsWith('conv_reply_')) {
                const contactId = data.slice('conv_reply_'.length);
                await this._promptReply(chatId, from.id, contactId);
            }
            else if (data.startsWith('conv_media_')) {
                const contactId = data.slice('conv_media_'.length);
                await this.loadConversationMedia(chatId, contactId, 1);
            }
            else if (data.startsWith('media_page_')) {
                const raw = data.slice('media_page_'.length);
                const sep = raw.lastIndexOf('__');
                const contactId = raw.slice(0, sep);
                const page = parseInt(raw.slice(sep + 2));
                await this.loadConversationMedia(chatId, contactId, page);
            }
            else if (data.startsWith('contact_page_')) {
                const page = parseInt(data.split('_')[2]);
                await this.showContactsPage(chatId, page, msgId);
            }
            else if (data.startsWith('contact_open_')) {
                const contactId = data.slice('contact_open_'.length);
                await this.openConversation(chatId, contactId);
            }
            else if (data === 'send_new') {
                await this._startSendFlow(chatId, from.id, msgId);
            }

            await this.bot.answerCallbackQuery(query.id);
        } catch (err) {
            console.error('Erro no callback:', err);
            try { await this.bot.answerCallbackQuery(query.id, { text: '❌ Erro ao processar' }); } catch {}
        }
    }

    // ══════════════════════════════════════════════════════════
    // 🏠 MENU PRINCIPAL
    // ══════════════════════════════════════════════════════════

    async showMainMenu(chatId, editMsgId = null) {
        const waStatus = this.whatsappClient?.status || 'disconnected';
        const waIcon = waStatus === 'connected' ? '🟢' : '🔴';
        const waLabel = waStatus === 'connected' ? 'Conectado' : 'Desconectado';

        const text =
            `🤖 *Bot Multiplataforma*\n\n` +
            `${waIcon} WhatsApp: *${waLabel}*\n` +
            `🟢 Telegram: *Conectado*\n\n` +
            `Escolha uma opção:`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '💬 Conversas', callback_data: 'menu_conversations' },
                    { text: '👥 Contatos', callback_data: 'menu_contacts' }
                ],
                [
                    { text: '📤 Enviar Mensagem', callback_data: 'menu_send' }
                ],
                [
                    { text: '📊 Estatísticas', callback_data: 'menu_stats' },
                    { text: '❓ Ajuda', callback_data: 'menu_help' }
                ]
            ]
        };

        await this._send(chatId, text, { reply_markup: keyboard }, editMsgId);
    }

    // ══════════════════════════════════════════════════════════
    // 💬 CONVERSAS (25 por página)
    // ══════════════════════════════════════════════════════════

    async showConversationsPage(chatId, page = 1, editMsgId = null) {
        const limit = 25;
        const offset = (page - 1) * limit;

        const [conversas, total] = await Promise.all([
            this.db.getConversations(limit, offset),
            this.db.getConversationsCount()
        ]);

        const totalPages = Math.max(Math.ceil(total / limit), 1);

        if (conversas.length === 0 && page === 1) {
            const text =
                '📭 *Nenhuma conversa encontrada.*\n\n' +
                'As conversas aparecem quando você recebe mensagens no WhatsApp.';
            const keyboard = { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu_main' }]] };
            await this._send(chatId, text, { reply_markup: keyboard }, editMsgId);
            return;
        }

        let texto = `💬 *Conversas — Página ${page}/${totalPages}*\n`;
        texto += `📊 Total: *${total}* conversas\n`;
        texto += `${'─'.repeat(28)}\n\n`;

        const keyboard = { inline_keyboard: [] };

        for (const conv of conversas) {
            const nome = await this.getContactName(conv.contact);
            const unread = conv.unread_count > 0 ? ` 🔴${conv.unread_count}` : '';
            const preview = conv.last_message
                ? this._esc(conv.last_message.substring(0, 30)) + (conv.last_message.length > 30 ? '…' : '')
                : '_(sem mensagens)_';
            const platform = conv.platform === 'whatsapp' ? '📱' : '🤖';

            texto += `${platform}${unread} *${this._esc(nome)}*\n`;
            texto += `└ ${preview}\n\n`;

            keyboard.inline_keyboard.push([{
                text: `${platform} ${nome}${unread}`,
                callback_data: `conv_open_${conv.contact}`
            }]);
        }

        // Navegação de páginas
        const navRow = [];
        if (page > 1) navRow.push({ text: '⬅️ Anterior', callback_data: `conv_page_${page - 1}` });
        if (page < totalPages) navRow.push({ text: 'Próxima ➡️', callback_data: `conv_page_${page + 1}` });
        if (navRow.length > 0) keyboard.inline_keyboard.push(navRow);

        keyboard.inline_keyboard.push([
            { text: '📤 Enviar Nova', callback_data: 'menu_send' },
            { text: '🏠 Menu', callback_data: 'menu_main' }
        ]);

        await this._send(chatId, texto, { reply_markup: keyboard }, editMsgId);
    }

    // ══════════════════════════════════════════════════════════
    // 📖 ABRIR CONVERSA
    // ══════════════════════════════════════════════════════════

    async openConversation(chatId, contactId) {
        if (!this._waConnected()) {
            await this.bot.sendMessage(chatId, '❌ WhatsApp desconectado. Reconecte primeiro.');
            return;
        }

        const loading = await this.bot.sendMessage(chatId, '⏳ _Carregando conversa..._', { parse_mode: 'Markdown' });

        try {
            const chat = await this.whatsappClient.client.getChatById(contactId);
            const msgs = await chat.fetchMessages({ limit: 20 });
            const nome = await this.getContactName(contactId);

            await this.bot.deleteMessage(chatId, loading.message_id).catch(() => {});

            if (msgs.length === 0) {
                await this.bot.sendMessage(chatId, '📭 Nenhuma mensagem encontrada.', {
                    reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_conversations' }]] }
                });
                return;
            }

            // Marcar como lida
            this.db.markAsRead('whatsapp', contactId);

            let texto = `📖 *${this._esc(nome)}*\n`;
            texto += `🆔 \`${contactId}\`\n`;
            texto += `${'─'.repeat(28)}\n\n`;

            const mediaMessages = [];

            for (const m of msgs) {
                const hora = new Date(m.timestamp * 1000).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit',
                    hour: '2-digit', minute: '2-digit'
                });
                const icon = m.fromMe ? '📤' : '📥';

                if (m.hasMedia) {
                    texto += `${icon} \`${hora}\` 📎 _[Mídia]_\n`;
                    mediaMessages.push(m);
                } else if (m.body) {
                    const corpo = this._esc(m.body.substring(0, 300));
                    texto += `${icon} \`${hora}\`\n${corpo}\n\n`;
                }
            }

            texto += `\n💡 _Toque em "Responder" ou use o botão abaixo_`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '✍️ Responder', callback_data: `conv_reply_${contactId}` },
                        { text: '📎 Ver Mídias', callback_data: `conv_media_${contactId}` }
                    ],
                    [
                        { text: '💬 Conversas', callback_data: 'menu_conversations' },
                        { text: '🏠 Menu', callback_data: 'menu_main' }
                    ]
                ]
            };

            const sentMsg = await this.bot.sendMessage(chatId, texto, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

            // Registrar o message_id para reply pelo Telegram
            this.msgState.set(sentMsg.message_id, contactId);

            // Enviar mídias encontradas
            if (mediaMessages.length > 0) {
                await this.bot.sendMessage(chatId, `📎 Enviando ${mediaMessages.length} mídia(s)…`);
                await this.sendMediaBatch(chatId, mediaMessages, contactId);
            }

        } catch (err) {
            await this.bot.deleteMessage(chatId, loading.message_id).catch(() => {});
            await this.bot.sendMessage(chatId, `❌ Erro: ${err.message}`);
        }
    }

    // ══════════════════════════════════════════════════════════
    // 👥 CONTATOS
    // ══════════════════════════════════════════════════════════

    async showContactsPage(chatId, page = 1, editMsgId = null) {
        if (!this._waConnected()) {
            const text = '❌ WhatsApp desconectado. Contatos indisponíveis.';
            const opts = { reply_markup: { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu_main' }]] } };
            await this._send(chatId, text, opts, editMsgId);
            return;
        }

        const loadMsg = editMsgId ? null : await this.bot.sendMessage(chatId, '⏳ _Carregando contatos..._', { parse_mode: 'Markdown' });

        try {
            const all = await this.whatsappClient.client.getContacts();
            const saved = all.filter(c => c.isMyContact && !c.isGroup && c.id._serialized.endsWith('@c.us'));

            if (loadMsg) await this.bot.deleteMessage(chatId, loadMsg.message_id).catch(() => {});

            const limit = 20;
            const start = (page - 1) * limit;
            const pageItems = saved.slice(start, start + limit);
            const totalPages = Math.max(Math.ceil(saved.length / limit), 1);

            let texto = `👥 *Contatos — Página ${page}/${totalPages}*\n`;
            texto += `Total: *${saved.length}* contatos\n`;
            texto += `${'─'.repeat(28)}\n\n`;

            const keyboard = { inline_keyboard: [] };

            for (const c of pageItems) {
                const nome = c.name || c.pushname || c.id.user;
                texto += `• *${this._esc(nome)}* — \`+${c.id.user}\`\n`;
                keyboard.inline_keyboard.push([{
                    text: `💬 ${nome}`,
                    callback_data: `contact_open_${c.id._serialized}`
                }]);
            }

            const navRow = [];
            if (page > 1) navRow.push({ text: '⬅️ Anterior', callback_data: `contact_page_${page - 1}` });
            if (page < totalPages) navRow.push({ text: 'Próxima ➡️', callback_data: `contact_page_${page + 1}` });
            if (navRow.length > 0) keyboard.inline_keyboard.push(navRow);

            keyboard.inline_keyboard.push([
                { text: '📤 Enviar Mensagem', callback_data: 'menu_send' },
                { text: '🏠 Menu', callback_data: 'menu_main' }
            ]);

            await this._send(chatId, texto, { reply_markup: keyboard }, editMsgId);

        } catch (err) {
            if (loadMsg) await this.bot.deleteMessage(chatId, loadMsg.message_id).catch(() => {});
            await this.bot.sendMessage(chatId, `❌ Erro ao buscar contatos: ${err.message}`);
        }
    }

    // ══════════════════════════════════════════════════════════
    // 📤 FLUXO DE ENVIO (state machine)
    // ══════════════════════════════════════════════════════════

    async _startSendFlow(chatId, userId, editMsgId = null) {
        this.userState.set(userId, { action: 'awaiting_recipient' });

        const text =
            '📤 *Enviar Mensagem*\n\n' +
            '1️⃣ Digite o número de destino:\n' +
            '   _ex: 5511999999999_\n\n' +
            '_Ou cole diretamente o ID: `5511999999999@c.us`_';

        const opts = {
            reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'menu_main' }]] }
        };

        await this._send(chatId, text, opts, editMsgId);
    }

    async _handleFlowMessage(msg, state) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;

        if (state.action === 'awaiting_recipient') {
            let contactId = (msg.text || '').trim();
            if (!contactId.includes('@')) {
                contactId = `${contactId.replace(/\D/g, '')}@c.us`;
            }

            this.userState.set(userId, { action: 'awaiting_message', contactId });

            const nome = await this.getContactName(contactId);
            await this.bot.sendMessage(
                chatId,
                `👤 Destinatário: *${this._esc(nome)}* (\`${contactId}\`)\n\n` +
                `2️⃣ Agora envie a mensagem ou mídia:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'menu_main' }]] }
                }
            );
            return;
        }

        if (state.action === 'awaiting_message') {
            const { contactId } = state;
            this.userState.delete(userId);

            if (!this._waConnected()) {
                await this.bot.sendMessage(chatId, '❌ WhatsApp desconectado.');
                return;
            }

            try {
                if (msg.text) {
                    await this.whatsappClient.client.sendMessage(contactId, msg.text);
                } else {
                    await this._sendMediaToWhatsApp(msg, contactId);
                }

                const nome = await this.getContactName(contactId);
                await this.bot.sendMessage(
                    chatId,
                    `✅ Mensagem enviada para *${this._esc(nome)}*!`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '📤 Enviar Outra', callback_data: 'send_new' },
                                    { text: '📖 Ver Conversa', callback_data: `conv_open_${contactId}` }
                                ],
                                [{ text: '🏠 Menu', callback_data: 'menu_main' }]
                            ]
                        }
                    }
                );
            } catch (err) {
                await this.bot.sendMessage(chatId, `❌ Erro: ${err.message}`);
            }
            return;
        }

        this.userState.delete(userId);
    }

    async _promptReply(chatId, userId, contactId) {
        this.userState.set(userId, { action: 'awaiting_message', contactId });

        const nome = await this.getContactName(contactId);
        await this.bot.sendMessage(
            chatId,
            `✍️ *Responder para ${this._esc(nome)}*\n\nDigite a mensagem ou envie uma mídia/áudio:`,
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: `conv_open_${contactId}` }]] }
            }
        );
    }

    // ══════════════════════════════════════════════════════════
    // 📎 MÍDIAS
    // ══════════════════════════════════════════════════════════

    async loadConversationMedia(chatId, contactId, page = 1) {
        if (!this._waConnected()) {
            await this.bot.sendMessage(chatId, '❌ WhatsApp desconectado.');
            return;
        }

        const loading = await this.bot.sendMessage(chatId, '⏳ _Buscando mídias..._', { parse_mode: 'Markdown' });

        try {
            const chat = await this.whatsappClient.client.getChatById(contactId);
            const allMsgs = await chat.fetchMessages({ limit: 100 });
            const midias = allMsgs.filter(m => m.hasMedia);

            await this.bot.deleteMessage(chatId, loading.message_id).catch(() => {});

            if (midias.length === 0) {
                await this.bot.sendMessage(chatId, '📭 Nenhuma mídia encontrada nesta conversa.', {
                    reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: `conv_open_${contactId}` }]] }
                });
                return;
            }

            const limit = 5;
            const start = (page - 1) * limit;
            const batch = midias.slice(start, start + limit);
            const totalPages = Math.max(Math.ceil(midias.length / limit), 1);

            await this.bot.sendMessage(
                chatId,
                `📎 *Mídias — Página ${page}/${totalPages}* (${midias.length} no total)`,
                { parse_mode: 'Markdown' }
            );

            await this.sendMediaBatch(chatId, batch, contactId);

            const keyboard = { inline_keyboard: [] };
            const navRow = [];
            if (page > 1) navRow.push({ text: '⬅️', callback_data: `media_page_${contactId}__${page - 1}` });
            if (page < totalPages) navRow.push({ text: '➡️', callback_data: `media_page_${contactId}__${page + 1}` });
            if (navRow.length > 0) keyboard.inline_keyboard.push(navRow);

            keyboard.inline_keyboard.push([
                { text: '✍️ Responder', callback_data: `conv_reply_${contactId}` },
                { text: '⬅️ Conversa', callback_data: `conv_open_${contactId}` }
            ]);

            await this.bot.sendMessage(chatId, `Página ${page}/${totalPages}`, { reply_markup: keyboard });

        } catch (err) {
            await this.bot.deleteMessage(chatId, loading.message_id).catch(() => {});
            await this.bot.sendMessage(chatId, `❌ Erro: ${err.message}`);
        }
    }

    async sendMediaBatch(chatId, midias, contactId) {
        for (const m of midias) {
            try {
                const media = await m.downloadMedia();
                if (!media) continue;

                const buffer = Buffer.from(media.data, 'base64');
                const icon = m.fromMe ? '📤' : '📥';
                const nome = await this.getContactName(contactId);
                const hora = new Date(m.timestamp * 1000).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                });
                const legenda = `${icon} *${this._esc(nome)}* — ${hora}` +
                    (m.body ? `\n💬 ${this._esc(m.body.substring(0, 100))}` : '');
                const opts = { caption: legenda, parse_mode: 'Markdown' };

                if (media.mimetype.startsWith('image/')) {
                    await this.bot.sendPhoto(chatId, buffer, opts);
                } else if (media.mimetype.startsWith('video/')) {
                    await this.bot.sendVideo(chatId, buffer, opts);
                } else if (media.mimetype.startsWith('audio/') || media.mimetype.includes('ogg')) {
                    await this.bot.sendVoice(chatId, buffer, opts);
                } else {
                    await this.bot.sendDocument(chatId, buffer, {
                        ...opts,
                        filename: media.filename || 'arquivo'
                    });
                }

                await new Promise(r => setTimeout(r, 300));
            } catch (err) {
                console.error('Erro ao enviar mídia:', err.message);
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // 📊 ESTATÍSTICAS
    // ══════════════════════════════════════════════════════════

    async showStats(chatId, editMsgId = null) {
        try {
            const stats = await this.db.getConversationStats();
            const waStatus = this.whatsappClient?.status || 'desconectado';
            const waIcon = waStatus === 'connected' ? '🟢' : '🔴';

            const text =
                `📊 *Estatísticas*\n\n` +
                `💬 Conversas: *${stats.total_conversations}*\n` +
                `🔴 Não Lidas: *${stats.total_unread}*\n\n` +
                `${waIcon} WhatsApp: *${waStatus}*\n` +
                `🟢 Telegram: *conectado*`;

            const opts = {
                reply_markup: { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu_main' }]] }
            };

            await this._send(chatId, text, opts, editMsgId);
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ Erro: ${err.message}`);
        }
    }

    // ══════════════════════════════════════════════════════════
    // ❓ AJUDA
    // ══════════════════════════════════════════════════════════

    async showHelp(chatId, editMsgId = null) {
        const text =
            '❓ *Ajuda — Comandos e Funcionalidades*\n\n' +
            '📋 *Menu Principal:*\n' +
            '• 💬 Conversas — todas as conversas (25/página)\n' +
            '• 👥 Contatos — lista de contatos do WhatsApp\n' +
            '• 📤 Enviar Mensagem — enviar para qualquer número\n' +
            '• 📊 Estatísticas — resumo geral\n\n' +
            '📖 *Dentro de uma conversa:*\n' +
            '• ✍️ Responder — escrever e enviar mensagem\n' +
            '• 📎 Ver Mídias — fotos, vídeos e áudios paginados\n\n' +
            '🎙️ *Envio de mídia:*\n' +
            '• No fluxo de envio, envie foto, áudio ou documento\n' +
            '• Ou faça "Responder" (reply) em qualquer mensagem de conversa\n\n' +
            '⌨️ *Comandos:*\n' +
            '`/start` — menu principal\n' +
            '`/c` — lista de conversas\n' +
            '`/contatos` — lista de contatos\n' +
            '`/ler <id>` — abrir conversa por ID\n' +
            '`/w <id> <msg>` — envio rápido';

        const opts = {
            reply_markup: { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu_main' }]] }
        };

        await this._send(chatId, text, opts, editMsgId);
    }

    // ══════════════════════════════════════════════════════════
    // 🔄 ENCAMINHAR DO WHATSAPP → TELEGRAM
    // ══════════════════════════════════════════════════════════

    async forwardFromWhatsApp(whatsappMessage) {
        for (const userId of this.authorizedUsers) {
            try {
                const rawId = whatsappMessage.from;
                const nome = await this.getContactName(rawId);
                const hora = new Date(whatsappMessage.timestamp * 1000).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                });
                const header = `📥 *${this._esc(nome)}* — ${hora}\n🆔 \`${rawId}\``;

                const replyKeyboard = {
                    inline_keyboard: [[
                        { text: '✍️ Responder', callback_data: `conv_reply_${rawId}` },
                        { text: '📖 Abrir Conversa', callback_data: `conv_open_${rawId}` }
                    ]]
                };

                if (whatsappMessage.hasMedia) {
                    const media = await whatsappMessage.downloadMedia();
                    if (media) {
                        const buffer = Buffer.from(media.data, 'base64');
                        const legenda = header + (whatsappMessage.body ? `\n\n💬 ${this._esc(whatsappMessage.body)}` : '');
                        const opts = { caption: legenda, parse_mode: 'Markdown', reply_markup: replyKeyboard };

                        if (media.mimetype.startsWith('image/'))        await this.bot.sendPhoto(userId, buffer, opts);
                        else if (media.mimetype.startsWith('video/'))   await this.bot.sendVideo(userId, buffer, opts);
                        else if (media.mimetype.startsWith('audio/') || media.mimetype.includes('ogg')) await this.bot.sendVoice(userId, buffer, opts);
                        else                                             await this.bot.sendDocument(userId, buffer, opts);
                        continue;
                    }
                }

                const sentMsg = await this.bot.sendMessage(
                    userId,
                    `${header}\n\n${this._esc(whatsappMessage.body || '')}`,
                    { parse_mode: 'Markdown', reply_markup: replyKeyboard }
                );

                // Registrar para reply
                this.msgState.set(sentMsg.message_id, rawId);

            } catch (err) {
                console.error('Erro ao encaminhar:', err);
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // 🛠️ AUXILIARES
    // ══════════════════════════════════════════════════════════

    async sendWhatsAppMessage(chatId, destinoId, texto) {
        if (!this._waConnected()) {
            await this.bot.sendMessage(chatId, '❌ WhatsApp desconectado.');
            return;
        }
        try {
            await this.whatsappClient.client.sendMessage(destinoId, texto);
            await this.bot.sendMessage(
                chatId,
                `✅ *Enviado!*\n\n_${this._esc(texto)}_`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '📖 Ver Conversa', callback_data: `conv_open_${destinoId}` }]] }
                }
            );
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ Erro: ${err.message}`);
        }
    }

    _extractContactFromReply(replyMessage) {
        const text = replyMessage.text || replyMessage.caption || '';

        // Formato: `5511999999999@c.us`
        const match = text.match(/`([0-9]+@[cg]\.us)`/);
        if (match) return match[1];

        // Estado salvo por message_id
        const saved = this.msgState.get(replyMessage.message_id);
        if (saved) return saved;

        return null;
    }

    async _handleReply(msg, contactId) {
        if (!this._waConnected()) {
            await this.bot.sendMessage(msg.chat.id, '❌ WhatsApp desconectado.');
            return;
        }
        try {
            if (msg.text) {
                await this.whatsappClient.client.sendMessage(contactId, msg.text);
            } else {
                await this._sendMediaToWhatsApp(msg, contactId);
            }
            const nome = await this.getContactName(contactId);
            await this.bot.sendMessage(
                msg.chat.id,
                `✅ Enviado para *${this._esc(nome)}*!`,
                { parse_mode: 'Markdown' }
            );
        } catch (err) {
            await this.bot.sendMessage(msg.chat.id, `❌ Erro: ${err.message}`);
        }
    }

    async _sendMediaToWhatsApp(msg, contactId) {
        let fileId, mimeType;

        if (msg.voice)    { fileId = msg.voice.file_id;    mimeType = msg.voice.mime_type || 'audio/ogg'; }
        else if (msg.audio)    { fileId = msg.audio.file_id;    mimeType = msg.audio.mime_type; }
        else if (msg.photo)    { fileId = msg.photo[msg.photo.length - 1].file_id; mimeType = 'image/jpeg'; }
        else if (msg.document) { fileId = msg.document.file_id; mimeType = msg.document.mime_type; }
        else throw new Error('Tipo de mídia não suportado');

        const fileLink = await this.bot.getFileLink(fileId);
        const response = await fetch(fileLink);
        const buffer = Buffer.from(await response.arrayBuffer());

        const media = new MessageMedia(mimeType, buffer.toString('base64'), 'arquivo');
        const options = msg.voice ? { sendAudioAsVoice: true } : {};

        await this.whatsappClient.client.sendMessage(contactId, media, options);
    }

    async getContactName(contactId) {
        if (this.contactCache.has(contactId)) return this.contactCache.get(contactId);

        try {
            if (this.whatsappClient?.client) {
                const c = await this.whatsappClient.client.getContactById(contactId);
                const nome = c.name || c.pushname || contactId.split('@')[0];
                this.contactCache.set(contactId, nome);
                return nome;
            }
        } catch {}

        const nome = contactId.split('@')[0];
        this.contactCache.set(contactId, nome);
        return nome;
    }

    // Envia ou edita mensagem com parse_mode: Markdown
    async _send(chatId, text, opts = {}, editMsgId = null) {
        const options = { parse_mode: 'Markdown', ...opts };
        if (editMsgId) {
            await this.bot.editMessageText(text, { chat_id: chatId, message_id: editMsgId, ...options });
        } else {
            await this.bot.sendMessage(chatId, text, options);
        }
    }

    // Escape de caracteres especiais do Markdown V1 do Telegram
    _esc(text) {
        if (!text) return '';
        return String(text)
            .replace(/\*/g, '\\*')
            .replace(/_/g, '\\_')
            .replace(/`/g, '\\`')
            .replace(/\[/g, '\\[');
    }

    _waConnected() {
        return this.whatsappClient && this.whatsappClient.status === 'connected';
    }

    isAuthorized(userId) {
        return this.authorizedUsers.length === 0 || this.authorizedUsers.includes(userId.toString());
    }
}

module.exports = TelegramBotClient;
