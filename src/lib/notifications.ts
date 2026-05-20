import { queueEmailMessage, queueWhatsAppMessage } from '@/lib/communication'
import { fetchAgencyConfig } from '@/lib/agencyConfig'

interface NewUserData {
  nome:    string
  email:   string
  vinculo: string
}

export async function notifyNewUserRegistration({ nome, email, vinculo }: NewUserData) {
  const { data: agency } = await fetchAgencyConfig()

  const adminPhone = agency.telefone.replace(/\D/g, '')
  const primeiroNome = nome.split(' ')[0]
  const dataHora = new Date().toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  })

  // ── E-mail de boas-vindas ao novo usuário ──────────────────────────────────
  void queueEmailMessage({
    to:      email,
    subject: `Cadastro recebido — aguardando aprovação | ${agency.nome_agencia}`,
    body: `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

        <!-- Cabeçalho -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 100%);padding:32px 40px;text-align:center">
            ${agency.logo_login_url
              ? `<img src="${agency.logo_login_url}" alt="${agency.nome_agencia}" style="height:52px;margin-bottom:16px;display:block;margin-left:auto;margin-right:auto">`
              : ''}
            <p style="margin:0;color:#bfdbfe;font-size:13px;letter-spacing:1px;text-transform:uppercase">${agency.nome_agencia}</p>
          </td>
        </tr>

        <!-- Corpo -->
        <tr>
          <td style="padding:40px">

            <h1 style="margin:0 0 8px;color:#1e3a8a;font-size:22px;font-weight:700">
              Olá, ${primeiroNome}!
            </h1>
            <p style="margin:0 0 24px;color:#64748b;font-size:15px">
              Seu cadastro foi recebido com sucesso.
            </p>

            <!-- Status -->
            <div style="background:#fef9c3;border-left:4px solid #eab308;border-radius:6px;padding:14px 18px;margin-bottom:28px">
              <p style="margin:0;color:#854d0e;font-size:14px;font-weight:600">
                ⏳ Cadastro pendente de aprovação
              </p>
              <p style="margin:6px 0 0;color:#92400e;font-size:13px">
                Nossa equipe irá analisar e liberar o seu acesso em breve. Você receberá uma notificação assim que for aprovado.
              </p>
            </div>

            <!-- Dados confirmados -->
            <p style="margin:0 0 12px;color:#374151;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">
              Dados do seu cadastro
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:28px">
              <tr style="background:#f8fafc">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;width:40%;border-bottom:1px solid #e2e8f0">Nome completo</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0">${nome}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0">E-mail</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0">${email}</td>
              </tr>
              <tr style="background:#f8fafc">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0">Perfil solicitado</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0">${vinculo}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px">Data do cadastro</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;font-weight:600">${dataHora}</td>
              </tr>
            </table>

            <p style="margin:0 0 6px;color:#374151;font-size:14px">
              Caso você não reconheça este cadastro ou tenha alguma dúvida, entre em contato conosco imediatamente:
            </p>
            <p style="margin:0;color:#1d4ed8;font-size:14px;font-weight:600">${agency.telefone}</p>

          </td>
        </tr>

        <!-- Rodapé -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center">
            <p style="margin:0;color:#94a3b8;font-size:12px">
              ${agency.nome_agencia} · ${agency.cidade}<br>
              Este e-mail foi gerado automaticamente. Por favor, não responda.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim(),
  })

  // ── WhatsApp para o admin ──────────────────────────────────────────────────
  if (adminPhone) {
    void queueWhatsAppMessage({
      to:   adminPhone,
      body: [
        `🔔 *${agency.nome_agencia} — Novo usuário aguardando aprovação*`,
        '',
        `Um novo cadastro foi realizado na plataforma e está aguardando a sua liberação.`,
        '',
        `*Dados do usuário:*`,
        `👤 *Nome:* ${nome}`,
        `📧 *E-mail:* ${email}`,
        `🔗 *Perfil solicitado:* ${vinculo}`,
        `🕐 *Data/hora:* ${dataHora}`,
        '',
        `Acesse o painel administrativo para aprovar ou recusar o acesso.`,
      ].join('\n'),
    })
  }
}
