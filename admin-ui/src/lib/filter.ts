import type { CredentialStatusItem, BalanceResponse } from '@/types/api'
import { deriveStatus, type CredentialStatus } from './derive'

export interface FilterCriteria {
  status: 'all' | CredentialStatus
  subscription: string
  authMethods: string[]
}

export function applyFilters(
  list: CredentialStatusItem[],
  criteria: FilterCriteria,
  getBalance: (id: number) => BalanceResponse | null
): CredentialStatusItem[] {
  return list.filter(cred => {
    if (criteria.status !== 'all' && deriveStatus(cred) !== criteria.status) return false
    if (criteria.subscription) {
      const balance = getBalance(cred.id)
      if (!balance || balance.subscriptionTitle !== criteria.subscription) return false
    }
    if (criteria.authMethods.length > 0) {
      if (!cred.authMethod || !criteria.authMethods.includes(cred.authMethod)) return false
    }
    return true
  })
}

export function applySearch(
  list: CredentialStatusItem[],
  rawQuery: string
): CredentialStatusItem[] {
  const q = rawQuery.trim()
  if (!q) return list
  const qLower = q.toLowerCase()
  const isFourAlnum = q.length === 4 && /^[a-zA-Z0-9]+$/.test(q)
  return list.filter(cred => {
    if (cred.email && cred.email.toLowerCase().includes(qLower)) return true
    if (cred.id.toString() === q) return true
    if (isFourAlnum && cred.maskedApiKey) {
      if (cred.maskedApiKey.slice(-4).toLowerCase() === qLower) return true
    }
    return false
  })
}
