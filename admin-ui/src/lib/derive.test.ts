import { describe, it, expect } from 'vitest'
import { deriveStatus } from './derive'
import type { CredentialStatusItem } from '@/types/api'

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
