-- Ajustes para permitir venda pública do marketplace próprio

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
  'Identifica de qual loja do marketplace próprio veio esta venda.';
