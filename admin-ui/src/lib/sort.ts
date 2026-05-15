import type { CredentialStatusItem, BalanceResponse } from '@/types/api'

export type SortKey = 'usage' | 'priority' | 'failure' | 'lastUsed'
export type SortDir = 'asc' | 'desc'

function getSortValue(
  cred: CredentialStatusItem,
  key: SortKey,
  getBalance: (id: number) => BalanceResponse | null
): number | null {
  switch (key) {
    case 'priority': return cred.priority
    case 'failure': return cred.failureCount
    case 'lastUsed': return cred.lastUsedAt ? new Date(cred.lastUsedAt).getTime() : null
    case 'usage': {
      const bal = getBalance(cred.id)
      if (!bal || bal.usageLimit <= 0) return null
      return bal.currentUsage / bal.usageLimit
    }
  }
}

export function applySort(
  list: CredentialStatusItem[],
  key: SortKey | null,
  dir: SortDir,
  getBalance: (id: number) => BalanceResponse | null
): CredentialStatusItem[] {
  if (!key) return list
  const decorated = list.map(cred => ({ cred, value: getSortValue(cred, key, getBalance) }))
  decorated.sort((a, b) => {
    if (a.value === null && b.value === null) return a.cred.id - b.cred.id
    if (a.value === null) return 1
    if (b.value === null) return -1
    if (a.value !== b.value) return dir === 'asc' ? a.value - b.value : b.value - a.value
    return a.cred.id - b.cred.id
  })
  return decorated.map(d => d.cred)
}
