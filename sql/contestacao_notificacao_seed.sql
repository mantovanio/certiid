-- Publica o documento de contestação com o PDF já colocado em /contestacao/notificacao-contestacao.pdf
-- Ajuste apenas os e-mails, nomes, cargos e links individuais de assinatura.

WITH novo_documento AS (
  INSERT INTO public.contestacao_documentos (
    slug,
    public_token,
    titulo,
    descricao,
    pdf_url,
    status,
    provedor_assinatura,
    assinatura_base_url,
    metadata
  )
  VALUES (
    'notificacao-alteracao-fluxo-agendamento-videoconferencias-equilibrio-operacional',
    'contestacao-fluxo-videoconferencia-20260529',
    'Notificação sobre Alteração de Fluxo de Agendamento de Videoconferências e Solicitação de Equilíbrio Operacional',
    'Documento público para leitura online e coleta de assinaturas digitais dos participantes da contestação.',
    '/contestacao/notificacao-contestacao.pdf',
    'assinando',
    'ICP-Brasil',
    NULL,
    jsonb_build_object(
      'categoria', 'contestacao',
      'origem', 'vercel',
      'arquivo_publicado', '/contestacao/notificacao-contestacao.pdf'
    )
  )
  ON CONFLICT (slug) DO UPDATE
  SET
    titulo = EXCLUDED.titulo,
    descricao = EXCLUDED.descricao,
    pdf_url = EXCLUDED.pdf_url,
    status = EXCLUDED.status,
    provedor_assinatura = EXCLUDED.provedor_assinatura,
    metadata = EXCLUDED.metadata
  RETURNING id
)
INSERT INTO public.contestacao_signatarios (
  documento_id,
  nome,
  email,
  cargo,
  status,
  ordem,
  assinatura_url,
  observacoes
)
SELECT
  d.id,
  s.nome,
  s.email,
  s.cargo,
  s.status,
  s.ordem,
  s.assinatura_url,
  s.observacoes
FROM novo_documento d
CROSS JOIN (
  VALUES
    ('Participante 1', 'participante1@empresa.com.br', 'Representante', 'enviado', 1, NULL, 'Troque pelo link individual do assinador'),
    ('Participante 2', 'participante2@empresa.com.br', 'Diretoria', 'pendente', 2, NULL, 'Troque pelo link individual do assinador')
) AS s(nome, email, cargo, status, ordem, assinatura_url, observacoes)
ON CONFLICT (documento_id, email) DO UPDATE
SET
  nome = EXCLUDED.nome,
  cargo = EXCLUDED.cargo,
  status = EXCLUDED.status,
  ordem = EXCLUDED.ordem,
  assinatura_url = EXCLUDED.assinatura_url,
  observacoes = EXCLUDED.observacoes;
