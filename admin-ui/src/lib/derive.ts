import type { CredentialStatusItem } from '@/types/api'

export type CredentialStatus = 'normal' | 'throttled' | 'error'

/**
 * 派生凭据状态。三状态互斥。
 * 异常 = disabled 或 token 刷新失败过
 * 限速 = 启用且 token 健康但调用失败过
 * 正常 = 其余
 */
export function deriveStatus(cred: CredentialStatusItem): CredentialStatus {
  if (cred.disabled || cred.refreshFailureCount >= 1) return 'error'
  if (cred.failureCount > 0) return 'throttled'
  return 'normal'
}
