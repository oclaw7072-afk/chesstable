# ♞ ChessTable

Xadrez com cartas especiais, moedas, maço de compra, contas com confirmação por
e-mail, busca de partida online (matchmaking) e rating estilo chess.com (Glicko).

**Zero dependências**: só precisa do Node.js (versão 16 ou mais nova). Não há `npm install`.

---

## Rodar localmente

```bash
node server.js
```

Abra http://localhost:3000 — pronto. Sem SMTP configurado o servidor entra em
**modo demonstração**: o link de confirmação de conta aparece na própria tela
(e no console do servidor) em vez de ser enviado por e-mail.

O banco de dados fica em `db.json` (criado automaticamente): usuários (com a
senha protegida por hash scrypt + sal — nunca em texto puro), ratings e sessões.

---

## Colocar na internet (passo a passo)

O jeito mais simples e gratuito é o [Render](https://render.com) (funciona
igual no Railway, Fly.io ou qualquer VPS):

1. Crie uma conta no Render e um repositório no GitHub com esta pasta
   (`server.js`, `engine.js`, `public/`).
2. No Render: **New → Web Service** → conecte o repositório.
   - Runtime: **Node**
   - Build command: *(vazio — não precisa)*
   - Start command: `node server.js`
3. Em **Disks**, adicione um disco persistente (1 GB) montado em `/data` e
   defina a variável de ambiente `DB_FILE=/data/db.json` — assim as contas
   sobrevivem a reinícios.
4. Publique. Seu jogo estará em `https://chesstable.onrender.com`
   (escolha "chesstable" como nome do serviço).

### Domínio próprio (chesstable)

1. Registre o domínio num registrador: **chesstable.com.br** no
   [Registro.br](https://registro.br) (~R$40/ano) ou **chesstable.com** em
   registradores internacionais (Namecheap, Cloudflare, ~US$10/ano).
   *(Obs.: a disponibilidade do nome precisa ser verificada na hora da compra.)*
2. No Render: **Settings → Custom Domains → Add** e digite o domínio.
3. No registrador, crie o registro DNS `CNAME` apontando para o endereço
   que o Render indicar. O HTTPS é emitido automaticamente.
4. Crie um `config.json` (ou defina no código) com
   `"baseUrl": "https://chesstable.com.br"` para que os links de
   confirmação de e-mail usem o domínio final.

### E-mails de verdade (link de confirmação)

**No Render (plano grátis)** as portas SMTP são bloqueadas, então use a API HTTPS
da Brevo (300 e-mails/dia grátis). Em **Environment** do serviço, defina:

| Variável | Valor |
|---|---|
| `BREVO_API_KEY` | chave criada em Brevo → SMTP & API → API Keys |
| `MAIL_FROM` | `ChessTable <remetente-verificado@...>` (remetente verificado na Brevo) |
| `BASE_URL` | `https://chesstable.onrender.com` (ou seu domínio) |

**Fora do Render ou em plano pago**, também dá para usar SMTP direto:

Copie `config.example.json` para `config.json` e preencha um SMTP:

- **Brevo** (300 e-mails/dia grátis) ou **SendGrid**: crie a conta, gere as
  credenciais SMTP e preencha host/porta/usuário/senha.
- **Gmail**: ative a verificação em 2 etapas e crie uma "senha de app";
  host `smtp.gmail.com`, porta `465`.

Sem `config.json`, o modo demonstração continua funcionando normalmente.

---

## Como funciona por dentro

| Peça | Implementação |
|---|---|
| Servidor HTTP + WebSocket | Node puro (RFC 6455 implementado à mão) |
| Banco de dados | `db.json` com gravação atômica |
| Senhas | hash `scrypt` com sal + comparação em tempo constante |
| Confirmação de conta | token único por e-mail (SMTP em TLS, cliente próprio) |
| Matchmaking | fila; pareia os 2 primeiros; cores sorteadas |
| Partida rankeada | o servidor roda o MESMO motor (`engine.js`) e valida cada lance |
| Rating | Glicko-1 (como o chess.com): início 1200, RD 350→50, provisório oscila mais |
| Abandono/queda | derrota de quem saiu |

Os modos "sala com código" (P2P), "mesmo PC" e "treino" continuam funcionando
até abrindo o `public/index.html` como arquivo, sem servidor.
