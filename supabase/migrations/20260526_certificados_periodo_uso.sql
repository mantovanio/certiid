-- Período de uso para produtos Fast/Online (ex: 4 meses, 1 ano, 2 anos)
ALTER TABLE public.certificados
  ADD COLUMN IF NOT EXISTS periodo_uso TEXT;
