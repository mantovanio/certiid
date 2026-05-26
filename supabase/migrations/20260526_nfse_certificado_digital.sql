-- Certificado digital A1 para emissão de NFS-e
ALTER TABLE public.nfse_configuracoes
  ADD COLUMN IF NOT EXISTS certificado_pfx_path TEXT,
  ADD COLUMN IF NOT EXISTS certificado_senha     TEXT;

-- Bucket privado para armazenar os arquivos .pfx
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'certificados-digitais',
  'certificados-digitais',
  false,
  5242880,
  ARRAY['application/x-pkcs12', 'application/octet-stream', 'application/pkcs12']
)
ON CONFLICT (id) DO NOTHING;

-- Somente usuários autenticados acessam o bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Autenticados gerenciam certificados'
  ) THEN
    CREATE POLICY "Autenticados gerenciam certificados"
    ON storage.objects FOR ALL TO authenticated
    USING  (bucket_id = 'certificados-digitais')
    WITH CHECK (bucket_id = 'certificados-digitais');
  END IF;
END $$;
