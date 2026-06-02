-- Leitura pública controlada para as vitrines do marketplace próprio.

DROP POLICY IF EXISTS "certificados_public_read" ON public.certificados;
CREATE POLICY "certificados_public_read" ON public.certificados
  FOR SELECT USING (ativo = true);

DROP POLICY IF EXISTS "tabelas_preco_public_read" ON public.tabelas_preco;
CREATE POLICY "tabelas_preco_public_read" ON public.tabelas_preco
  FOR SELECT USING (ativo = true);

DROP POLICY IF EXISTS "tabelas_preco_itens_public_read" ON public.tabelas_preco_itens;
CREATE POLICY "tabelas_preco_itens_public_read" ON public.tabelas_preco_itens
  FOR SELECT USING (ativo = true);

DROP POLICY IF EXISTS "lojas_marketplace_public_read" ON public.lojas_marketplace;
CREATE POLICY "lojas_marketplace_public_read" ON public.lojas_marketplace
  FOR SELECT USING (ativo = true);
