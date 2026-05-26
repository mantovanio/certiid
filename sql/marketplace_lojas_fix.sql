-- ================================================================
-- FIX DO MARKETPLACE PROPRIO
-- Execute este arquivo no Supabase SQL Editor para liberar:
-- 1. tabela public.lojas_marketplace
-- 2. leitura publica da vitrine
-- 3. vinculo da venda com a loja do marketplace
-- ================================================================

-- Requer que a funcao public.set_updated_at() ja exista.
-- Ela ja e criada nas migrations comerciais principais do projeto.

CREATE TABLE IF NOT EXISTS public.lojas_marketplace (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_loja         TEXT        NOT NULL,
  slug              TEXT        NOT NULL UNIQUE,
  tabela_preco_id   UUID        NOT NULL REFERENCES public.tabelas_preco(id) ON DELETE CASCADE,
  owner_tipo        TEXT        NOT NULL CHECK (owner_tipo IN ('institucional', 'vendedor', 'contador', 'parceiro', 'revendedor')),
  owner_profile_id  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  owner_parceiro_id UUID        REFERENCES public.parceiros(id) ON DELETE SET NULL,
  descricao         TEXT,
  dominio_publico   TEXT,
  ativo             BOOLEAN     NOT NULL DEFAULT TRUE,
  configuracoes     JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    owner_tipo = 'institucional'
    OR owner_profile_id IS NOT NULL
    OR owner_parceiro_id IS NOT NULL
  )
);

DROP TRIGGER IF EXISTS lojas_marketplace_set_updated_at ON public.lojas_marketplace;
CREATE TRIGGER lojas_marketplace_set_updated_at
  BEFORE UPDATE ON public.lojas_marketplace
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_lojas_marketplace_tabela
  ON public.lojas_marketplace(tabela_preco_id);

CREATE INDEX IF NOT EXISTS idx_lojas_marketplace_profile
  ON public.lojas_marketplace(owner_profile_id);

CREATE INDEX IF NOT EXISTS idx_lojas_marketplace_parceiro
  ON public.lojas_marketplace(owner_parceiro_id);

ALTER TABLE public.lojas_marketplace ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lojas_marketplace_select" ON public.lojas_marketplace;
DROP POLICY IF EXISTS "lojas_marketplace_write" ON public.lojas_marketplace;
DROP POLICY IF EXISTS "lojas_marketplace_public_read" ON public.lojas_marketplace;

CREATE POLICY "lojas_marketplace_select" ON public.lojas_marketplace
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "lojas_marketplace_write" ON public.lojas_marketplace
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND perfil = 'admin'
        AND status = 'ativo'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND perfil = 'admin'
        AND status = 'ativo'
    )
  );

CREATE POLICY "lojas_marketplace_public_read" ON public.lojas_marketplace
  FOR SELECT USING (ativo = true);

DROP POLICY IF EXISTS "certificados_public_read" ON public.certificados;
CREATE POLICY "certificados_public_read" ON public.certificados
  FOR SELECT USING (ativo = true);

DROP POLICY IF EXISTS "tabelas_preco_public_read" ON public.tabelas_preco;
CREATE POLICY "tabelas_preco_public_read" ON public.tabelas_preco
  FOR SELECT USING (ativo = true);

DROP POLICY IF EXISTS "tabelas_preco_itens_public_read" ON public.tabelas_preco_itens;
CREATE POLICY "tabelas_preco_itens_public_read" ON public.tabelas_preco_itens
  FOR SELECT USING (ativo = true);

ALTER TABLE public.vendas_certificados
  ADD COLUMN IF NOT EXISTS loja_marketplace_id UUID REFERENCES public.lojas_marketplace(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vendas_certificados'
      AND column_name = 'vendedor_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.vendas_certificados
      ALTER COLUMN vendedor_id DROP NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.vendas_certificados.loja_marketplace_id IS
  'Identifica de qual loja do marketplace proprio veio esta venda.';
