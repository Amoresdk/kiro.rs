import type { CredentialStatusItem, BalanceResponse } from '@/types/api'

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

export type UsageSegment = 'unknown' | 'normal' | 'warning' | 'full' | 'overflow'

/**
 * 派生用量段，用于进度条配色。
 * unknown 涵盖：未查询、limit 为 0/负数（防除零）。
 */
export function deriveUsageSegment(balance: BalanceResponse | null): UsageSegment {
  if (balance == null) return 'unknown'
  if (balance.usageLimit <= 0) return 'unknown'
  const pct = balance.currentUsage / balance.usageLimit
  if (pct < 0.8) return 'normal'
  if (pct < 1.0) return 'warning'
  if (pct === 1.0) return 'full'
  return 'overflow'
}
