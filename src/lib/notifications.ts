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

  // E-mail de boas-vindas ao novo usuário
  void queueEmailMessage({
    to:      email,
    subject: `Bem-vindo(a) à ${agency.nome_agencia}!`,
    body: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        ${agency.logo_login_url ? `<img src="${agency.logo_login_url}" alt="${agency.nome_agencia}" style="height:48px;margin-bottom:24px">` : ''}
        <h2 style="color:#1e3a8a">Olá, ${nome}! 👋</h2>
        <p>Seu cadastro na plataforma <strong>${agency.nome_agencia}</strong> foi recebido com sucesso.</p>
        <p>Nosso time está analisando seu vínculo (<em>${vinculo}</em>) e você receberá a confirmação em breve.</p>
        <p style="color:#6b7280;font-size:13px">Em caso de dúvidas, entre em contato: ${agency.telefone}</p>
      </div>
    `.trim(),
  })

  // WhatsApp para o admin — só envia se tiver número configurado
  if (adminPhone) {
    void queueWhatsAppMessage({
      to:   adminPhone,
      body: `🆕 *Novo cadastro recebido*\n👤 Nome: ${nome}\n📧 E-mail: ${email}\n🔗 Vínculo: ${vinculo}\n\nAcesse o painel para aprovar o acesso.`,
    })
  }
}
