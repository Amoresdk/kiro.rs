import { describe, it, expect } from 'vitest'
import { deriveStatus, deriveUsageSegment } from './derive'
import type { CredentialStatusItem, BalanceResponse } from '@/types/api'

function makeCred(overrides: Partial<CredentialStatusItem> = {}): CredentialStatusItem {
  return {
    id: 1,
    priority: 0,
    disabled: false,
    failureCount: 0,
    refreshFailureCount: 0,
    successCount: 0,
    isCurrent: false,
    expiresAt: null,
    authMethod: 'social',
    hasProfileArn: false,
    lastUsedAt: null,
    hasProxy: false,
    endpoint: 'us-east-1',
    ...overrides,
  }
}

describe('deriveStatus', () => {
  it('全 0 + 启用 = normal', () => {
    expect(deriveStatus(makeCred())).toBe('normal')
  })

  it('disabled = error', () => {
    expect(deriveStatus(makeCred({ disabled: true }))).toBe('error')
  })

  it('refreshFailureCount >= 1 = error（即使未禁用）', () => {
    expect(deriveStatus(makeCred({ refreshFailureCount: 1 }))).toBe('error')
    expect(deriveStatus(makeCred({ refreshFailureCount: 99 }))).toBe('error')
  })

  it('disabled 同时 refreshFailureCount > 0 = error', () => {
    expect(deriveStatus(makeCred({ disabled: true, refreshFailureCount: 5 }))).toBe('error')
  })

  it('failureCount > 0 + 启用 + refreshFailureCount = 0 = throttled', () => {
    expect(deriveStatus(makeCred({ failureCount: 1 }))).toBe('throttled')
    expect(deriveStatus(makeCred({ failureCount: 100 }))).toBe('throttled')
  })

  it('failureCount > 0 但 refreshFailureCount > 0 优先 error', () => {
    expect(deriveStatus(makeCred({ failureCount: 5, refreshFailureCount: 1 }))).toBe('error')
  })

  it('failureCount > 0 但 disabled 优先 error', () => {
    expect(deriveStatus(makeCred({ failureCount: 5, disabled: true }))).toBe('error')
  })
})

function makeBalance(overrides: Partial<BalanceResponse> = {}): BalanceResponse {
  return {
    id: 1,
    subscriptionTitle: 'KIRO PRO',
    currentUsage: 0,
    usageLimit: 1000,
    remaining: 1000,
    usagePercentage: 0,
    nextResetAt: null,
    ...overrides,
  }
}

describe('deriveUsageSegment', () => {
  it('balance 为 null = unknown', () => {
    expect(deriveUsageSegment(null)).toBe('unknown')
  })

  it('usageLimit = 0 = unknown（防除零）', () => {
    expect(deriveUsageSegment(makeBalance({ usageLimit: 0, currentUsage: 0 }))).toBe('unknown')
  })

  it('usageLimit = -1 = unknown（防负数）', () => {
    expect(deriveUsageSegment(makeBalance({ usageLimit: -1 }))).toBe('unknown')
  })

  it('0% = normal', () => {
    expect(deriveUsageSegment(makeBalance({ currentUsage: 0, usageLimit: 1000 }))).toBe('normal')
  })

  it('79.9% = normal', () => {
    expect(deriveUsageSegment(makeBalance({ currentUsage: 799, usageLimit: 1000 }))).toBe('normal')
  })

  it('80% = warning', () => {
    expect(deriveUsageSegment(makeBalance({ currentUsage: 800, usageLimit: 1000 }))).toBe('warning')
  })

  it('99.9% = warning', () => {
    expect(deriveUsageSegment(makeBalance({ currentUsage: 999, usageLimit: 1000 }))).toBe('warning')
  })

  it('100% = full', () => {
    expect(deriveUsageSegment(makeBalance({ currentUsage: 1000, usageLimit: 1000 }))).toBe('full')
  })

  it('123.4% = overflow', () => {
    expect(deriveUsageSegment(makeBalance({ currentUsage: 1234, usageLimit: 1000 }))).toBe('overflow')
  })

  it('1% over = overflow', () => {
    expect(deriveUsageSegment(makeBalance({ currentUsage: 1001, usageLimit: 1000 }))).toBe('overflow')
  })
})
