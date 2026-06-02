-- Bloco 4: webhook_log + campos de cobrança em lancamentos_financeiros

-- ── webhook_log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_log (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  gateway             text        NOT NULL,
  evento              text        NOT NULL,
  payload             jsonb       NOT NULL DEFAULT '{}',
  status              text        NOT NULL DEFAULT 'recebido'
    CHECK (status IN ('recebido', 'processado', 'erro')),
  erro                text,
  external_id         text,
  ordem_pagamento_id  uuid,
  created_at          timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.webhook_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS webhook_log_gateway_idx    ON public.webhook_log(gateway);
CREATE INDEX IF NOT EXISTS webhook_log_created_at_idx ON public.webhook_log(created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_log_status_idx     ON public.webhook_log(status);

-- ── campos de cobrança em lancamentos_financeiros ──────────────
ALTER TABLE public.lancamentos_financeiros
  ADD COLUMN IF NOT EXISTS cobranca_gateway    text,
  ADD COLUMN IF NOT EXISTS cobranca_link       text,
  ADD COLUMN IF NOT EXISTS cobranca_id_externo text;
