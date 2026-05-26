-- ================================================================
-- FIX DA AGENDA ONLINE V2
-- Execute este arquivo no Supabase SQL Editor para liberar:
-- 1. agentes_tabelas_preco
-- 2. agentes_disponibilidade
-- 3. agentes_indisponibilidades
-- 4. parceiros_agentes_permitidos
-- 5. ajustes de RLS para agendamentos_validacao
-- ================================================================

CREATE TABLE IF NOT EXISTS public.agentes_tabelas_preco (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tabela_preco_id      UUID        NOT NULL REFERENCES public.tabelas_preco(id) ON DELETE CASCADE,
  agente_registro_id   UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ponto_atendimento_id UUID        REFERENCES public.pontos_atendimento(id) ON DELETE SET NULL,
  ativo                BOOLEAN     NOT NULL DEFAULT TRUE,
  metadata             JSONB       NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tabela_preco_id, agente_registro_id, ponto_atendimento_id)
);

DROP TRIGGER IF EXISTS agentes_tabelas_preco_set_updated_at ON public.agentes_tabelas_preco;
CREATE TRIGGER agentes_tabelas_preco_set_updated_at
  BEFORE UPDATE ON public.agentes_tabelas_preco
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.agentes_disponibilidade (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_registro_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ponto_atendimento_id   UUID        NOT NULL REFERENCES public.pontos_atendimento(id) ON DELETE CASCADE,
  dia_semana             SMALLINT    NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio            TIME        NOT NULL,
  hora_fim               TIME        NOT NULL,
  intervalo_minutos      INTEGER     NOT NULL DEFAULT 30 CHECK (intervalo_minutos > 0),
  capacidade_por_slot    INTEGER     NOT NULL DEFAULT 1 CHECK (capacidade_por_slot > 0),
  tipo_atendimento       TEXT        CHECK (tipo_atendimento IN ('presencial', 'videoconferencia', 'auto_atendimento')),
  ativo                  BOOLEAN     NOT NULL DEFAULT TRUE,
  metadata               JSONB       NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (hora_fim > hora_inicio)
);

DROP TRIGGER IF EXISTS agentes_disponibilidade_set_updated_at ON public.agentes_disponibilidade;
CREATE TRIGGER agentes_disponibilidade_set_updated_at
  BEFORE UPDATE ON public.agentes_disponibilidade
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.agentes_indisponibilidades (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_registro_id   UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ponto_atendimento_id UUID        REFERENCES public.pontos_atendimento(id) ON DELETE SET NULL,
  inicio_em            TIMESTAMPTZ NOT NULL,
  fim_em               TIMESTAMPTZ NOT NULL,
  motivo               TEXT,
  ativo                BOOLEAN     NOT NULL DEFAULT TRUE,
  metadata             JSONB       NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (fim_em > inicio_em)
);

DROP TRIGGER IF EXISTS agentes_indisponibilidades_set_updated_at ON public.agentes_indisponibilidades;
CREATE TRIGGER agentes_indisponibilidades_set_updated_at
  BEFORE UPDATE ON public.agentes_indisponibilidades
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.parceiros_agentes_permitidos (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parceiro_id          UUID        NOT NULL REFERENCES public.parceiros(id) ON DELETE CASCADE,
  agente_registro_id   UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ponto_atendimento_id UUID        REFERENCES public.pontos_atendimento(id) ON DELETE SET NULL,
  ativo                BOOLEAN     NOT NULL DEFAULT TRUE,
  metadata             JSONB       NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (parceiro_id, agente_registro_id, ponto_atendimento_id)
);

DROP TRIGGER IF EXISTS parceiros_agentes_permitidos_set_updated_at ON public.parceiros_agentes_permitidos;
CREATE TRIGGER parceiros_agentes_permitidos_set_updated_at
  BEFORE UPDATE ON public.parceiros_agentes_permitidos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_agentes_tabelas_preco_tabela
  ON public.agentes_tabelas_preco(tabela_preco_id);

CREATE INDEX IF NOT EXISTS idx_agentes_tabelas_preco_agente
  ON public.agentes_tabelas_preco(agente_registro_id);

