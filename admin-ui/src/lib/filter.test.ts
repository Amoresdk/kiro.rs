import { describe, it, expect } from 'vitest'
import { applyFilters, applySearch, type FilterCriteria } from './filter'
import type { CredentialStatusItem } from '@/types/api'

function c(overrides: Partial<CredentialStatusItem>): CredentialStatusItem {
  return {
    id: 1, priority: 0, disabled: false, failureCount: 0, refreshFailureCount: 0,
    successCount: 0, isCurrent: false, expiresAt: null, authMethod: 'social',
    hasProfileArn: false, lastUsedAt: null, hasProxy: false, endpoint: 'us-east-1',
    ...overrides,
  }
}

describe('applyFilters', () => {
  const list: CredentialStatusItem[] = [
    c({ id: 1, email: 'a@x.com', authMethod: 'social' }),
    c({ id: 2, email: 'b@x.com', authMethod: 'idc', failureCount: 3 }),
    c({ id: 3, email: 'c@x.com', authMethod: 'api_key', disabled: true }),
    c({ id: 4, email: 'd@y.com', authMethod: 'social', refreshFailureCount: 2 }),
  ]

  it('全部条件为空时返回全量', () => {
    const f: FilterCriteria = { status: 'all', subscription: '', authMethods: [] }
    expect(applyFilters(list, f, () => null)).toHaveLength(4)
  })

  it('status=normal 只留正常', () => {
    const f: FilterCriteria = { status: 'normal', subscription: '', authMethods: [] }
    expect(applyFilters(list, f, () => null).map(c => c.id)).toEqual([1])
  })

  it('status=throttled 只留限速', () => {
    const f: FilterCriteria = { status: 'throttled', subscription: '', authMethods: [] }
    expect(applyFilters(list, f, () => null).map(c => c.id)).toEqual([2])
  })

  it('status=error 留禁用 + 刷新失败', () => {
    const f: FilterCriteria = { status: 'error', subscription: '', authMethods: [] }
    expect(applyFilters(list, f, () => null).map(c => c.id).sort()).toEqual([3, 4])
  })

  it('authMethods 多选是 OR', () => {
    const f: FilterCriteria = { status: 'all', subscription: '', authMethods: ['social', 'idc'] }
    expect(applyFilters(list, f, () => null).map(c => c.id).sort()).toEqual([1, 2, 4])
  })

  it('subscription 精确匹配（依赖 balance）', () => {
    const f: FilterCriteria = { status: 'all', subscription: 'KIRO PRO', authMethods: [] }
    const result = applyFilters(list, f, (id) =>
      id === 1
        ? { id: 1, subscriptionTitle: 'KIRO PRO', currentUsage: 0, usageLimit: 1000, remaining: 1000, usagePercentage: 0, nextResetAt: null }
        : null
    )
    expect(result.map(c => c.id)).toEqual([1])
  })

  it('subscription 设置但 balance 未查询的凭据被排除', () => {
    const f: FilterCriteria = { status: 'all', subscription: 'KIRO PRO', authMethods: [] }
    expect(applyFilters(list, f, () => null)).toHaveLength(0)
  })

  it('多条件 AND', () => {
    const f: FilterCriteria = { status: 'error', subscription: '', authMethods: ['api_key'] }
    expect(applyFilters(list, f, () => null).map(c => c.id)).toEqual([3])
  })
})

describe('applySearch', () => {
  const list: CredentialStatusItem[] = [
    c({ id: 1, email: 'alice@x.com', maskedApiKey: 'sk-***-3a7f' }),
    c({ id: 23, email: 'bob@x.com', maskedApiKey: 'sk-***-bcde' }),
    c({ id: 100 }),
  ]

  it('空关键字返回全量', () => { expect(applySearch(list, '')).toHaveLength(3) })
  it('email 子串匹配', () => { expect(applySearch(list, 'alice').map(c => c.id)).toEqual([1]) })
  it('email 不区分大小写', () => { expect(applySearch(list, 'ALICE').map(c => c.id)).toEqual([1]) })
  it('id 精确匹配', () => { expect(applySearch(list, '23').map(c => c.id)).toEqual([23]) })
  it('id 部分不命中', () => { expect(applySearch(list, '2')).toHaveLength(0) })
  it('maskedApiKey 末 4 字符匹配', () => {
    expect(applySearch(list, '3a7f').map(c => c.id)).toEqual([1])
    expect(applySearch(list, 'bcde').map(c => c.id)).toEqual([23])
  })
  it('4 字符但非字母数字不触发', () => { expect(applySearch(list, '3a7-')).toHaveLength(0) })
  it('首尾空白 trim', () => { expect(applySearch(list, '  alice  ').map(c => c.id)).toEqual([1]) })
  it('email 缺失的凭据可被 id 命中', () => { expect(applySearch(list, '100').map(c => c.id)).toEqual([100]) })
})
