-- ============================================================
--  FinanceGest — Schema Supabase
--  Cole este SQL no SQL Editor do Supabase e execute tudo de uma vez
-- ============================================================

-- 1. TABELA DE ROLES (admin / operador)
create table if not exists user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null unique,
  role       text not null check (role in ('admin','operador')),
  created_at timestamptz default now()
);

-- 2. CONTAS A PAGAR
create table if not exists contas_pagar (
  id          uuid primary key default gen_random_uuid(),
  descricao   text not null,
  contraparte text,
  categoria   text,
  valor       numeric(14,2) not null,
  vencimento  date not null,
  status      text default 'pendente' check (status in ('pendente','pago','vencido')),
  criado_por  uuid references auth.users(id),
  created_at  timestamptz default now()
);

-- 3. CONTAS A RECEBER
create table if not exists contas_receber (
  id          uuid primary key default gen_random_uuid(),
  descricao   text not null,
  contraparte text,
  categoria   text,
  valor       numeric(14,2) not null,
  vencimento  date not null,
  status      text default 'pendente' check (status in ('pendente','recebido','vencido')),
  criado_por  uuid references auth.users(id),
  created_at  timestamptz default now()
);

-- 4. MÁQUINAS
create table if not exists maquinas (
  id                uuid primary key default gen_random_uuid(),
  marca             text not null,
  modelo            text not null,
  ano               int,
  placa             text,
  tipo              text,
  horimetro_inicial numeric(10,1) default 0,
  valor_compra      numeric(14,2),
  data_aquisicao    date,
  vida_util         int default 10,
  valor_residual    numeric(14,2) default 0,
  obs               text,
  created_at        timestamptz default now()
);

-- 5. DOCUMENTOS DAS MÁQUINAS
create table if not exists documentos (
  id          uuid primary key default gen_random_uuid(),
  maquina_id  uuid references maquinas(id) on delete cascade not null,
  tipo        text not null,
  numero      text,
  emissao     date,
  vencimento  date,
  obs         text,
  created_at  timestamptz default now()
);

-- 6. HORÍMETRO
create table if not exists horimetro (
  id             uuid primary key default gen_random_uuid(),
  maquina_id     uuid references maquinas(id) on delete cascade not null,
  data           date not null,
  leitura        numeric(10,1) not null,
  obs            text,
  registrado_por uuid references auth.users(id),
  created_at     timestamptz default now()
);

-- ============================================================
--  RLS — Row Level Security
--  Todos os usuários autenticados têm acesso de leitura.
--  Escrita em dados financeiros: apenas admin.
--  Máquinas/docs/horímetro: qualquer autenticado pode inserir.
-- ============================================================

alter table user_roles     enable row level security;
alter table contas_pagar   enable row level security;
alter table contas_receber enable row level security;
alter table maquinas       enable row level security;
alter table documentos     enable row level security;
alter table horimetro      enable row level security;

-- user_roles: cada user vê só o próprio
create policy "user_roles_select" on user_roles for select using (auth.uid() = user_id);

-- helper: verifica se usuário logado é admin
create or replace function is_admin()
returns boolean language sql security definer as $$
  select exists (
    select 1 from user_roles where user_id = auth.uid() and role = 'admin'
  );
$$;

-- contas_pagar: somente admin
create policy "pagar_select" on contas_pagar for select using (is_admin());
create policy "pagar_insert" on contas_pagar for insert with check (is_admin());
create policy "pagar_update" on contas_pagar for update using (is_admin());
create policy "pagar_delete" on contas_pagar for delete using (is_admin());

-- contas_receber: somente admin
create policy "receber_select" on contas_receber for select using (is_admin());
create policy "receber_insert" on contas_receber for insert with check (is_admin());
create policy "receber_update" on contas_receber for update using (is_admin());
create policy "receber_delete" on contas_receber for delete using (is_admin());

-- maquinas: todos leem, apenas admin escreve
create policy "maquinas_select" on maquinas for select using (auth.role() = 'authenticated');
create policy "maquinas_insert" on maquinas for insert with check (is_admin());
create policy "maquinas_update" on maquinas for update using (is_admin());
create policy "maquinas_delete" on maquinas for delete using (is_admin());

-- documentos: todos leem, apenas admin insere/deleta
create policy "docs_select"  on documentos for select using (auth.role() = 'authenticated');
create policy "docs_insert"  on documentos for insert with check (is_admin());
create policy "docs_delete"  on documentos for delete using (is_admin());

-- horimetro: todos leem e inserem (operador pode registrar horas), apenas admin deleta
create policy "hora_select"  on horimetro for select using (auth.role() = 'authenticated');
create policy "hora_insert"  on horimetro for insert with check (auth.role() = 'authenticated');
create policy "hora_delete"  on horimetro for delete using (is_admin());

-- ============================================================
--  CRIAR USUÁRIOS
--  Após rodar o schema, crie os usuários no Supabase:
--  Authentication → Users → Invite user (ou Add user)
--  Depois insira os roles aqui:
-- ============================================================
--
-- insert into user_roles (user_id, role) values
--   ('<UUID_DO_ADMIN>',    'admin'),
--   ('<UUID_DO_OPERADOR>', 'operador');
--
-- ============================================================
