---
description: Varredura completa de segurança em sistemas desenvolvidos com IA, verificando vulnerabilidades contra normas internacionais (OWASP, CWE, ISO 27001, NIST) e nacionais brasileiras (LGPD, Marco Civil, ANPD). Gera relatório priorizado por severidade com referências normativas e recomendações de correção.
---

# /security-scan — Varredura de Segurança (AI-Generated Systems)

## Objetivo

Executar uma varredura sistemática e profunda do código-fonte à procura de vulnerabilidades de segurança e não-conformidades normativas. A varredura cobre sistemas gerados ou assistidos por IA, que tipicamente apresentam padrões específicos de risco (código gerado sem contexto de segurança, credenciais expostas, RLS ausente, validações superficiais).

---

## Instruções de Execução

Ao invocar `/security-scan`, execute os 5 domínios de varredura **em paralelo** usando sub-agentes. Ao final, consolide todos os achados em um **Relatório Final unificado**.

### Argumentos opcionais
- `--fix` — aplica correções automáticas nos achados de baixo risco após o relatório
- `--lgpd-only` — executa apenas o domínio 5 (conformidade LGPD)
- `--critical-only` — exibe apenas achados Críticos e Altos no relatório final

---

## Domínio 1 — Autenticação, Autorização e Controle de Acesso

**Normas:** OWASP A01:2021, OWASP A07:2021, CWE-284, CWE-287, CWE-306, ISO 27001 A.9

Varrer:
- Rotas e endpoints sem verificação de autenticação
- JWT: algoritmo `none`, ausência de validação de expiração (`exp`), segredo fraco ou hardcoded
- Supabase RLS (Row Level Security): tabelas sem política RLS ativa, políticas permissivas demais (`using (true)`)
- Escalada de privilégio: usuário comum acessando rotas de admin sem verificação de role
- Referências diretas a objetos inseguros (IDOR): IDs sequenciais sem verificação de propriedade
- Funções Edge sem validação de `Authorization` header
- Service Role Key exposta no frontend ou em código cliente
- `anon` key com permissões excessivas no banco

Verificar nos arquivos:
- `src/**/*.ts`, `src/**/*.tsx` — lógica de frontend
- `supabase/functions/**/*.ts` — Edge Functions
- `supabase/migrations/**/*.sql` — definição de RLS e políticas
- `.env*` — variáveis de ambiente

---

## Domínio 2 — Exposição de Dados e Secrets

**Normas:** OWASP A02:2021, CWE-312, CWE-798, CWE-200, ISO 27001 A.10, LGPD Art. 46

Varrer:
- Credenciais hardcoded: senhas, tokens, API keys, connection strings em código-fonte
- Chaves privadas, certificados ou segredos em arquivos versionados
- `.env` commitado no repositório (verificar `.gitignore`)
- Dados pessoais (CPF, e-mail, telefone, endereço) logados em `console.log` ou retornados sem necessidade
- Respostas de API expondo campos desnecessários (over-fetching de dados pessoais)
- Stack traces ou mensagens de erro detalhadas expostas ao cliente
- Arquivos de backup, dump de banco ou exports com dados reais presentes no repositório
- `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_ANON_KEY` referenciadas no lado cliente

Verificar nos arquivos:
- `**/*.env*`, `**/*.json`, `**/*.ts`, `**/*.sql`
- `.gitignore` — confirmar que `.env` está listado

---

## Domínio 3 — Injeção, XSS e Validação de Input

**Normas:** OWASP A03:2021, CWE-89, CWE-79, CWE-78, CWE-77, NIST CSF PR.DS-1

Varrer:
- SQL Injection: queries concatenando strings com input do usuário sem prepared statements
- Supabase: uso de `.rpc()` ou `.from().select()` com interpolação de strings de input
- XSS (Cross-Site Scripting): `dangerouslySetInnerHTML` sem sanitização, `innerHTML` com dados externos
- Command Injection: `exec()`, `spawn()`, `eval()` com input não sanitizado
- Path Traversal: leitura de arquivos com caminhos controlados pelo usuário
- Ausência de validação de schema em formulários e requisições de API
- Campos de upload de arquivo sem validação de tipo MIME e tamanho
- Template injection em strings construídas com dados do usuário

