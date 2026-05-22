import { supabase } from '@/lib/supabase'
import type { PerfilAcesso, PermissaoPagina, TipoVinculoUsuario } from '@/types'

type CreateUserPayload = {
  nome: string
  email: string
  senha: string
  perfil: PerfilAcesso
  permissoes: PermissaoPagina[]
}

type CreateUserRequestPayload = CreateUserPayload & {
  tipo_vinculo: TipoVinculoUsuario
}

type UpdatePasswordPayload = {
  userId: string
  password: string
}

type DeleteUserPayload = {
  userId: string
}

type AdminUsersAction =
  | { action: 'create_user'; payload: CreateUserRequestPayload }
  | { action: 'update_password'; payload: UpdatePasswordPayload }
  | { action: 'delete_user'; payload: DeleteUserPayload }

const DEFAULT_VINCULO_BY_PERFIL: Record<PerfilAcesso, TipoVinculoUsuario> = {
  admin: 'usuario_comum',
  agente_registro: 'agente_registro',
  vendedor: 'vendedor',
  usuario: 'usuario_comum',
}

async function invokeAdminUsers(body: AdminUsersAction) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) throw new Error(error.message)
  return data as { ok: boolean; userId?: string; error?: string }
}

export async function createAdminManagedUser(payload: CreateUserPayload) {
  const response = await invokeAdminUsers({
    action: 'create_user',
    payload: {
      ...payload,
      tipo_vinculo: DEFAULT_VINCULO_BY_PERFIL[payload.perfil],
    },
  })
  if (!response.ok) throw new Error(response.error ?? 'Falha ao criar usuário')
  return response
}

export async function updateAdminManagedPassword(payload: UpdatePasswordPayload) {
  const response = await invokeAdminUsers({ action: 'update_password', payload })
  if (!response.ok) throw new Error(response.error ?? 'Falha ao atualizar senha')
  return response
}

export async function deleteAdminManagedUser(payload: DeleteUserPayload) {
  const response = await invokeAdminUsers({ action: 'delete_user', payload })
  if (!response.ok) throw new Error(response.error ?? 'Falha ao excluir usuário')
  return response
}
