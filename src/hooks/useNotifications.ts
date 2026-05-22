import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Page } from '@/components/Sidebar'

export interface SystemNotification {
  id:        string
  type:      'novo_usuario' | 'mensagem_pendente' | 'renovacao_vencendo'
  title:     string
  body:      string
  page:      Page
  createdAt: string
}

export function useNotifications(isAdmin: boolean) {
  const [notifications, setNotifications] = useState<SystemNotification[]>([])

  const fetchAll = useCallback(async () => {
    const items: SystemNotification[] = []

    // 1. Usuários aguardando aprovação (só admin vê)
    if (isAdmin) {
      const { data: pendentes } = await supabase
        .from('profiles')
        .select('id, nome, email, created_at')
        .eq('status', 'inativo')
        .order('created_at', { ascending: false })

      for (const u of pendentes ?? []) {
        items.push({
          id:        `usuario_${u.id}`,
          type:      'novo_usuario',
          title:     '👤 Novo cadastro aguardando aprovação',
          body:      u.nome ?? u.email ?? 'Usuário sem nome',
          page:      'configuracoes',
          createdAt: u.created_at,
        })
      }
    }

    // 2. Leads que iniciaram conversa e aguardam resposta
    const { data: leads } = await supabase
      .from('leads_contabilidade')
      .select('id, nome_lead, ultima_mensagem, created_at')
      .eq('status', 'iniciou_conversa')
      .not('id_conversa_chatwoot', 'is', null)
      .order('ultima_mensagem', { ascending: false })
      .limit(20)

    for (const l of leads ?? []) {
      items.push({
        id:        `lead_${l.id}`,
        type:      'mensagem_pendente',
        title:     '💬 Mensagem aguardando resposta',
        body:      l.nome_lead ?? 'Lead sem nome',
        page:      'chat',
        createdAt: l.ultima_mensagem ?? l.created_at,
      })
    }

    // 3. Renovações vencendo em 30 dias
    const hoje = new Date()
    const em30  = new Date(hoje); em30.setDate(hoje.getDate() + 30)
    const { data: renovacoes } = await supabase
      .from('renovacoes')
      .select('id, nome_titular, data_vencimento')
      .eq('status', 'pendente')
      .lte('data_vencimento', em30.toISOString().slice(0, 10))
      .gte('data_vencimento', hoje.toISOString().slice(0, 10))
      .order('data_vencimento', { ascending: true })
      .limit(5)

    if ((renovacoes ?? []).length > 0) {
      items.push({
        id:        'renovacoes_vencendo',
        type:      'renovacao_vencendo',
        title:     '🔄 Renovações vencendo em breve',
        body:      `${renovacoes!.length} certificado${renovacoes!.length !== 1 ? 's' : ''} vencem nos próximos 30 dias`,
        page:      'renovacoes',
        createdAt: new Date().toISOString(),
      })
    }

    // Ordena: mais recente primeiro
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    setNotifications(items)
  }, [isAdmin])

  useEffect(() => {
    void fetchAll()

    // Atualiza a cada 60 segundos
    const interval = setInterval(() => void fetchAll(), 60_000)

    // Realtime: novos usuários e mensagens
    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads_contabilidade' }, () => void fetchAll())
      .subscribe()

    return () => {
      clearInterval(interval)
      void supabase.removeChannel(channel)
    }
  }, [fetchAll])

  return { notifications, refetch: fetchAll }
}