Verificar nos arquivos:
- `src/**/*.ts`, `src/**/*.tsx`
- `supabase/functions/**/*.ts`
- Formulários: buscar por `<form`, `onChange`, `onSubmit`

---

## Domínio 4 — Configuração, Infraestrutura e Dependências

**Normas:** OWASP A05:2021, OWASP A06:2021, CWE-16, ISO 27001 A.12, NIST CSF PR.IP-1

Varrer:
- CORS: origens permissivas demais (`*`) em Edge Functions ou configurações de servidor
- Headers HTTP de segurança ausentes: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`
- Rate limiting ausente em endpoints sensíveis (login, reset de senha, OTP)
- Dependências com vulnerabilidades conhecidas: verificar `package.json` contra CVEs conhecidos
- Versões de dependências desatualizadas ou fixadas em versões antigas
- Configurações de desenvolvimento expostas em produção (`debug: true`, logs verbosos)
- Supabase Edge Functions sem timeout configurado
- Ausência de validação de Content-Type nas requisições
- Cookies sem flags `Secure`, `HttpOnly` e `SameSite`
- WebSockets sem autenticação no handshake

Verificar nos arquivos:
- `package.json`, `package-lock.json`
- `supabase/functions/**/*.ts`
- `index.html`, `vite.config.ts`, arquivos de configuração

---

## Domínio 5 — Conformidade LGPD, Marco Civil e ANPD

**Normas:** LGPD Lei 13.709/2018, Marco Civil Lei 12.965/2014, Diretrizes ANPD 2021-2024, ISO 27701

Varrer:
- **Coleta de dados pessoais** (Art. 7 LGPD): dados coletados sem base legal explícita ou sem consentimento registrado
- **Dados pessoais sensíveis** (Art. 11 LGPD): saúde, biometria, origem racial, religião, orientação sexual — tratados sem salvaguarda específica
- **Direitos do titular** (Art. 18 LGPD): ausência de mecanismo para acesso, correção, exclusão e portabilidade de dados
- **Retenção de dados** (Art. 15-16 LGPD): dados armazenados indefinidamente sem política de retenção
- **Logs de acesso** (Marco Civil Art. 13-15): registros de autenticação e operações sobre dados pessoais
- **Transferência internacional** (Art. 33 LGPD): dados pessoais enviados a serviços externos (APIs, analytics) sem adequação
- **DPO/Encarregado** (Art. 41 LGPD): canal de contato para titular ausente no sistema
- **Privacy by Design** (Art. 46 §2 LGPD): minimização de dados, pseudonimização ausente onde aplicável
- **Incidente de segurança** (Art. 48 LGPD): ausência de mecanismo de notificação de breach

Verificar nos arquivos:
- Schemas de banco (`supabase/migrations/**/*.sql`) — campos com dados pessoais
- Formulários de cadastro (`src/**/*.tsx`) — quais dados são coletados
- Integrações externas — APIs de terceiros recebendo dados de usuários
- `src/**` — presença de termos de uso e política de privacidade linkadas

---

## Relatório Final Consolidado

Após varrer os 5 domínios, gere o relatório no seguinte formato:

```
═══════════════════════════════════════════════════════════════
  RELATÓRIO DE SEGURANÇA — [Nome do Sistema] — [Data]
  Padrão: OWASP Top 10 · ISO 27001 · LGPD · Marco Civil
═══════════════════════════════════════════════════════════════

## RESUMO EXECUTIVO
- Total de achados: XX
- Críticos: X | Altos: X | Médios: X | Baixos: X | Informativos: X
- Score de risco geral: [CRÍTICO / ALTO / MÉDIO / BAIXO]
- Principais áreas de risco: [lista]

---

## ACHADOS — [CRÍTICO]

### [ID-001] Título do Achado
- Severidade: CRÍTICO
- Norma: OWASP A01:2021 · CWE-284 · LGPD Art. 46
- Localização: `src/components/auth/Login.tsx:42`
- Descrição: Explicação objetiva da vulnerabilidade encontrada.
- Evidência: trecho de código ou configuração problemática
- Risco: impacto potencial se explorada
- Recomendação: como corrigir com exemplo de código seguro quando aplicável

---

## ACHADOS — [ALTO]
[mesma estrutura]

## ACHADOS — [MÉDIO]
[mesma estrutura]

## ACHADOS — [BAIXO]
[mesma estrutura]

## ACHADOS — [INFORMATIVO]
[itens sem risco imediato, mas que merecem atenção futura]

---

## CONFORMIDADE NORMATIVA

| Norma              | Status       | Achados Relacionados     |
|--------------------|--------------|--------------------------|
| OWASP Top 10       | ⚠ Parcial   | ID-001, ID-003, ID-007   |
| OWASP API Sec.     | ✅ OK        | —                        |
| CWE Top 25         | ❌ Falhou    | ID-002, ID-005           |
| ISO 27001          | ⚠ Parcial   | ID-004                   |
| NIST CSF           | ⚠ Parcial   | ID-006                   |
| LGPD               | ❌ Falhou    | ID-008, ID-009, ID-010   |
| Marco Civil        | ✅ OK        | —                        |
| ANPD Diretrizes    | ⚠ Parcial   | ID-008                   |

---

## PLANO DE REMEDIAÇÃO PRIORIZADO

1. [Críticos] — Corrigir imediatamente antes do próximo deploy
2. [Altos] — Resolver no próximo sprint (máx. 7 dias)
3. [Médios] — Planejar para as próximas 2 semanas
4. [Baixos] — Backlog de segurança — resolver no próximo trimestre
5. [Informativos] — Revisar na próxima auditoria anual

═══════════════════════════════════════════════════════════════
```

---

## Referências Normativas

### Internacionais
- **OWASP Top 10 (2021):** A01 Broken Access Control · A02 Cryptographic Failures · A03 Injection · A04 Insecure Design · A05 Security Misconfiguration · A06 Vulnerable Components · A07 Auth Failures · A08 Software Integrity · A09 Logging Failures · A10 SSRF
- **OWASP API Security Top 10 (2023):** API1 BOLA · API2 Auth · API3 Object Property · API4 Resource Consumption · API5 BFLA · API6 Unrestricted Access · API7 SSRF · API8 Misconfig · API9 Inventory · API10 Unsafe Consumption
- **CWE Top 25 (2024):** CWE-79 XSS · CWE-89 SQLi · CWE-20 Input Validation · CWE-287 Auth · CWE-200 Exposure · CWE-312 Cleartext Storage · CWE-798 Hardcoded Creds
- **ISO/IEC 27001:2022:** A.8 Controles tecnológicos · A.9 Controles físicos · A.5 Controles organizacionais
- **NIST CSF 2.0:** Identify · Protect · Detect · Respond · Recover

### Nacionais (Brasil)
- **LGPD — Lei 13.709/2018:** Art. 7 (bases legais) · Art. 11 (dados sensíveis) · Art. 15-16 (término do tratamento) · Art. 18 (direitos do titular) · Art. 33 (transferência internacional) · Art. 41 (DPO) · Art. 46 (segurança) · Art. 48 (incidentes)
- **Marco Civil da Internet — Lei 12.965/2014:** Art. 13 (logs de conexão) · Art. 15 (logs de aplicação) · Art. 7 (privacidade)
- **ANPD — Diretrizes e Resoluções:** Resolução CD/ANPD nº 2/2022 (agentes de pequeno porte) · Guia de Boas Práticas em Proteção de Dados
