# FinanceGest — Guia de instalação em nuvem
## Tempo estimado: 20 minutos

---

## PASSO 1 — Criar banco de dados no Supabase (gratuito)

1. Acesse https://supabase.com e crie uma conta (gratuito)
2. Clique em **New project**
   - Nome: `financeggest`
   - Senha do banco: anote em lugar seguro
   - Região: **South America (São Paulo)**
3. Aguarde o projeto criar (~2 min)
4. No menu lateral, vá em **SQL Editor**
5. Cole todo o conteúdo do arquivo `schema.sql` e clique em **Run**
   - Isso cria as tabelas, regras de acesso e segurança

---

## PASSO 2 — Copiar as credenciais do Supabase

1. No menu lateral do Supabase, clique em **Project Settings → API**
2. Copie:
   - **Project URL** → algo como `https://xyzxyz.supabase.co`
   - **anon public** (chave pública) → longa sequência de letras
3. Abra o arquivo `public/config.js` e substitua:
   ```js
   const SUPABASE_URL  = 'https://xyzxyz.supabase.co';   // sua URL
   const SUPABASE_ANON = 'eyJhbGci...';                   // sua anon key
   ```

---

## PASSO 3 — Criar os usuários

1. No Supabase, vá em **Authentication → Users**
2. Clique em **Add user** e crie os 2 usuários:
   - Admin: `filipe@suaempresa.com` + senha
   - Operador: `operador@suaempresa.com` + senha
3. Copie o **UUID** de cada usuário (coluna ID)
4. Vá em **SQL Editor** e execute:
   ```sql
   insert into user_roles (user_id, role) values
     ('<UUID_DO_FILIPE>',    'admin'),
     ('<UUID_DO_OPERADOR>', 'operador');
   ```

---

## PASSO 4 — Publicar no Vercel (gratuito)

### Opção A — Via GitHub (recomendado)
1. Crie uma conta em https://github.com (gratuito)
2. Crie um repositório novo, faça upload de todos os arquivos desta pasta
3. Acesse https://vercel.com, crie conta e clique **Add New Project**
4. Importe o repositório do GitHub
5. Clique **Deploy** — pronto, o site ficará em `https://financeggest.vercel.app`

### Opção B — Via Vercel CLI (mais rápido)
1. Instale o Node.js: https://nodejs.org
2. No terminal, dentro desta pasta, execute:
   ```bash
   npm install -g vercel
   vercel login
   vercel --prod
   ```
3. Siga as instruções na tela

---

## PASSO 5 — Acessar o sistema

- URL: o endereço gerado pelo Vercel (ex: `https://financeggest.vercel.app`)
- Login com os e-mails e senhas criados no Passo 3
- **Admin** vê tudo: financeiro + máquinas
- **Operador** vê: dashboard de máquinas, registra horímetro, consulta documentos

---

## Estrutura dos arquivos

```
financeggest/
├── public/
│   ├── index.html    ← toda a interface do sistema
│   ├── app.js        ← toda a lógica (dados, gráficos, autenticação)
│   └── config.js     ← suas credenciais Supabase (preencher no passo 2)
├── schema.sql        ← rode este arquivo no Supabase (passo 1)
├── vercel.json       ← configuração de hospedagem
└── LEIAME.md         ← este arquivo
```

---

## Segurança

- Senhas gerenciadas pelo Supabase (nunca ficam no código)
- RLS (Row Level Security) ativado: operador não acessa dados financeiros mesmo tentando pela API
- Conexão HTTPS automática via Vercel
- Dados ficam no servidor do Supabase em São Paulo

---

## Suporte / Expansões futuras

Funcionalidades que podem ser adicionadas futuramente:
- Importação OFX do Itaú (extrato bancário)
- Módulo de manutenções programadas por horímetro
- Relatório de depreciação em PDF
- Notificações por e-mail para documentos próximos do vencimento
- App mobile (PWA)
