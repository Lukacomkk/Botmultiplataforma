# 🤖 Bot Multiplataforma — WhatsApp + Telegram

> Gerencie suas conversas do WhatsApp diretamente pelo Telegram. Receba mensagens, responda, envie mídias e acesse contatos — tudo pelo celular, sem precisar do WhatsApp aberto.

---

## 📋 Índice

- [Como funciona](#-como-funciona)
- [Funcionalidades](#-funcionalidades)
- [Pré-requisitos](#-pré-requisitos)
- [Instalação](#-instalação)
- [Configuração](#-configuração)
- [Uso](#-uso)
- [Interface Web](#-interface-web)
- [Comandos do Bot](#-comandos-do-bot)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Problemas Comuns](#-problemas-comuns)

---

## ⚙️ Como Funciona

```
┌─────────────┐        ┌──────────────────┐        ┌──────────────┐
│  WhatsApp   │◄──────►│  Bot Server      │◄──────►│   Telegram   │
│  (web.js)   │        │  (Node.js)       │        │    (você)    │
└─────────────┘        └──────────────────┘        └──────────────┘
                              │
                        ┌─────┴─────┐
                        │  SQLite   │
                        │ (histórico)│
                        └───────────┘
```

O servidor Node.js roda localmente na sua máquina e faz a ponte entre as duas plataformas:

1. **WhatsApp** é controlado via [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) — um cliente não-oficial que usa o WhatsApp Web através do Chromium (Puppeteer).
2. **Telegram** recebe todas as mensagens recebidas no WhatsApp em tempo real e permite responder, enviar mídias e gerenciar conversas via menu interativo.
3. **Interface Web** em `http://localhost:3000` oferece um dashboard alternativo com Socket.IO.

---

## ✨ Funcionalidades

### Telegram Bot
- **Menu interativo** com navegação por botões inline
- **💬 Conversas** — lista paginada (25 por página) com prévia e contador de não lidas
- **👥 Contatos** — todos os contatos do WhatsApp paginados (20 por página)
- **📤 Enviar Mensagem** — fluxo guiado: número → texto ou mídia
- **📎 Galeria de Mídias** — fotos, vídeos e áudios paginados (5 por página)
- **✍️ Responder** — responda diretamente de qualquer mensagem encaminhada
- **🔄 Encaminhamento automático** — mensagens chegam no Telegram com botões de resposta
- **📊 Estatísticas** — total de conversas e não lidas

### WhatsApp
- Autenticação via QR Code com sessão persistente (não precisa escanear toda vez)
- Envio e recebimento de texto, imagens, vídeos, áudios e documentos
- Monitor de reconexão automática

### Interface Web (`localhost:3000`)
- Dashboard em tempo real via Socket.IO
- Visualização de conversas e mensagens
- Envio de mensagens pelo navegador
- Exibição do QR Code para autenticação

---

## 📦 Pré-requisitos

| Requisito | Versão mínima |
|-----------|--------------|
| Node.js   | 18+          |
| npm       | 8+           |
| Chromium / Google Chrome | qualquer |
| Conta no WhatsApp | — |
| Bot no Telegram (via [@BotFather](https://t.me/BotFather)) | — |

> **Linux:** pode ser necessário instalar dependências do Chromium:
> ```bash
> sudo apt-get install -y chromium gconf-service libasound2 libatk1.0-0 \
>   libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
>   libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 \
>   libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 \
>   libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
>   libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6
> ```

---

## 🚀 Instalação

### 1. Clone o repositório

```bash
git clone https://github.com/seu-usuario/bot-multiplataforma.git
cd bot-multiplataforma
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure as variáveis de ambiente

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas configurações (veja a seção [Configuração](#-configuração)).

### 4. Inicie o servidor

```bash
# Produção
npm start

# Desenvolvimento (com auto-reload)
npm run dev
```

### 5. Escaneie o QR Code

Ao iniciar, um QR Code será exibido no terminal. Escaneie com o WhatsApp:

> WhatsApp → Menu (⋮) → Aparelhos conectados → Conectar um aparelho

Após escanear, a sessão é salva em `./whatsapp-session` e não precisará ser repetida.

---

## ⚙️ Configuração

Crie o arquivo `.env` na raiz do projeto:

```env
# ── Servidor ──────────────────────────────────
PORT=3000

# ── Telegram ──────────────────────────────────
# Token obtido em @BotFather no Telegram
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ

# IDs dos usuários autorizados (separados por vírgula)
# Descubra seu ID: envie /start para @userinfobot no Telegram
TELEGRAM_AUTHORIZED_USERS=123456789,987654321

# ── WhatsApp ───────────────────────────────────
# Caminho para salvar a sessão (padrão: ./whatsapp-session)
WHATSAPP_SESSION_PATH=./whatsapp-session

# (Opcional) Caminho do Chrome/Chromium, se não estiver no PATH
# CHROME_BIN=/usr/bin/chromium

# ── Banco de Dados ─────────────────────────────
DATABASE_PATH=./database.sqlite

# ── Logging ────────────────────────────────────
LOG_LEVEL=info
```

### Como criar um Bot no Telegram

1. Abra o Telegram e busque por **@BotFather**
2. Envie `/newbot`
3. Escolha um nome e um username para o bot (deve terminar em `bot`)
4. Copie o **token** gerado e cole em `TELEGRAM_BOT_TOKEN`

### Como descobrir seu ID no Telegram

1. Busque por **@userinfobot** no Telegram
2. Envie `/start`
3. Copie o número em **Id** e cole em `TELEGRAM_AUTHORIZED_USERS`

---

## 📱 Uso

### Primeiro acesso

Após iniciar o servidor e escanear o QR Code, abra o Telegram, encontre seu bot e envie `/start`.

```
/start
```

Você verá o menu principal:

```
🤖 Bot Multiplataforma

🟢 WhatsApp: Conectado
🟢 Telegram: Conectado

Escolha uma opção:
[ 💬 Conversas ]  [ 👥 Contatos ]
[   📤 Enviar Mensagem   ]
[ 📊 Estatísticas ] [ ❓ Ajuda ]
```

---

## 🎮 Comandos do Bot

| Comando | Descrição |
|---------|-----------|
| `/start` | Abre o menu principal |
| `/c` | Atalho para lista de conversas |
| `/contatos` | Lista de contatos do WhatsApp |
| `/ler <id>` | Abre o histórico de uma conversa |
| `/w <id> <mensagem>` | Envio rápido sem menu |

**Exemplos:**
```
/ler 5511999999999@c.us
/w 5511999999999@c.us Olá, tudo bem?
```

### Fluxo de Envio de Mensagem

1. Toque em **📤 Enviar Mensagem**
2. Digite o número no formato `5511999999999`
3. Envie o texto, foto, áudio ou documento

### Responder uma Mensagem

- **Via botão:** abra uma conversa e toque em **✍️ Responder**
- **Via reply:** faça "Responder" no Telegram sobre qualquer mensagem encaminhada e escreva o texto

---

## 🌐 Interface Web

Acesse `http://localhost:3000` no navegador para o dashboard:

- Visualize conversas e histórico de mensagens
- Envie mensagens por texto
- Gere e escaneie o QR Code do WhatsApp
- Sincronize o histórico de conversas clicando em **Baixar Histórico**

### Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/conversations` | Lista conversas |
| `GET` | `/api/conversations/:id/messages` | Mensagens de uma conversa |
| `POST` | `/api/send` | Envia mensagem |
| `POST` | `/api/sync` | Sincroniza histórico do WhatsApp |
| `GET` | `/api/contacts` | Lista contatos do WhatsApp |
| `GET` | `/api/status` | Status das conexões |

---

## 🗂️ Estrutura do Projeto

```
bot-multiplataforma/
├── server.js                  # Entry point — Express + Socket.IO
├── .env                       # Variáveis de ambiente (não versionar)
├── database.sqlite            # Banco de dados SQLite
│
├── core/
│   ├── config.js              # Carrega .env e valida configurações
│   ├── database.js            # Acesso ao SQLite (mensagens + conversas)
│   └── message-router.js      # Regras de roteamento entre plataformas
│
├── whatsapp/
│   ├── whatsapp-client.js     # Cliente whatsapp-web.js
│   └── session-manager.js     # Monitor de saúde e reconexão automática
│
├── telegram/
│   └── telegram-bot.js        # Bot com menu interativo completo
│
├── public/
│   ├── index.html             # Dashboard web
│   ├── app.js                 # Frontend JavaScript
│   └── style.css              # Estilos
│
└── whatsapp-session/          # Sessão persistente do WhatsApp (auto-gerado)
```

---

## 🛠️ Problemas Comuns

### QR Code não aparece / WhatsApp não conecta

```bash
# Verifique se o Chromium está instalado
chromium --version
# ou
google-chrome --version

# Se usar caminho customizado, configure no .env:
CHROME_BIN=/usr/bin/chromium
```

### Sessão expirada — precisa escanear novamente

```bash
# Apague a sessão salva e reinicie
rm -rf ./whatsapp-session
npm start
```

### Erro: "Token do Telegram não configurado"

Verifique se o arquivo `.env` existe na raiz do projeto e se `TELEGRAM_BOT_TOKEN` está preenchido corretamente.

### Bot do Telegram não responde

Certifique-se que seu ID está em `TELEGRAM_AUTHORIZED_USERS`. Para encontrar seu ID, envie `/start` para [@userinfobot](https://t.me/userinfobot) no Telegram.

### Erro de permissão no Linux (Puppeteer)

```bash
# Adicione a flag no .env ou edite whatsapp-client.js para incluir:
--no-sandbox
--disable-setuid-sandbox
```
> Essas flags já estão incluídas por padrão no código.

---

## 📄 Licença

MIT — use, modifique e distribua livremente.

---

> **Aviso:** Este projeto utiliza o [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), um cliente não-oficial do WhatsApp. O uso pode violar os [Termos de Serviço do WhatsApp](https://www.whatsapp.com/legal/terms-of-service). Use com responsabilidade.