CREATE INDEX IF NOT EXISTS idx_agentes_disponibilidade_agente
  ON public.agentes_disponibilidade(agente_registro_id);

CREATE INDEX IF NOT EXISTS idx_agentes_disponibilidade_ponto
  ON public.agentes_disponibilidade(ponto_atendimento_id);

CREATE INDEX IF NOT EXISTS idx_agentes_disponibilidade_dia_semana
  ON public.agentes_disponibilidade(dia_semana);

CREATE INDEX IF NOT EXISTS idx_agentes_indisponibilidades_agente
  ON public.agentes_indisponibilidades(agente_registro_id);

CREATE INDEX IF NOT EXISTS idx_agentes_indisponibilidades_periodo
  ON public.agentes_indisponibilidades(inicio_em, fim_em);

CREATE INDEX IF NOT EXISTS idx_parceiros_agentes_permitidos_parceiro
  ON public.parceiros_agentes_permitidos(parceiro_id);

CREATE INDEX IF NOT EXISTS idx_parceiros_agentes_permitidos_agente
  ON public.parceiros_agentes_permitidos(agente_registro_id);

ALTER TABLE public.agentes_tabelas_preco ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agentes_disponibilidade ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agentes_indisponibilidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiros_agentes_permitidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agentes_tabelas_preco_select" ON public.agentes_tabelas_preco;
DROP POLICY IF EXISTS "agentes_tabelas_preco_write" ON public.agentes_tabelas_preco;
CREATE POLICY "agentes_tabelas_preco_select" ON public.agentes_tabelas_preco
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "agentes_tabelas_preco_write" ON public.agentes_tabelas_preco
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND perfil = 'admin'
        AND status = 'ativo'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND perfil = 'admin'
        AND status = 'ativo'
    )
  );

DROP POLICY IF EXISTS "agentes_disponibilidade_select" ON public.agentes_disponibilidade;
DROP POLICY IF EXISTS "agentes_disponibilidade_write" ON public.agentes_disponibilidade;
CREATE POLICY "agentes_disponibilidade_select" ON public.agentes_disponibilidade
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND status = 'ativo'
        AND (perfil = 'admin' OR auth.uid() = agente_registro_id)
    )
  );
CREATE POLICY "agentes_disponibilidade_write" ON public.agentes_disponibilidade
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND status = 'ativo'
        AND (perfil = 'admin' OR auth.uid() = agente_registro_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND status = 'ativo'
        AND (perfil = 'admin' OR auth.uid() = agente_registro_id)
    )
  );

DROP POLICY IF EXISTS "agentes_indisponibilidades_select" ON public.agentes_indisponibilidades;
DROP POLICY IF EXISTS "agentes_indisponibilidades_write" ON public.agentes_indisponibilidades;
CREATE POLICY "agentes_indisponibilidades_select" ON public.agentes_indisponibilidades
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND status = 'ativo'
        AND (perfil = 'admin' OR auth.uid() = agente_registro_id)
    )
  );
CREATE POLICY "agentes_indisponibilidades_write" ON public.agentes_indisponibilidades
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND status = 'ativo'
        AND (perfil = 'admin' OR auth.uid() = agente_registro_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND status = 'ativo'
        AND (perfil = 'admin' OR auth.uid() = agente_registro_id)
    )
  );

DROP POLICY IF EXISTS "parceiros_agentes_permitidos_select" ON public.parceiros_agentes_permitidos;
DROP POLICY IF EXISTS "parceiros_agentes_permitidos_write" ON public.parceiros_agentes_permitidos;
CREATE POLICY "parceiros_agentes_permitidos_select" ON public.parceiros_agentes_permitidos
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "parceiros_agentes_permitidos_write" ON public.parceiros_agentes_permitidos
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND perfil = 'admin'
        AND status = 'ativo'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND perfil = 'admin'
        AND status = 'ativo'
    )
  );

ALTER TABLE public.agendamentos_validacao
  ALTER COLUMN titular_id DROP NOT NULL,
  ALTER COLUMN agente_registro_id DROP NOT NULL,
  ALTER COLUMN ponto_atendimento_id DROP NOT NULL;
