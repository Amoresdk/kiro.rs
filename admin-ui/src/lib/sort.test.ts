import { describe, it, expect } from 'vitest'
import { applySort } from './sort'
import type { CredentialStatusItem, BalanceResponse } from '@/types/api'

function c(overrides: Partial<CredentialStatusItem>): CredentialStatusItem {
  return {
    id: 1, priority: 0, disabled: false, failureCount: 0, refreshFailureCount: 0,
    successCount: 0, isCurrent: false, expiresAt: null, authMethod: 'social',
    hasProfileArn: false, lastUsedAt: null, hasProxy: false, endpoint: 'us-east-1',
    ...overrides,
  }
}
function b(currentUsage: number, usageLimit: number): BalanceResponse {
  return {
    id: 0, subscriptionTitle: 'KIRO PRO',
    currentUsage, usageLimit,
    remaining: usageLimit - currentUsage,
    usagePercentage: usageLimit > 0 ? currentUsage / usageLimit : 0,
    nextResetAt: null,
  }
}

describe('applySort', () => {
  it('未指定排序键返回原顺序', () => {
    const list = [c({ id: 3 }), c({ id: 1 }), c({ id: 2 })]
    expect(applySort(list, null, 'asc', () => null).map(c => c.id)).toEqual([3, 1, 2])
  })
  it('priority 降序', () => {
    const list = [c({ id: 1, priority: 5 }), c({ id: 2, priority: 1 }), c({ id: 3, priority: 3 })]
    expect(applySort(list, 'priority', 'desc', () => null).map(c => c.id)).toEqual([1, 3, 2])
  })
  it('priority 升序', () => {
    const list = [c({ id: 1, priority: 5 }), c({ id: 2, priority: 1 }), c({ id: 3, priority: 3 })]
    expect(applySort(list, 'priority', 'asc', () => null).map(c => c.id)).toEqual([2, 3, 1])
  })
  it('failure 按 failureCount 降序', () => {
    const list = [c({ id: 1, failureCount: 0 }), c({ id: 2, failureCount: 5 }), c({ id: 3, failureCount: 2 })]
    expect(applySort(list, 'failure', 'desc', () => null).map(c => c.id)).toEqual([2, 3, 1])
  })
  it('lastUsed 降序，null 排末（升降均如此）', () => {
    const list = [
      c({ id: 1, lastUsedAt: '2026-05-15T10:00:00Z' }),
      c({ id: 2, lastUsedAt: null }),
      c({ id: 3, lastUsedAt: '2026-05-15T12:00:00Z' }),
    ]
    expect(applySort(list, 'lastUsed', 'desc', () => null).map(c => c.id)).toEqual([3, 1, 2])
    expect(applySort(list, 'lastUsed', 'asc', () => null).map(c => c.id)).toEqual([1, 3, 2])
  })
  it('usage 按百分比，未查询排末', () => {
    const list = [c({ id: 1 }), c({ id: 2 }), c({ id: 3 })]
    const map: Record<number, BalanceResponse | null> = {
      1: b(500, 1000), 2: null, 3: b(900, 1000),
    }
    expect(applySort(list, 'usage', 'desc', id => map[id]).map(c => c.id)).toEqual([3, 1, 2])
    expect(applySort(list, 'usage', 'asc', id => map[id]).map(c => c.id)).toEqual([1, 3, 2])
  })
  it('同值按 id 稳定排序', () => {
    const list = [c({ id: 5 }), c({ id: 2 }), c({ id: 8 })]
    const map: Record<number, BalanceResponse | null> = { 5: b(500, 1000), 2: b(500, 1000), 8: b(500, 1000) }
    expect(applySort(list, 'usage', 'desc', id => map[id]).map(c => c.id)).toEqual([2, 5, 8])
  })
})
