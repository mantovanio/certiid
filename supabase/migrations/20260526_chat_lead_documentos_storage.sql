ALTER TABLE public.chat_lead_documentos
  ADD COLUMN IF NOT EXISTS storage_provider TEXT NULL,
  ADD COLUMN IF NOT EXISTS bucket TEXT NULL,
  ADD COLUMN IF NOT EXISTS storage_path TEXT NULL,
  ADD COLUMN IF NOT EXISTS external_url TEXT NULL;

ALTER TABLE public.chat_lead_documentos
  ALTER COLUMN data_url DROP NOT NULL;

ALTER TABLE public.chat_lead_documentos ENABLE ROW LEVEL SECURITY;

UPDATE public.chat_lead_documentos
SET bucket = 'chat-lead-documentos'
WHERE bucket IS NULL AND storage_path IS NOT NULL;

UPDATE public.chat_lead_documentos
SET storage_provider = CASE
  WHEN external_url IS NOT NULL THEN 'server'
  WHEN bucket IS NOT NULL OR storage_path IS NOT NULL THEN 'supabase'
  ELSE 'supabase'
END
WHERE storage_provider IS NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT
  'chat-lead-documentos',
  'chat-lead-documentos',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]::text[]
WHERE NOT EXISTS (
  SELECT 1
  FROM storage.buckets
  WHERE id = 'chat-lead-documentos'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_lead_documentos'
      AND policyname = 'chat_lead_documentos_select_auth'
  ) THEN
    CREATE POLICY chat_lead_documentos_select_auth
      ON public.chat_lead_documentos
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_lead_documentos'
      AND policyname = 'chat_lead_documentos_insert_auth'
  ) THEN
    CREATE POLICY chat_lead_documentos_insert_auth
      ON public.chat_lead_documentos
      FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_lead_documentos'
      AND policyname = 'chat_lead_documentos_delete_auth'
  ) THEN
    CREATE POLICY chat_lead_documentos_delete_auth
      ON public.chat_lead_documentos
      FOR DELETE
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'chat_lead_documentos_select_auth'
  ) THEN
    CREATE POLICY chat_lead_documentos_select_auth
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (bucket_id = 'chat-lead-documentos');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'chat_lead_documentos_insert_auth'
  ) THEN
    CREATE POLICY chat_lead_documentos_insert_auth
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'chat-lead-documentos');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'chat_lead_documentos_delete_auth'
  ) THEN
    CREATE POLICY chat_lead_documentos_delete_auth
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (bucket_id = 'chat-lead-documentos');
  END IF;
END $$;
