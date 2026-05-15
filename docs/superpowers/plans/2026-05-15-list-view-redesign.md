# 凭据管理面板列表视图改造 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `admin-ui` 的凭据管理界面从 3 列卡片网格替换为 12 列高密度列表视图，支持筛选/排序/搜索/URL 同步/超额可视化。

**Architecture:** 仅前端改造，不动后端 API。新增 `lib/derive.ts`（纯函数派生）+ `hooks/use-url-state.ts`（URL 状态同步）作为基础层；按"叶子组件 → 主行 → 容器表 → 工具栏 → Dashboard"自下而上构建；最后整体替换 `Dashboard.tsx` 主体并删除 `credential-card.tsx`。

**Tech Stack:** React 18 + TypeScript + TanStack Query + Tailwind + shadcn/ui（已有）+ Radix（已有）+ vitest（**新引入**仅给派生函数做单元测试）+ lucide-react 图标。

**关键技术决策（自主取舍，spec 未明示）：**
- **测试范围**：派生层（`derive.ts` / `filter.ts` / `sort.ts` / `search.ts`）引入 **vitest** 做单元测试 — 这些是纯函数、bug 难以靠肉眼发现、且未来调阈值有回归风险。组件层不引 React Testing Library，靠手动 `pnpm dev` 验证（项目无 CI，组件测试 ROI 不高）。
- **新增 shadcn 组件**：dropdown-menu、tabs、select、popover、tooltip — 用 `npx shadcn@latest add` 拉取，依赖已有的 Radix 包。
- **路由库**：不引入。`useUrlState` 自实现，listen `popstate` 事件。
- **commit 节奏**：每个 Task 末尾一次 commit，不做 squash。

**Spec:** `docs/superpowers/specs/2026-05-15-list-view-redesign-design.md`

---

## Task 1: 派生函数 — 状态判定（deriveStatus）

**Files:**
- Create: `admin-ui/src/lib/derive.ts`
- Test: `admin-ui/src/lib/derive.test.ts`

- [ ] **Step 1: 写失败的单元测试**

Create `admin-ui/src/lib/derive.test.ts`:

```typescript
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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd admin-ui && pnpm test`
Expected: FAIL — 模块未找到 `./derive`

- [ ] **Step 3: 实现 deriveStatus**

Create `admin-ui/src/lib/derive.ts`:

```typescript
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
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd admin-ui && pnpm test`
Expected: 7 个 deriveStatus 用例全部 PASS

- [ ] **Step 5: Commit**

```bash
git add admin-ui/src/lib/derive.ts admin-ui/src/lib/derive.test.ts
git commit -m "feat(admin-ui): 新增 deriveStatus 派生函数与单测"
```

---

## Task 2: 派生函数 — 用量段判定（deriveUsageSegment）

**Files:**
- Modify: `admin-ui/src/lib/derive.ts`
- Modify: `admin-ui/src/lib/derive.test.ts`

- [ ] **Step 1: 追加失败测试到 derive.test.ts**

在 `admin-ui/src/lib/derive.test.ts` 末尾追加：

```typescript
import type { BalanceResponse } from '@/types/api'

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
```

同时更新文件头部 import，从：

```typescript
import { deriveStatus } from './derive'
```

改为：

```typescript
import { deriveStatus, deriveUsageSegment } from './derive'
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd admin-ui && pnpm test`
Expected: deriveUsageSegment 用例 FAIL（未导出）

- [ ] **Step 3: 实现 deriveUsageSegment**

在 `admin-ui/src/lib/derive.ts` 末尾追加：

```typescript
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
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd admin-ui && pnpm test`
Expected: 全部 17 个用例（7 + 10）PASS

- [ ] **Step 5: Commit**

```bash
git add admin-ui/src/lib/derive.ts admin-ui/src/lib/derive.test.ts
git commit -m "feat(admin-ui): 新增 deriveUsageSegment 用量段派生"
```

---

## Task 3: 筛选与搜索（applyFilters / applySearch）

**Files:**
- Create: `admin-ui/src/lib/filter.ts`
- Create: `admin-ui/src/lib/filter.test.ts`

- [ ] **Step 1: 写失败测试**

Create `admin-ui/src/lib/filter.test.ts`:

```typescript
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
<!-- PLAN_TASK3_TESTS -->
})
```

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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd admin-ui && pnpm test`
Expected: FAIL — 模块未找到 `./filter`

- [ ] **Step 3: 实现 filter.ts**

Create `admin-ui/src/lib/filter.ts`:

```typescript
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
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd admin-ui && pnpm test`
Expected: 全部用例 PASS

- [ ] **Step 5: Commit**

```bash
git add admin-ui/src/lib/filter.ts admin-ui/src/lib/filter.test.ts
git commit -m "feat(admin-ui): 新增 applyFilters / applySearch"
```

---

## Task 4: 排序（applySort）

**Files:**
- Create: `admin-ui/src/lib/sort.ts`
- Create: `admin-ui/src/lib/sort.test.ts`

- [ ] **Step 1: 写失败测试**

Create `admin-ui/src/lib/sort.test.ts`:

```typescript
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
    const map = { 5: b(500, 1000), 2: b(500, 1000), 8: b(500, 1000) }
    expect(applySort(list, 'usage', 'desc', id => map[id]).map(c => c.id)).toEqual([2, 5, 8])
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd admin-ui && pnpm test`
Expected: FAIL — 模块未找到

- [ ] **Step 3: 实现 sort.ts**

Create `admin-ui/src/lib/sort.ts`:

```typescript
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
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd admin-ui && pnpm test`
Expected: 全部用例 PASS

- [ ] **Step 5: Commit**

```bash
git add admin-ui/src/lib/sort.ts admin-ui/src/lib/sort.test.ts
git commit -m "feat(admin-ui): 新增 applySort 排序派生"
```

---

## Task 5: URL 状态同步 hook（useUrlState）

**Files:**
- Create: `admin-ui/src/hooks/use-url-state.ts`

- [ ] **Step 1: 实现 useUrlState**

Create `admin-ui/src/hooks/use-url-state.ts`:

```typescript
import { useCallback, useEffect, useState } from 'react'

export interface ListViewUrlState {
  status: 'all' | 'normal' | 'throttled' | 'error'
  subscription: string
  authMethods: string[]
  q: string
  sort: 'usage' | 'priority' | 'failure' | 'lastUsed' | null
  dir: 'asc' | 'desc'
  page: number
  size: 50 | 100 | 200
}

const DEFAULTS: ListViewUrlState = {
  status: 'all',
  subscription: '',
  authMethods: [],
  q: '',
  sort: null,
  dir: 'desc',
  page: 1,
  size: 50,
}

function parseStatus(v: string | null): ListViewUrlState['status'] {
  return v === 'normal' || v === 'throttled' || v === 'error' ? v : 'all'
}
function parseSort(v: string | null): ListViewUrlState['sort'] {
  return v === 'usage' || v === 'priority' || v === 'failure' || v === 'lastUsed' ? v : null
}
function parseDir(v: string | null): ListViewUrlState['dir'] {
  return v === 'asc' ? 'asc' : 'desc'
}
function parseSize(v: string | null): ListViewUrlState['size'] {
  const n = Number(v)
  return n === 100 || n === 200 ? n : 50
}
function parsePage(v: string | null): number {
  const n = Number(v); return Number.isInteger(n) && n >= 1 ? n : 1
}

function readFromUrl(): ListViewUrlState {
  const p = new URLSearchParams(window.location.search)
  return {
    status: parseStatus(p.get('status')),
    subscription: p.get('sub') ?? '',
    authMethods: p.get('auth') ? p.get('auth')!.split(',').filter(Boolean) : [],
    q: p.get('q') ?? '',
    sort: parseSort(p.get('sort')),
    dir: parseDir(p.get('dir')),
    page: parsePage(p.get('page')),
    size: parseSize(p.get('size')),
  }
}

function writeToUrl(state: ListViewUrlState) {
  const p = new URLSearchParams()
  if (state.status !== DEFAULTS.status) p.set('status', state.status)
  if (state.subscription) p.set('sub', state.subscription)
  if (state.authMethods.length) p.set('auth', state.authMethods.join(','))
  if (state.q) p.set('q', state.q)
  if (state.sort) p.set('sort', state.sort)
  if (state.dir !== DEFAULTS.dir) p.set('dir', state.dir)
  if (state.page !== 1) p.set('page', String(state.page))
  if (state.size !== 50) p.set('size', String(state.size))
  const qs = p.toString()
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  window.history.replaceState(null, '', url)
}

export function useUrlState(): [ListViewUrlState, (patch: Partial<ListViewUrlState>) => void] {
  const [state, setState] = useState<ListViewUrlState>(() => readFromUrl())

  useEffect(() => {
    const handler = () => setState(readFromUrl())
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const update = useCallback((patch: Partial<ListViewUrlState>) => {
    setState(prev => {
      const next = { ...prev, ...patch }
      // 改变筛选/搜索/排序时回到第 1 页（除非显式指定了 page）
      const filterChanged =
        patch.status !== undefined || patch.subscription !== undefined ||
        patch.authMethods !== undefined || patch.q !== undefined ||
        patch.sort !== undefined || patch.dir !== undefined ||
        patch.size !== undefined
      if (filterChanged && patch.page === undefined) next.page = 1
      writeToUrl(next)
      return next
    })
  }, [])

  return [state, update]
}
```

- [ ] **Step 2: TypeScript 检查**

Run: `cd admin-ui && pnpm exec tsc -b`
Expected: 无错误（仅 .tsx 编译，本文件不影响其他文件）

- [ ] **Step 3: Commit**

```bash
git add admin-ui/src/hooks/use-url-state.ts
git commit -m "feat(admin-ui): 新增 useUrlState 用于列表筛选状态 URL 同步"
```

---

## Task 6: 引入缺失的 shadcn/ui 组件

> 目标：补齐后续组件依赖的 dropdown-menu / tabs / select / popover / tooltip 五个 wrapper。所需 Radix 包项目已部分安装（dropdown、tooltip 已有；tabs / select / popover 需新装）。

**Files:**
- Create: `admin-ui/src/components/ui/dropdown-menu.tsx`
- Create: `admin-ui/src/components/ui/tabs.tsx`
- Create: `admin-ui/src/components/ui/select.tsx`
- Create: `admin-ui/src/components/ui/popover.tsx`
- Create: `admin-ui/src/components/ui/tooltip.tsx`
- Modify: `admin-ui/package.json`

- [ ] **Step 1: 安装缺失的 Radix 依赖**

```bash
cd admin-ui
pnpm add @radix-ui/react-tabs @radix-ui/react-select @radix-ui/react-popover
```

- [ ] **Step 2: 创建 5 个 shadcn wrapper（参考已有 button.tsx / dialog.tsx 风格）**

每个 wrapper 都是「命名 export Radix 子组件 + 应用 cn() 样式」的标准 shadcn 模板。直接复制以下内容（与 shadcn CLI 默认输出一致）：

Create `admin-ui/src/components/ui/dropdown-menu.tsx`：

```tsx
import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'

const DropdownMenu = DropdownMenuPrimitive.Root
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
const DropdownMenuGroup = DropdownMenuPrimitive.Group
const DropdownMenuPortal = DropdownMenuPrimitive.Portal
const DropdownMenuSub = DropdownMenuPrimitive.Sub
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      inset && 'pl-8',
      className
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-muted', className)} {...props} />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuGroup, DropdownMenuPortal,
  DropdownMenuSub, DropdownMenuRadioGroup, DropdownMenuSeparator,
}
```

Create `admin-ui/src/components/ui/tabs.tsx`：

```tsx
import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground', className)}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow',
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('mt-2', className)} {...props} />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
```

Create `admin-ui/src/components/ui/popover.tsx`：

```tsx
import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none',
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent }
```

Create `admin-ui/src/components/ui/tooltip.tsx`：

```tsx
import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow',
      className
    )}
    {...props}
  />
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
```

Create `admin-ui/src/components/ui/select.tsx`：

```tsx
import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild><ChevronDown className="h-4 w-4 opacity-50" /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
        className
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator><Check className="h-4 w-4" /></SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem }
```

- [ ] **Step 3: TypeScript 检查**

Run: `cd admin-ui && pnpm exec tsc -b`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add admin-ui/src/components/ui/*.tsx admin-ui/package.json admin-ui/pnpm-lock.yaml
git commit -m "feat(admin-ui): 引入 shadcn dropdown/tabs/select/popover/tooltip wrapper"
```

---

## Task 7: 叶子组件 — UsageProgress（用量进度条）

**Files:**
- Create: `admin-ui/src/components/list-view/usage-progress.tsx`

- [ ] **Step 1: 实现 UsageProgress**

Create `admin-ui/src/components/list-view/usage-progress.tsx`:

```tsx
import type { BalanceResponse } from '@/types/api'
import { deriveUsageSegment } from '@/lib/derive'
import { cn } from '@/lib/utils'

interface UsageProgressProps {
  balance: BalanceResponse | null
  loading?: boolean
}

export function UsageProgress({ balance, loading }: UsageProgressProps) {
  const segment = deriveUsageSegment(balance)

  if (segment === 'unknown') {
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-[120px] rounded-full bg-gray-100 dark:bg-gray-800" />
        <span className="text-xs text-gray-400">{loading ? '加载中...' : '— / —'}</span>
      </div>
    )
  }

  const pct = (balance!.currentUsage / balance!.usageLimit) * 100
  const widthPct = Math.min(100, pct)
  const numerator = balance!.currentUsage.toLocaleString()
  const denominator = balance!.usageLimit.toLocaleString()

  const fillClass = {
    normal: 'bg-emerald-500',
    warning: 'bg-amber-500',
    full: 'bg-red-500',
    overflow: '',
  }[segment]

  const textClass = {
    normal: 'text-gray-900 dark:text-gray-100',
    warning: 'text-amber-800 dark:text-amber-300',
    full: 'text-red-800 dark:text-red-300',
    overflow: 'text-red-800 dark:text-red-300',
  }[segment]

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'relative h-1.5 w-[120px] rounded-full bg-gray-100 dark:bg-gray-800',
          segment === 'overflow' && 'border border-red-200 dark:border-red-900'
        )}
      >
        {segment === 'overflow' ? (
          <>
            <div
              className="h-1.5 w-full rounded-full"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, #ef4444 0 4px, #fb7185 4px 8px)',
              }}
            />
            <div className="absolute -right-0.5 -top-0.5 -bottom-0.5 w-1 rounded-sm bg-red-600" />
          </>
        ) : (
          <div
            className={cn('h-1.5 rounded-full', fillClass)}
            style={{ width: `${widthPct}%` }}
          />
        )}
      </div>
      <span className={cn('text-xs', textClass)}>
        <span className="font-semibold">{numerator}</span>
        <span className="text-gray-400"> / {denominator}</span>
      </span>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 检查 + 启动 dev server 视觉验证**

```bash
cd admin-ui && pnpm exec tsc -b
```

Expected: 无错误。视觉验证将在 Dashboard 集成后统一进行（Task 17）。

- [ ] **Step 3: Commit**

```bash
git add admin-ui/src/components/list-view/usage-progress.tsx
git commit -m "feat(admin-ui): 新增 UsageProgress 用量进度条组件"
```

---

## Task 8: 叶子组件 — StatusBadge（状态徽章）

**Files:**
- Create: `admin-ui/src/components/list-view/status-badge.tsx`

- [ ] **Step 1: 实现 StatusBadge**

Create `admin-ui/src/components/list-view/status-badge.tsx`:

```tsx
import type { CredentialStatus } from '@/lib/derive'
import { cn } from '@/lib/utils'

const STYLE: Record<CredentialStatus, string> = {
  normal: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  throttled: 'bg-amber-50 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  error: 'bg-red-50 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}
const LABEL: Record<CredentialStatus, string> = {
  normal: '正常',
  throttled: '限速',
  error: '异常',
}

export function StatusBadge({ status }: { status: CredentialStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold',
        STYLE[status]
      )}
    >
      {LABEL[status]}
    </span>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add admin-ui/src/components/list-view/status-badge.tsx
git commit -m "feat(admin-ui): 新增 StatusBadge 状态徽章"
```

---

## Task 9: 叶子组件 — InlinePriorityEdit（优先级行内编辑）

**Files:**
- Create: `admin-ui/src/components/list-view/inline-priority-edit.tsx`

- [ ] **Step 1: 实现 InlinePriorityEdit**

Create `admin-ui/src/components/list-view/inline-priority-edit.tsx`:

```tsx
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSetPriority } from '@/hooks/use-credentials'
import { extractErrorMessage } from '@/lib/utils'

interface InlinePriorityEditProps {
  id: number
  value: number
}

export function InlinePriorityEdit({ id, value }: InlinePriorityEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const setPriority = useSetPriority()

  const submit = () => {
    const n = parseInt(draft, 10)
    if (isNaN(n) || n < 0) {
      toast.error('优先级必须是非负整数')
      return
    }
    setPriority.mutate(
      { id, priority: n },
      {
        onSuccess: () => { toast.success('已更新优先级'); setEditing(false) },
        onError: (e) => toast.error('更新失败：' + extractErrorMessage(e)),
      }
    )
  }

  if (!editing) {
    return (
      <span
        className="cursor-pointer hover:underline font-medium"
        onClick={() => { setDraft(String(value)); setEditing(true) }}
        title="点击编辑"
      >
        {value}
      </span>
    )
  }

  return (
    <div className="inline-flex items-center gap-1">
      <Input
        type="number"
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-7 w-14 text-sm"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') { setEditing(false); setDraft(String(value)) }
        }}
      />
      <Button
        size="sm" variant="ghost" className="h-7 w-7 p-0"
        onClick={submit} disabled={setPriority.isPending}
      >✓</Button>
      <Button
        size="sm" variant="ghost" className="h-7 w-7 p-0"
        onClick={() => { setEditing(false); setDraft(String(value)) }}
      >✕</Button>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 检查**

Run: `cd admin-ui && pnpm exec tsc -b`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add admin-ui/src/components/list-view/inline-priority-edit.tsx
git commit -m "feat(admin-ui): 新增 InlinePriorityEdit 优先级行内编辑"
```

---

## Task 10: 叶子组件 — RowActions（行内操作 + ⋯ 菜单）

**Files:**
- Create: `admin-ui/src/components/list-view/row-actions.tsx`

- [ ] **Step 1: 实现 RowActions**

Create `admin-ui/src/components/list-view/row-actions.tsx`:

```tsx
import { useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, RotateCcw, Wallet, MoreHorizontal, ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  useForceRefreshToken, useResetFailure, useSetPriority, useDeleteCredential,
} from '@/hooks/use-credentials'
import { extractErrorMessage } from '@/lib/utils'
import type { CredentialStatusItem } from '@/types/api'

interface RowActionsProps {
  cred: CredentialStatusItem
  onViewBalance: (id: number) => void
}

export function RowActions({ cred, onViewBalance }: RowActionsProps) {
  const [showDelete, setShowDelete] = useState(false)
  const refresh = useForceRefreshToken()
  const reset = useResetFailure()
  const setPriority = useSetPriority()
  const del = useDeleteCredential()

  const refreshDisabled = refresh.isPending || cred.disabled || cred.authMethod === 'api_key'
  const resetDisabled = reset.isPending || (cred.failureCount === 0 && cred.refreshFailureCount === 0)
  const refreshTitle = cred.authMethod === 'api_key'
    ? 'API Key 凭据无需刷新 Token'
    : cred.disabled ? '已禁用的凭据无法刷新 Token' : '刷新 Token'

  const handleRefresh = () => refresh.mutate(cred.id, {
    onSuccess: (r) => toast.success(r.message),
    onError: (e) => toast.error('刷新失败：' + extractErrorMessage(e)),
  })

  const handleReset = () => reset.mutate(cred.id, {
    onSuccess: (r) => toast.success(r.message),
    onError: (e) => toast.error('重置失败：' + extractErrorMessage(e)),
  })

  const handlePriorityShift = (delta: number) => {
    const next = Math.max(0, cred.priority + delta)
    setPriority.mutate({ id: cred.id, priority: next }, {
      onSuccess: () => toast.success(`优先级已改为 ${next}`),
      onError: (e) => toast.error('操作失败：' + extractErrorMessage(e)),
    })
  }

  const handleDelete = () => {
    if (!cred.disabled) { toast.error('请先禁用凭据再删除'); setShowDelete(false); return }
    del.mutate(cred.id, {
      onSuccess: (r) => { toast.success(r.message); setShowDelete(false) },
      onError: (e) => toast.error('删除失败：' + extractErrorMessage(e)),
    })
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm" variant="ghost" className="h-7 w-7 p-0"
              onClick={handleRefresh} disabled={refreshDisabled}
              aria-label="刷新 Token"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refresh.isPending ? 'animate-spin' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{refreshTitle}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm" variant="ghost" className="h-7 w-7 p-0"
              onClick={handleReset} disabled={resetDisabled}
              aria-label="重置失败计数"
            ><RotateCcw className="h-3.5 w-3.5" /></Button>
          </TooltipTrigger>
          <TooltipContent>重置失败计数</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm" variant="ghost" className="h-7 w-7 p-0"
              onClick={() => onViewBalance(cred.id)}
              aria-label="查看余额"
            ><Wallet className="h-3.5 w-3.5" /></Button>
          </TooltipTrigger>
          <TooltipContent>查看余额详情</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="更多操作">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => handlePriorityShift(-1)}
              disabled={setPriority.isPending || cred.priority === 0}
            >
              <ChevronUp className="mr-2 h-4 w-4" /> 提高优先级
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handlePriorityShift(1)}
              disabled={setPriority.isPending}
            >
              <ChevronDown className="mr-2 h-4 w-4" /> 降低优先级
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setShowDelete(true)}
              disabled={!cred.disabled}
              className="text-red-600 focus:text-red-600"
            >
              <Trash2 className="mr-2 h-4 w-4" /> 删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除凭据</DialogTitle>
            <DialogDescription>
              您确定要删除凭据 #{cred.id} 吗？此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={del.isPending}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={del.isPending || !cred.disabled}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

- [ ] **Step 2: TypeScript 检查**

Run: `cd admin-ui && pnpm exec tsc -b`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add admin-ui/src/components/list-view/row-actions.tsx
git commit -m "feat(admin-ui): 新增 RowActions 行内 3 图标 + 更多菜单"
```

---

## Task 11: 时间格式化工具 + ExpandedRow（展开行详情）

**Files:**
- Modify: `admin-ui/src/lib/utils.ts`（追加 formatRelativeTime 等）
- Create: `admin-ui/src/components/list-view/expanded-row.tsx`

- [ ] **Step 1: 在 utils.ts 末尾追加格式化工具**

Modify `admin-ui/src/lib/utils.ts`，在文件末尾追加：

```typescript
/** 把绝对时间字符串格式化为「X 分钟前」相对时间。null 时返回「从未使用」 */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '从未使用'
  const t = new Date(iso).getTime()
  const now = Date.now()
  const diff = now - t
  if (diff < 0) return '刚刚'
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

/** 把 ISO 时间格式化为日历日期：2026-04-01 */
export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 把秒级 unix 时间格式化为「N 天后」相对值 */
export function formatRelativeFuture(unixSec: number | null): string {
  if (!unixSec) return '—'
  const diff = unixSec * 1000 - Date.now()
  if (diff <= 0) return '已重置'
  const days = Math.floor(diff / 86400000)
  if (days >= 1) return `${days} 天后`
  const hours = Math.floor(diff / 3600000)
  return `${hours} 小时后`
}
```

- [ ] **Step 2: 实现 ExpandedRow**

Create `admin-ui/src/components/list-view/expanded-row.tsx`:

```tsx
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CredentialStatusItem, BalanceResponse } from '@/types/api'
import { formatDate, formatRelativeFuture } from '@/lib/utils'

interface ExpandedRowProps {
  cred: CredentialStatusItem
  balance: BalanceResponse | null
  loadingBalance: boolean
  onQueryBalance: (id: number) => void
}

const AUTH_LABEL: Record<string, string> = {
  social: 'Social',
  idc: 'IdC',
  api_key: 'API Key',
}

export function ExpandedRow({ cred, balance, loadingBalance, onQueryBalance }: ExpandedRowProps) {
  return (
    <tr className="bg-gray-50 dark:bg-gray-900/40">
      <td colSpan={12} className="p-0">
        <div className="ml-[70px] mr-4 my-3 rounded-lg border bg-white dark:bg-gray-950 dark:border-gray-800 p-4">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <Field label="凭据 ID"><span className="font-mono">#{cred.id}</span></Field>
            <Field label="认证方式">
              {cred.authMethod ? AUTH_LABEL[cred.authMethod] ?? cred.authMethod : '—'}
              {cred.expiresAt && <span className="text-gray-400"> · 下次刷新 {formatDate(cred.expiresAt)}</span>}
            </Field>
            <Field label="Endpoint">
              <span className="font-mono">{cred.endpoint || '—'}</span>
            </Field>
            <Field label="API Key">
              <span className="font-mono">{cred.maskedApiKey || '—'}</span>
            </Field>
            <Field label="代理">
              <span className="font-mono">{cred.hasProxy ? cred.proxyUrl ?? '—' : '—'}</span>
            </Field>
            <Field label="Profile ARN">{cred.hasProfileArn ? '有 ✓' : '—'}</Field>
            <Field label="订阅详情">
              {loadingBalance ? (
                <span className="text-gray-500"><Loader2 className="inline w-3 h-3 animate-spin mr-1" />加载中</span>
              ) : balance ? (
                <span>
                  剩余 {balance.remaining.toLocaleString()} / {balance.usageLimit.toLocaleString()}
                  （{(100 - balance.usagePercentage).toFixed(1)}%）
                  <span className="text-gray-400"> · 下次重置 {formatRelativeFuture(balance.nextResetAt)}</span>
                </span>
              ) : (
                <span className="space-x-2">
                  <span className="text-gray-500">未查询</span>
                  <Button size="sm" variant="outline" className="h-6" onClick={() => onQueryBalance(cred.id)}>
                    立即查询
                  </Button>
                </span>
              )}
            </Field>
            <Field label="禁用原因">
              {cred.disabled ? (cred.disabledReason || '—') : '—'}
            </Field>
            <Field label="成功调用">{cred.successCount.toLocaleString()}</Field>
          </div>
        </div>
      </td>
    </tr>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div>{children}</div>
    </div>
  )
}
```

- [ ] **Step 3: TypeScript 检查**

Run: `cd admin-ui && pnpm exec tsc -b`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add admin-ui/src/lib/utils.ts admin-ui/src/components/list-view/expanded-row.tsx
git commit -m "feat(admin-ui): 新增 ExpandedRow 行展开详情面板与时间格式化工具"
```

---

## Task 12: CredentialRow（主行）+ TableHeader（可排序表头）

**Files:**
- Create: `admin-ui/src/components/list-view/table-header.tsx`
- Create: `admin-ui/src/components/list-view/credential-row.tsx`

- [ ] **Step 1: 实现 TableHeader**

Create `admin-ui/src/components/list-view/table-header.tsx`:

```tsx
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { SortKey, SortDir } from '@/lib/sort'

interface TableHeaderProps {
  sortKey: SortKey | null
  sortDir: SortDir
  onSortChange: (key: SortKey | null, dir: SortDir) => void
  allSelected: boolean
  someSelected: boolean
  onToggleAll: () => void
}

const SORTABLE: Record<SortKey, string> = {
  usage: '用量',
  priority: '优先级',
  failure: '失败',
  lastUsed: '最后调用',
}

export function TableHeader({
  sortKey, sortDir, onSortChange, allSelected, someSelected, onToggleAll,
}: TableHeaderProps) {
  const handleSortClick = (key: SortKey) => {
    if (sortKey !== key) onSortChange(key, 'desc')
    else if (sortDir === 'desc') onSortChange(key, 'asc')
    else onSortChange(null, 'desc')
  }

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="inline ml-1 h-3 w-3 text-gray-400" />
    return sortDir === 'asc'
      ? <ArrowUp className="inline ml-1 h-3 w-3" />
      : <ArrowDown className="inline ml-1 h-3 w-3" />
  }

  const renderHeader = (label: string, key?: SortKey, className?: string) => (
    <th
      className={cn(
        'px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400',
        key && 'cursor-pointer select-none hover:text-gray-900 dark:hover:text-gray-200',
        className
      )}
      aria-sort={key && sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
      onClick={key ? () => handleSortClick(key) : undefined}
    >
      {label}{key && <SortIcon k={key} />}
    </th>
  )

  return (
    <thead className="bg-gray-50 dark:bg-gray-900/60 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
      <tr>
        <th className="w-8 px-2 py-2.5">
          <Checkbox
            checked={allSelected}
            onCheckedChange={onToggleAll}
            aria-label="全选当前页"
            // Radix Checkbox 不支持 indeterminate prop；通过 data-state 视觉提示
            data-some-selected={someSelected ? 'true' : undefined}
          />
        </th>
        {renderHeader('#', undefined, 'w-10')}
        {renderHeader('邮箱')}
        {renderHeader('订阅')}
        {renderHeader(SORTABLE.usage, 'usage')}
        {renderHeader('状态')}
        {renderHeader(SORTABLE.priority, 'priority')}
        {renderHeader(SORTABLE.failure, 'failure')}
        {renderHeader('成功')}
        {renderHeader(SORTABLE.lastUsed, 'lastUsed')}
        {renderHeader('启用')}
        {renderHeader('操作')}
      </tr>
    </thead>
  )
}
```

- [ ] **Step 2: 实现 CredentialRow**

Create `admin-ui/src/components/list-view/credential-row.tsx`:

```tsx
import { ChevronRight, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { CredentialStatusItem, BalanceResponse } from '@/types/api'
import { deriveStatus } from '@/lib/derive'
import { formatRelativeTime, cn, extractErrorMessage } from '@/lib/utils'
import { useSetDisabled } from '@/hooks/use-credentials'
import { UsageProgress } from './usage-progress'
import { StatusBadge } from './status-badge'
import { InlinePriorityEdit } from './inline-priority-edit'
import { RowActions } from './row-actions'

interface CredentialRowProps {
  cred: CredentialStatusItem
  balance: BalanceResponse | null
  loadingBalance: boolean
  selected: boolean
  expanded: boolean
  onToggleSelect: () => void
  onToggleExpand: () => void
  onViewBalance: (id: number) => void
}

const AUTH_BADGE: Record<string, { label: string; class: string }> = {
  social: { label: 'Social', class: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  idc: { label: 'IdC', class: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  api_key: { label: 'API Key', class: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
}

export function CredentialRow({
  cred, balance, loadingBalance, selected, expanded,
  onToggleSelect, onToggleExpand, onViewBalance,
}: CredentialRowProps) {
  const status = deriveStatus(cred)
  const setDisabled = useSetDisabled()

  const handleToggleDisabled = () => {
    setDisabled.mutate(
      { id: cred.id, disabled: !cred.disabled },
      {
        onSuccess: (r) => toast.success(r.message),
        onError: (e) => toast.error('操作失败：' + extractErrorMessage(e)),
      }
    )
  }

  const failureCell = `${cred.failureCount}/${cred.refreshFailureCount}`
  const failureClass = cred.failureCount > 0 || cred.refreshFailureCount > 0
    ? 'text-red-600 font-semibold'
    : ''

  const authMeta = cred.authMethod ? AUTH_BADGE[cred.authMethod] : null

  return (
    <tr
      className={cn(
        'border-b border-gray-100 dark:border-gray-900 transition-colors',
        selected && 'bg-blue-50 dark:bg-blue-950/30',
        cred.disabled && 'opacity-60',
        cred.isCurrent && 'border-l-4 border-l-emerald-500'
      )}
    >
      <td className="px-2 py-2.5">
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label={`选择凭据 ${cred.id}`} />
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-500">{cred.id}</td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onToggleExpand}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            aria-label={expanded ? '收起详情' : '展开详情'}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {cred.isCurrent && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate max-w-[260px] text-sm">
                {cred.email || `凭据 #${cred.id}`}
              </span>
            </TooltipTrigger>
            <TooltipContent>{cred.email || `凭据 #${cred.id}`}</TooltipContent>
          </Tooltip>
          {cred.isCurrent && <Badge variant="success" className="text-[10px]">当前</Badge>}
          {cred.disabled && <Badge variant="destructive" className="text-[10px]">已禁用</Badge>}
          {cred.disabled && cred.disabledReason && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] max-w-[100px] truncate">
                  {cred.disabledReason}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>{cred.disabledReason}</TooltipContent>
            </Tooltip>
          )}
          {authMeta && (
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded', authMeta.class)}>{authMeta.label}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5">
        {balance?.subscriptionTitle ? (
          <span className="text-[10px] font-semibold bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 px-2 py-0.5 rounded">
            {balance.subscriptionTitle}
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 py-2.5"><UsageProgress balance={balance} loading={loadingBalance} /></td>
      <td className="px-3 py-2.5"><StatusBadge status={status} /></td>
      <td className="px-3 py-2.5 text-sm">
        <InlinePriorityEdit id={cred.id} value={cred.priority} />
      </td>
      <td className={cn('px-3 py-2.5 text-sm', failureClass)}>{failureCell}</td>
      <td className="px-3 py-2.5 text-sm">{cred.successCount.toLocaleString()}</td>
      <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-gray-400">{formatRelativeTime(cred.lastUsedAt)}</td>
      <td className="px-3 py-2.5">
        <Switch
          checked={!cred.disabled}
          onCheckedChange={handleToggleDisabled}
          disabled={setDisabled.isPending}
          aria-label="启用/禁用"
        />
      </td>
      <td className="px-3 py-2.5"><RowActions cred={cred} onViewBalance={onViewBalance} /></td>
    </tr>
  )
}
```

- [ ] **Step 3: TypeScript 检查**

Run: `cd admin-ui && pnpm exec tsc -b`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add admin-ui/src/components/list-view/credential-row.tsx admin-ui/src/components/list-view/table-header.tsx
git commit -m "feat(admin-ui): 新增 CredentialRow 主行 + TableHeader 可排序表头"
```

---

## Task 13: TablePagination（分页 + 每页选择）

**Files:**
- Create: `admin-ui/src/components/list-view/table-pagination.tsx`

- [ ] **Step 1: 实现 TablePagination**

Create `admin-ui/src/components/list-view/table-pagination.tsx`:

```tsx
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

interface TablePaginationProps {
  total: number
  page: number
  size: 50 | 100 | 200
  onPageChange: (page: number) => void
  onSizeChange: (size: 50 | 100 | 200) => void
}

export function TablePagination({ total, page, size, onPageChange, onSizeChange }: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / size))
  const safePage = Math.min(Math.max(1, page), totalPages)

  // 紧凑分页：始终显示首末页 + 当前页 ±1
  const pages: (number | '...')[] = []
  const add = (n: number | '...') => { if (pages[pages.length - 1] !== n) pages.push(n) }
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - safePage) <= 1) add(i)
    else add('...')
  }

  return (
    <div className="flex items-center justify-between py-3 px-4 text-sm">
      <div className="flex items-center gap-3 text-gray-500">
        <span>每页</span>
        <Select value={String(size)} onValueChange={(v) => onSizeChange(Number(v) as 50 | 100 | 200)}>
          <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="50">50</SelectItem>
            <SelectItem value="100">100</SelectItem>
            <SelectItem value="200">200</SelectItem>
          </SelectContent>
        </Select>
        <span>条 · 共 {total} 条</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm" variant="outline" className="h-8 w-8 p-0"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage === 1}
          aria-label="上一页"
        ><ChevronLeft className="h-4 w-4" /></Button>
        {pages.map((p, idx) =>
          p === '...' ? (
            <span key={`d-${idx}`} className="px-2 text-gray-400">…</span>
          ) : (
            <Button
              key={p}
              size="sm"
              variant={p === safePage ? 'default' : 'outline'}
              className="h-8 min-w-8 px-2"
              onClick={() => onPageChange(p)}
            >{p}</Button>
          )
        )}
        <Button
          size="sm" variant="outline" className="h-8 w-8 p-0"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          aria-label="下一页"
        ><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 检查**

Run: `cd admin-ui && pnpm exec tsc -b`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add admin-ui/src/components/list-view/table-pagination.tsx
git commit -m "feat(admin-ui): 新增 TablePagination 分页组件"
```

---

## Task 14: TopStatsBar（5 chip 统计） + FilterToolbar（筛选/搜索）

**Files:**
- Create: `admin-ui/src/components/list-view/top-stats-bar.tsx`
- Create: `admin-ui/src/components/list-view/filter-toolbar.tsx`

- [ ] **Step 1: 实现 TopStatsBar**

Create `admin-ui/src/components/list-view/top-stats-bar.tsx`:

```tsx
import { Users, CheckCircle2, Zap, AlertCircle, CheckSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TopStatsBarProps {
  total: number
  normal: number
  throttled: number
  error: number
  selected: number
  activeStatus: 'all' | 'normal' | 'throttled' | 'error'
  onStatusClick: (s: 'all' | 'normal' | 'throttled' | 'error') => void
}

interface ChipProps {
  icon: React.ReactNode
  label: string
  value: number
  tone: 'neutral' | 'green' | 'amber' | 'red' | 'blue'
  active: boolean
  onClick?: () => void
  disabled?: boolean
}

function Chip({ icon, label, value, tone, active, onClick, disabled }: ChipProps) {
  const toneClass = {
    neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
    green: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  }[tone]

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3.5 py-2.5 transition',
        'min-w-[120px] text-left',
        toneClass,
        active && 'ring-2 ring-offset-2 ring-offset-background ring-current',
        onClick ? 'hover:brightness-95 cursor-pointer' : 'cursor-default',
        disabled && 'opacity-60'
      )}
    >
      <div className="text-base">{icon}</div>
      <div>
        <div className="text-[11px] opacity-70">{label}</div>
        <div className="text-xl font-bold leading-none mt-0.5">{value}</div>
      </div>
    </button>
  )
}

export function TopStatsBar({
  total, normal, throttled, error, selected, activeStatus, onStatusClick,
}: TopStatsBarProps) {
  return (
    <div className="flex flex-wrap gap-2.5 mb-4">
      <Chip icon={<Users className="h-4 w-4" />} label="总数" value={total} tone="neutral"
            active={activeStatus === 'all'} onClick={() => onStatusClick('all')} />
      <Chip icon={<CheckCircle2 className="h-4 w-4" />} label="正常" value={normal} tone="green"
            active={activeStatus === 'normal'} onClick={() => onStatusClick('normal')} />
      <Chip icon={<Zap className="h-4 w-4" />} label="限速" value={throttled} tone="amber"
            active={activeStatus === 'throttled'} onClick={() => onStatusClick('throttled')} />
      <Chip icon={<AlertCircle className="h-4 w-4" />} label="异常" value={error} tone="red"
            active={activeStatus === 'error'} onClick={() => onStatusClick('error')} />
      <Chip icon={<CheckSquare className="h-4 w-4" />} label="已选中" value={selected} tone="blue"
            active={false} disabled={selected === 0} />
    </div>
  )
}
```

- [ ] **Step 2: 实现 FilterToolbar**

Create `admin-ui/src/components/list-view/filter-toolbar.tsx`:

```tsx
import { Search, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'

interface FilterToolbarProps {
  status: 'all' | 'normal' | 'throttled' | 'error'
  onStatusChange: (s: 'all' | 'normal' | 'throttled' | 'error') => void
  subscription: string
  subscriptionOptions: string[]
  onSubscriptionChange: (s: string) => void
  authMethods: string[]
  onAuthMethodsChange: (m: string[]) => void
  query: string
  onQueryChange: (q: string) => void
  rightSlot?: React.ReactNode
}

const AUTH_OPTIONS: { value: string; label: string }[] = [
  { value: 'social', label: 'Social' },
  { value: 'idc', label: 'IdC' },
  { value: 'api_key', label: 'API Key' },
]

export function FilterToolbar({
  status, onStatusChange,
  subscription, subscriptionOptions, onSubscriptionChange,
  authMethods, onAuthMethodsChange,
  query, onQueryChange,
  rightSlot,
}: FilterToolbarProps) {
  const toggleAuth = (v: string) => {
    onAuthMethodsChange(authMethods.includes(v) ? authMethods.filter(x => x !== v) : [...authMethods, v])
  }

  const authLabel = authMethods.length === 0
    ? '全部认证'
    : authMethods.length === AUTH_OPTIONS.length
      ? '全部认证'
      : `认证 (${authMethods.length})`

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <Tabs value={status} onValueChange={(v) => onStatusChange(v as any)}>
        <TabsList>
          <TabsTrigger value="all">全部</TabsTrigger>
          <TabsTrigger value="normal">正常</TabsTrigger>
          <TabsTrigger value="throttled">限速</TabsTrigger>
          <TabsTrigger value="error">异常</TabsTrigger>
        </TabsList>
      </Tabs>

      <Select value={subscription || '__all__'} onValueChange={(v) => onSubscriptionChange(v === '__all__' ? '' : v)}>
        <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="全部订阅" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">全部订阅</SelectItem>
          {subscriptionOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9">
            {authLabel} <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-2">
          <div className="flex flex-col gap-1">
            {AUTH_OPTIONS.map(opt => (
              <label key={opt.value} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer">
                <Checkbox checked={authMethods.includes(opt.value)} onCheckedChange={() => toggleAuth(opt.value)} />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索邮箱 / API Key 后四位 / 凭据 ID"
          className="h-9 pl-8"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">{rightSlot}</div>
    </div>
  )
}
```

- [ ] **Step 3: TypeScript 检查**

Run: `cd admin-ui && pnpm exec tsc -b`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add admin-ui/src/components/list-view/top-stats-bar.tsx admin-ui/src/components/list-view/filter-toolbar.tsx
git commit -m "feat(admin-ui): 新增 TopStatsBar + FilterToolbar 顶部统计与筛选"
```

---

## Task 15: BatchActionBar + AddCredentialSplitButton

**Files:**
- Create: `admin-ui/src/components/list-view/batch-action-bar.tsx`
- Create: `admin-ui/src/components/list-view/add-credential-split-button.tsx`

- [ ] **Step 1: 实现 BatchActionBar**

Create `admin-ui/src/components/list-view/batch-action-bar.tsx`:

```tsx
import { CheckCircle2, RefreshCw, MoreHorizontal, RotateCcw, Trash2, Eraser, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'

interface BatchActionBarProps {
  selectedCount: number
  selectedDisabledCount: number
  totalDisabledCount: number
  verifying: boolean
  verifyProgress: { current: number; total: number }
  batchRefreshing: boolean
  batchRefreshProgress: { current: number; total: number }
  queryingInfo: boolean
  queryInfoProgress: { current: number; total: number }
  onCancelSelection: () => void
  onBatchVerify: () => void
  onBatchForceRefresh: () => void
  onBatchResetFailure: () => void
  onBatchDelete: () => void
  onClearAllDisabled: () => void
  onQueryCurrentPage: () => void
}

export function BatchActionBar(props: BatchActionBarProps) {
  if (props.selectedCount === 0 && !props.verifying) return null

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900">
      {props.selectedCount > 0 && (
        <>
          <Badge variant="secondary">已选择 {props.selectedCount} 个</Badge>
          <Button onClick={props.onCancelSelection} size="sm" variant="ghost">取消选择</Button>
          <div className="h-5 w-px bg-blue-200 dark:bg-blue-800 mx-1" />

          <Button onClick={props.onBatchVerify} size="sm" variant="outline">
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />批量验活
          </Button>
          <Button
            onClick={props.onBatchForceRefresh}
            size="sm" variant="outline"
            disabled={props.batchRefreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${props.batchRefreshing ? 'animate-spin' : ''}`} />
            {props.batchRefreshing
              ? `刷新中 ${props.batchRefreshProgress.current}/${props.batchRefreshProgress.total}`
              : '批量刷新 Token'}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <MoreHorizontal className="h-3.5 w-3.5 mr-1.5" />更多
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={props.onBatchResetFailure}>
                <RotateCcw className="mr-2 h-4 w-4" /> 恢复异常
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={props.onBatchDelete}
                disabled={props.selectedDisabledCount === 0}
                className="text-red-600 focus:text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                批量删除（仅已禁用 {props.selectedDisabledCount}）
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={props.onClearAllDisabled}
                disabled={props.totalDisabledCount === 0}
                className="text-red-600 focus:text-red-600"
              >
                <Eraser className="mr-2 h-4 w-4" />
                清除所有已禁用 ({props.totalDisabledCount})
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={props.onQueryCurrentPage}
                disabled={props.queryingInfo}
              >
                <Search className="mr-2 h-4 w-4" />
                {props.queryingInfo
                  ? `查询中 ${props.queryInfoProgress.current}/${props.queryInfoProgress.total}`
                  : '查询当前页信息'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {props.verifying && props.selectedCount === 0 && (
        <Button size="sm" variant="secondary">
          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          验活中... {props.verifyProgress.current}/{props.verifyProgress.total}
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 实现 AddCredentialSplitButton**

Create `admin-ui/src/components/list-view/add-credential-split-button.tsx`:

```tsx
import { Plus, ChevronDown, Upload, FileUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

interface AddCredentialSplitButtonProps {
  onAdd: () => void
  onBatchImport: () => void
  onKamImport: () => void
}

export function AddCredentialSplitButton({ onAdd, onBatchImport, onKamImport }: AddCredentialSplitButtonProps) {
  return (
    <div className="inline-flex">
      <Button onClick={onAdd} size="sm" className="rounded-r-none">
        <Plus className="h-3.5 w-3.5 mr-1.5" />添加凭据
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="rounded-l-none border-l border-primary-foreground/30 px-2">
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={onAdd}>
            <Plus className="mr-2 h-4 w-4" /> 单条添加
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onBatchImport}>
            <Upload className="mr-2 h-4 w-4" /> 批量导入
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onKamImport}>
            <FileUp className="mr-2 h-4 w-4" /> Kiro Account Manager
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
```

- [ ] **Step 3: TypeScript 检查**

Run: `cd admin-ui && pnpm exec tsc -b`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add admin-ui/src/components/list-view/batch-action-bar.tsx admin-ui/src/components/list-view/add-credential-split-button.tsx
git commit -m "feat(admin-ui): 新增 BatchActionBar + AddCredentialSplitButton"
```

---

## Task 16: CredentialTable + MobileGuard

**Files:**
- Create: `admin-ui/src/components/list-view/credential-table.tsx`
- Create: `admin-ui/src/components/list-view/mobile-guard.tsx`

- [ ] **Step 1: 实现 MobileGuard**

Create `admin-ui/src/components/list-view/mobile-guard.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Monitor } from 'lucide-react'

const BREAKPOINT = 768

export function MobileGuard({ children }: { children: React.ReactNode }) {
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < BREAKPOINT
  )

  useEffect(() => {
    const handler = () => setIsNarrow(window.innerWidth < BREAKPOINT)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  if (isNarrow) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
        <Monitor className="h-12 w-12 text-gray-400 mb-4" />
        <h2 className="text-lg font-semibold mb-2">请在桌面端访问 Kiro Admin</h2>
        <p className="text-sm text-gray-500 max-w-xs">
          当前界面针对桌面端优化。窗口宽度 ≥ 768px 后将自动加载完整功能。
        </p>
      </div>
    )
  }

  return <>{children}</>
}
```

- [ ] **Step 2: 实现 CredentialTable**

Create `admin-ui/src/components/list-view/credential-table.tsx`:

```tsx
import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { CredentialStatusItem, BalanceResponse } from '@/types/api'
import type { SortKey, SortDir } from '@/lib/sort'
import { TableHeader } from './table-header'
import { CredentialRow } from './credential-row'
import { ExpandedRow } from './expanded-row'

interface CredentialTableProps {
  pageItems: CredentialStatusItem[]
  selectedIds: Set<number>
  onToggleSelect: (id: number) => void
  onToggleAllOnPage: () => void
  balances: Map<number, BalanceResponse>
  loadingBalances: Set<number>
  onViewBalance: (id: number) => void
  onQueryBalance: (id: number) => void
  sortKey: SortKey | null
  sortDir: SortDir
  onSortChange: (key: SortKey | null, dir: SortDir) => void
  filteredEmpty: boolean
  totalEmpty: boolean
  onClearFilters: () => void
  onAddCredential: () => void
}

export function CredentialTable({
  pageItems, selectedIds, onToggleSelect, onToggleAllOnPage,
  balances, loadingBalances, onViewBalance, onQueryBalance,
  sortKey, sortDir, onSortChange,
  filteredEmpty, totalEmpty, onClearFilters, onAddCredential,
}: CredentialTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const allSelected = pageItems.length > 0 && pageItems.every(c => selectedIds.has(c.id))
  const someSelected = !allSelected && pageItems.some(c => selectedIds.has(c.id))

  if (totalEmpty) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <p className="text-gray-500">暂无凭据</p>
          <Button onClick={onAddCredential} size="sm">添加凭据</Button>
        </CardContent>
      </Card>
    )
  }

  if (filteredEmpty) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <p className="text-gray-500">没有匹配的凭据</p>
          <Button onClick={onClearFilters} size="sm" variant="outline">清空筛选</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="rounded-lg border bg-white dark:bg-gray-950 dark:border-gray-800 overflow-hidden">
      <table className="w-full text-sm">
        <TableHeader
          sortKey={sortKey} sortDir={sortDir} onSortChange={onSortChange}
          allSelected={allSelected} someSelected={someSelected}
          onToggleAll={onToggleAllOnPage}
        />
        <tbody>
          {pageItems.flatMap(cred => {
            const rows: React.ReactNode[] = [
              <CredentialRow
                key={`r-${cred.id}`}
                cred={cred}
                balance={balances.get(cred.id) ?? null}
                loadingBalance={loadingBalances.has(cred.id)}
                selected={selectedIds.has(cred.id)}
                expanded={expandedIds.has(cred.id)}
                onToggleSelect={() => onToggleSelect(cred.id)}
                onToggleExpand={() => toggleExpand(cred.id)}
                onViewBalance={onViewBalance}
              />
            ]
            if (expandedIds.has(cred.id)) {
              rows.push(
                <ExpandedRow
                  key={`e-${cred.id}`}
                  cred={cred}
                  balance={balances.get(cred.id) ?? null}
                  loadingBalance={loadingBalances.has(cred.id)}
                  onQueryBalance={onQueryBalance}
                />
              )
            }
            return rows
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: TypeScript 检查**

Run: `cd admin-ui && pnpm exec tsc -b`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add admin-ui/src/components/list-view/credential-table.tsx admin-ui/src/components/list-view/mobile-guard.tsx
git commit -m "feat(admin-ui): 新增 CredentialTable 主表 + MobileGuard 移动端守卫"
```

---

## Task 17: 重写 Dashboard（主集成）+ 删除 credential-card.tsx

**Files:**
- Modify (rewrite body): `admin-ui/src/components/dashboard.tsx`
- Delete: `admin-ui/src/components/credential-card.tsx`

> 这是最大的一个 Task。它把所有前面创建的组件粘合起来，并把原 dashboard 中遗留的批量验活/批量刷新等 handler 完整迁移过来。

- [ ] **Step 1: 用以下内容完整覆写 `admin-ui/src/components/dashboard.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { LogOut, Moon, Sun, Server, RefreshCw } from 'lucide-react'
import { storage } from '@/lib/storage'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BalanceDialog } from '@/components/balance-dialog'
import { AddCredentialDialog } from '@/components/add-credential-dialog'
import { BatchImportDialog } from '@/components/batch-import-dialog'
import { KamImportDialog } from '@/components/kam-import-dialog'
import { BatchVerifyDialog, type VerifyResult } from '@/components/batch-verify-dialog'
import {
  useCredentials, useDeleteCredential, useResetFailure,
  useLoadBalancingMode, useSetLoadBalancingMode,
} from '@/hooks/use-credentials'
import { useUrlState } from '@/hooks/use-url-state'
import { getCredentialBalance, forceRefreshToken } from '@/api/credentials'
import { extractErrorMessage } from '@/lib/utils'
import { deriveStatus } from '@/lib/derive'
import { applyFilters, applySearch } from '@/lib/filter'
import { applySort } from '@/lib/sort'
import type { BalanceResponse } from '@/types/api'

import { MobileGuard } from './list-view/mobile-guard'
import { TopStatsBar } from './list-view/top-stats-bar'
import { FilterToolbar } from './list-view/filter-toolbar'
import { BatchActionBar } from './list-view/batch-action-bar'
import { CredentialTable } from './list-view/credential-table'
import { TablePagination } from './list-view/table-pagination'
import { AddCredentialSplitButton } from './list-view/add-credential-split-button'

interface DashboardProps {
  onLogout: () => void
}

export function Dashboard({ onLogout }: DashboardProps) {
  const queryClient = useQueryClient()
  const { data, isLoading, error, refetch } = useCredentials()
  const { mutate: deleteCredential } = useDeleteCredential()
  const { mutate: resetFailure } = useResetFailure()
  const { data: lbData, isLoading: lbLoading } = useLoadBalancingMode()
  const { mutate: setLbMode, isPending: lbSetting } = useSetLoadBalancingMode()

  const [urlState, setUrlState] = useUrlState()

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [balanceMap, setBalanceMap] = useState<Map<number, BalanceResponse>>(new Map())
  const [loadingBalanceIds, setLoadingBalanceIds] = useState<Set<number>>(new Set())

  const [balanceDialogOpen, setBalanceDialogOpen] = useState(false)
  const [balanceDialogId, setBalanceDialogId] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [batchImportOpen, setBatchImportOpen] = useState(false)
  const [kamOpen, setKamOpen] = useState(false)

  const [verifyOpen, setVerifyOpen] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyProgress, setVerifyProgress] = useState({ current: 0, total: 0 })
  const [verifyResults, setVerifyResults] = useState<Map<number, VerifyResult>>(new Map())
  const cancelVerifyRef = useRef(false)
  const [batchRefreshing, setBatchRefreshing] = useState(false)
  const [batchRefreshProgress, setBatchRefreshProgress] = useState({ current: 0, total: 0 })
  const [queryingInfo, setQueryingInfo] = useState(false)
  const [queryInfoProgress, setQueryInfoProgress] = useState({ current: 0, total: 0 })

  const [darkMode, setDarkMode] = useState(() =>
    typeof window !== 'undefined' && document.documentElement.classList.contains('dark')
  )
  const toggleDarkMode = () => {
    setDarkMode(d => !d)
    document.documentElement.classList.toggle('dark')
  }

  // 同步 balanceMap：列表变化时丢弃已删除凭据的缓存
  useEffect(() => {
    if (!data?.credentials) {
      setBalanceMap(new Map()); setLoadingBalanceIds(new Set()); return
    }
    const valid = new Set(data.credentials.map(c => c.id))
    setBalanceMap(prev => {
      const next = new Map<number, BalanceResponse>()
      prev.forEach((v, id) => { if (valid.has(id)) next.set(id, v) })
      return next.size === prev.size ? prev : next
    })
    setLoadingBalanceIds(prev => {
      if (prev.size === 0) return prev
      const next = new Set<number>()
      prev.forEach(id => { if (valid.has(id)) next.add(id) })
      return next.size === prev.size ? prev : next
    })
  }, [data?.credentials])

  // 派生数据流
  const credentials = data?.credentials ?? []
  const getBalance = (id: number) => balanceMap.get(id) ?? null

  const subscriptionOptions = useMemo(() => {
    const set = new Set<string>()
    balanceMap.forEach(b => { if (b.subscriptionTitle) set.add(b.subscriptionTitle) })
    return Array.from(set).sort()
  }, [balanceMap])

  const filtered = useMemo(() => {
    const f = applyFilters(credentials, {
      status: urlState.status,
      subscription: urlState.subscription,
      authMethods: urlState.authMethods,
    }, getBalance)
    const s = applySearch(f, urlState.q)
    return applySort(s, urlState.sort, urlState.dir, getBalance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials, urlState, balanceMap])

  const totalPages = Math.max(1, Math.ceil(filtered.length / urlState.size))
  const safePage = Math.min(Math.max(1, urlState.page), totalPages)
  // 当前页越界时矫正 URL
  useEffect(() => {
    if (urlState.page !== safePage) setUrlState({ page: safePage })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage])

  const pageItems = filtered.slice((safePage - 1) * urlState.size, safePage * urlState.size)

  const counts = useMemo(() => {
    let normal = 0, throttled = 0, error = 0
    for (const c of credentials) {
      const s = deriveStatus(c)
      if (s === 'normal') normal++
      else if (s === 'throttled') throttled++
      else error++
    }
    return { normal, throttled, error }
  }, [credentials])

  const totalDisabledCount = credentials.filter(c => c.disabled).length
  const selectedDisabledCount = credentials
    .filter(c => selectedIds.has(c.id) && c.disabled).length

  // 选中跨页：仅对当前筛选可见的选中项执行批量
  const visibleSelectedIds = filtered.filter(c => selectedIds.has(c.id)).map(c => c.id)

  // 选中操作
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const toggleAllOnPage = () => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      const allOn = pageItems.every(c => next.has(c.id))
      pageItems.forEach(c => { if (allOn) next.delete(c.id); else next.add(c.id) })
      return next
    })
  }
  const cancelSelection = () => setSelectedIds(new Set())

  const handleViewBalance = (id: number) => { setBalanceDialogId(id); setBalanceDialogOpen(true) }

  // ⬇️ 业务 handler 见 Step 2
  // <PLAN_DASHBOARD_HANDLERS />

  // ⬇️ render 见 Step 3
  // <PLAN_DASHBOARD_RENDER />
  return null
}
```

> 注：Step 1 暂时让 `Dashboard` 返回 `null`，下面 Step 2 与 Step 3 会替换占位符注释成真实代码。这样每步都能跑 tsc 但不至于一次塞太多代码。

- [ ] **Step 2: 在 dashboard.tsx 中把 `// <PLAN_DASHBOARD_HANDLERS />` 替换为以下 handler 块**

```tsx
  // —— 单条余额查询（展开行 / 立即查询用） ——
  const handleQueryOne = async (id: number) => {
    setLoadingBalanceIds(prev => { const n = new Set(prev); n.add(id); return n })
    try {
      const balance = await getCredentialBalance(id)
      setBalanceMap(prev => { const n = new Map(prev); n.set(id, balance); return n })
    } catch (e) {
      toast.error('查询余额失败：' + extractErrorMessage(e))
    } finally {
      setLoadingBalanceIds(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  // —— 当前页查询信息 ——
  const handleQueryCurrentPageInfo = async () => {
    const ids = pageItems.filter(c => !c.disabled).map(c => c.id)
    if (ids.length === 0) { toast.error('当前页没有可查询的启用凭据'); return }

    setQueryingInfo(true); setQueryInfoProgress({ current: 0, total: ids.length })
    let success = 0, fail = 0

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      setLoadingBalanceIds(prev => { const n = new Set(prev); n.add(id); return n })
      try {
        const balance = await getCredentialBalance(id)
        success++
        setBalanceMap(prev => { const n = new Map(prev); n.set(id, balance); return n })
      } catch { fail++ } finally {
        setLoadingBalanceIds(prev => { const n = new Set(prev); n.delete(id); return n })
      }
      setQueryInfoProgress({ current: i + 1, total: ids.length })
    }

    setQueryingInfo(false)
    if (fail === 0) toast.success(`查询完成：${success}/${ids.length}`)
    else toast.warning(`查询完成：成功 ${success}，失败 ${fail}`)
  }

  // —— 批量验活 ——
  const handleBatchVerify = async () => {
    const ids = visibleSelectedIds
    if (ids.length === 0) { toast.error('请先选择要验活的凭据'); return }

    setVerifying(true); cancelVerifyRef.current = false
    setVerifyProgress({ current: 0, total: ids.length })
    const init = new Map<number, VerifyResult>()
    ids.forEach(id => init.set(id, { id, status: 'pending' }))
    setVerifyResults(init); setVerifyOpen(true)

    let success = 0
    for (let i = 0; i < ids.length; i++) {
      if (cancelVerifyRef.current) { toast.info('已取消验活'); break }
      const id = ids[i]
      setVerifyResults(prev => { const n = new Map(prev); n.set(id, { id, status: 'verifying' }); return n })
      try {
        const balance = await getCredentialBalance(id)
        success++
        setVerifyResults(prev => { const n = new Map(prev); n.set(id, { id, status: 'success', usage: `${balance.currentUsage}/${balance.usageLimit}` }); return n })
      } catch (e) {
        setVerifyResults(prev => { const n = new Map(prev); n.set(id, { id, status: 'failed', error: extractErrorMessage(e) }); return n })
      }
      setVerifyProgress({ current: i + 1, total: ids.length })
      if (i < ids.length - 1 && !cancelVerifyRef.current) {
        await new Promise(r => setTimeout(r, 2000))
      }
    }

    setVerifying(false)
    if (!cancelVerifyRef.current) toast.success(`验活完成：${success}/${ids.length}`)
  }
  const handleCancelVerify = () => { cancelVerifyRef.current = true; setVerifying(false) }

  // —— 批量刷新 Token ——
  const handleBatchForceRefresh = async () => {
    const ids = visibleSelectedIds.filter(id => {
      const c = credentials.find(x => x.id === id)
      return c && !c.disabled && c.authMethod !== 'api_key'
    })
    if (ids.length === 0) { toast.error('选中的凭据中没有可刷新的'); return }

    setBatchRefreshing(true); setBatchRefreshProgress({ current: 0, total: ids.length })
    let success = 0, fail = 0
    for (let i = 0; i < ids.length; i++) {
      try { await forceRefreshToken(ids[i]); success++ } catch { fail++ }
      setBatchRefreshProgress({ current: i + 1, total: ids.length })
    }
    setBatchRefreshing(false)
    queryClient.invalidateQueries({ queryKey: ['credentials'] })
    if (fail === 0) toast.success(`成功刷新 ${success} 个 Token`)
    else toast.warning(`刷新 Token：成功 ${success}，失败 ${fail}`)
    cancelSelection()
  }

  // —— 批量恢复异常 ——
  const handleBatchResetFailure = async () => {
    const ids = visibleSelectedIds.filter(id => {
      const c = credentials.find(x => x.id === id)
      return c && (c.failureCount > 0 || c.refreshFailureCount > 0)
    })
    if (ids.length === 0) { toast.error('选中的凭据中没有失败计数 > 0 的凭据'); return }

    let success = 0, fail = 0
    for (const id of ids) {
      try {
        await new Promise<void>((res, rej) =>
          resetFailure(id, { onSuccess: () => { success++; res() }, onError: (e) => { fail++; rej(e) } })
        )
      } catch {/* already counted */}
    }
    if (fail === 0) toast.success(`成功恢复 ${success} 个凭据`)
    else toast.warning(`成功 ${success}，失败 ${fail}`)
    cancelSelection()
  }

  // —— 批量删除（仅已禁用） ——
  const handleBatchDelete = async () => {
    const ids = visibleSelectedIds.filter(id => credentials.find(x => x.id === id)?.disabled)
    if (ids.length === 0) { toast.error('选中的凭据中没有已禁用项'); return }
    const skipped = visibleSelectedIds.length - ids.length
    if (!confirm(`确定删除 ${ids.length} 个已禁用凭据？此操作无法撤销。${skipped > 0 ? `（跳过 ${skipped} 个未禁用）` : ''}`)) return

    let success = 0, fail = 0
    for (const id of ids) {
      try {
        await new Promise<void>((res, rej) =>
          deleteCredential(id, { onSuccess: () => { success++; res() }, onError: (e) => { fail++; rej(e) } })
        )
      } catch {/* already counted */}
    }
    if (fail === 0) toast.success(`成功删除 ${success} 个已禁用凭据`)
    else toast.warning(`成功 ${success}，失败 ${fail}`)
    cancelSelection()
  }

  // —— 一键清除所有已禁用 ——
  const handleClearAllDisabled = async () => {
    const ids = credentials.filter(c => c.disabled).map(c => c.id)
    if (ids.length === 0) { toast.error('没有可清除的已禁用凭据'); return }
    if (!confirm(`确定清除全部 ${ids.length} 个已禁用凭据？此操作无法撤销。`)) return

    let success = 0, fail = 0
    for (const id of ids) {
      try {
        await new Promise<void>((res, rej) =>
          deleteCredential(id, { onSuccess: () => { success++; res() }, onError: (e) => { fail++; rej(e) } })
        )
      } catch {/* already counted */}
    }
    if (fail === 0) toast.success(`成功清除 ${success} 个已禁用凭据`)
    else toast.warning(`成功 ${success}，失败 ${fail}`)
    cancelSelection()
  }

  // —— 顶部其它操作 ——
  const handleRefresh = () => { refetch(); toast.success('已刷新凭据列表') }
  const handleLogout = () => { storage.removeApiKey(); queryClient.clear(); onLogout() }
  const handleToggleLb = () => {
    const cur = lbData?.mode || 'priority'
    const next = cur === 'priority' ? 'balanced' : 'priority'
    setLbMode(next, {
      onSuccess: () => toast.success(`已切换到${next === 'priority' ? '优先级模式' : '均衡负载模式'}`),
      onError: (e) => toast.error('切换失败：' + extractErrorMessage(e)),
    })
  }
  const handleClearFilters = () =>
    setUrlState({ status: 'all', subscription: '', authMethods: [], q: '', sort: null, dir: 'desc', page: 1 })
```

- [ ] **Step 3: 在 dashboard.tsx 中把 `return null` 与 `// <PLAN_DASHBOARD_RENDER />` 替换为下面的 render 块**

```tsx
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-gray-500">加载中...</p>
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="text-red-500 mb-4">加载失败</div>
            <p className="text-gray-500 mb-4">{(error as Error).message}</p>
            <div className="space-x-2">
              <Button onClick={() => refetch()}>重试</Button>
              <Button variant="outline" onClick={handleLogout}>重新登录</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <MobileGuard>
      <TooltipProvider delayDuration={300}>
        <div className="min-h-screen bg-background">
          <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container flex h-14 items-center justify-between px-4 md:px-8">
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                <span className="font-semibold">Kiro Admin</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline" size="sm"
                  onClick={handleToggleLb}
                  disabled={lbLoading || lbSetting}
                  title="切换负载均衡模式"
                >
                  {lbLoading ? '加载中...' : (lbData?.mode === 'priority' ? '优先级模式' : '均衡负载')}
                </Button>
                <Button variant="ghost" size="icon" onClick={toggleDarkMode}>
                  {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                </Button>
                <Button variant="ghost" size="icon" onClick={handleRefresh}>
                  <RefreshCw className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={handleLogout}>
                  <LogOut className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </header>

          <main className="container mx-auto px-4 md:px-8 py-5">
            <TopStatsBar
              total={credentials.length}
              normal={counts.normal}
              throttled={counts.throttled}
              error={counts.error}
              selected={selectedIds.size}
              activeStatus={urlState.status}
              onStatusClick={(s) => setUrlState({ status: s })}
            />

            <FilterToolbar
              status={urlState.status}
              onStatusChange={(s) => setUrlState({ status: s })}
              subscription={urlState.subscription}
              subscriptionOptions={subscriptionOptions}
              onSubscriptionChange={(s) => setUrlState({ subscription: s })}
              authMethods={urlState.authMethods}
              onAuthMethodsChange={(m) => setUrlState({ authMethods: m })}
              query={urlState.q}
              onQueryChange={(q) => setUrlState({ q })}
              rightSlot={
                <AddCredentialSplitButton
                  onAdd={() => setAddOpen(true)}
                  onBatchImport={() => setBatchImportOpen(true)}
                  onKamImport={() => setKamOpen(true)}
                />
              }
            />

            <BatchActionBar
              selectedCount={selectedIds.size}
              selectedDisabledCount={selectedDisabledCount}
              totalDisabledCount={totalDisabledCount}
              verifying={verifying}
              verifyProgress={verifyProgress}
              batchRefreshing={batchRefreshing}
              batchRefreshProgress={batchRefreshProgress}
              queryingInfo={queryingInfo}
              queryInfoProgress={queryInfoProgress}
              onCancelSelection={cancelSelection}
              onBatchVerify={handleBatchVerify}
              onBatchForceRefresh={handleBatchForceRefresh}
              onBatchResetFailure={handleBatchResetFailure}
              onBatchDelete={handleBatchDelete}
              onClearAllDisabled={handleClearAllDisabled}
              onQueryCurrentPage={handleQueryCurrentPageInfo}
            />

            <CredentialTable
              pageItems={pageItems}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleAllOnPage={toggleAllOnPage}
              balances={balanceMap}
              loadingBalances={loadingBalanceIds}
              onViewBalance={handleViewBalance}
              onQueryBalance={handleQueryOne}
              sortKey={urlState.sort}
              sortDir={urlState.dir}
              onSortChange={(k, d) => setUrlState({ sort: k, dir: d })}
              filteredEmpty={credentials.length > 0 && filtered.length === 0}
              totalEmpty={credentials.length === 0}
              onClearFilters={handleClearFilters}
              onAddCredential={() => setAddOpen(true)}
            />

            {filtered.length > 0 && (
              <TablePagination
                total={filtered.length}
                page={safePage}
                size={urlState.size}
                onPageChange={(p) => setUrlState({ page: p })}
                onSizeChange={(s) => setUrlState({ size: s })}
              />
            )}
          </main>

          <BalanceDialog
            credentialId={balanceDialogId}
            open={balanceDialogOpen}
            onOpenChange={setBalanceDialogOpen}
          />
          <AddCredentialDialog open={addOpen} onOpenChange={setAddOpen} />
          <BatchImportDialog open={batchImportOpen} onOpenChange={setBatchImportOpen} />
          <KamImportDialog open={kamOpen} onOpenChange={setKamOpen} />
          <BatchVerifyDialog
            open={verifyOpen}
            onOpenChange={setVerifyOpen}
            verifying={verifying}
            progress={verifyProgress}
            results={verifyResults}
            onCancel={handleCancelVerify}
          />
        </div>
      </TooltipProvider>
    </MobileGuard>
  )
```

- [ ] **Step 4: 删除卡片视图组件**

```bash
rm admin-ui/src/components/credential-card.tsx
```

- [ ] **Step 5: TypeScript + 构建检查**

```bash
cd admin-ui && pnpm exec tsc -b && pnpm build
```

Expected: 构建成功，dist 目录生成

- [ ] **Step 6: 启动 dev server 做手动验证**

```bash
cd admin-ui && pnpm dev
```

访问 http://localhost:5173 (或 vite 实际打印的端口)，登录后核对：

1. **基础渲染**：列表替代卡片网格，TopStatsBar 5 个 chip 出现
2. **状态判定**：正常/限速/异常徽章符合 spec 6.1 规则
3. **进度条**：未查询=灰、< 80% 绿、80-99% 黄、超额=斜纹
4. **筛选**：点状态 chip / tab 即时过滤
5. **搜索**：输入邮箱片段、ID、API Key 末 4 字符均能命中
6. **排序**：点 4 个可排序表头能切换 desc/asc/none
7. **URL 同步**：刷新浏览器后筛选/排序/分页保留
8. **行展开**：点 ▸ 展开详情面板，可同时展开多行
9. **优先级编辑**：点数字 → 输入框 → ✓ 提交
10. **批量操作**：选中 ≥ 1 时浮出 BatchActionBar，验活进度按钮工作
11. **添加凭据分裂按钮**：可分别打开 add / batch-import / kam 三个对话框
12. **暗色模式**：切换后所有色值仍清晰
13. **移动端**：浏览器宽度 < 768px 显示桌面提示

发现的视觉/交互问题就地修复，每修一个问题做一次 commit。

- [ ] **Step 7: Commit**

```bash
git add admin-ui/src/components/dashboard.tsx
git rm admin-ui/src/components/credential-card.tsx
git commit -m "feat(admin-ui): 重写 Dashboard 为列表视图，删除卡片视图"
```

---

## Task 18: 全量验证 + 收尾

**Files:**
- 无新增

- [ ] **Step 1: 跑完整测试套件**

```bash
cd admin-ui && pnpm test
```

Expected: derive / filter / sort 三组测试全部 PASS（共 30+ 用例）

- [ ] **Step 2: 跑完整生产构建**

```bash
cd admin-ui && pnpm build
```

Expected: 构建成功，无 TypeScript 错误，无 vite 警告

- [ ] **Step 3: 在 dev server 上完成手动验证清单（spec 12.3 节）**

访问 http://localhost:5173 完成：

1. [ ] 凭据数 0 / 1 / 50 / 200 时分别打开看是否正常（用浏览器开发者工具 mock 网络也可）
2. [ ] 切换状态 tab、订阅、认证筛选时，TopStatsBar 数字保持稳定（统计基于全量，不随筛选变化）
3. [ ] 筛选 + 翻页 + 排序后刷新浏览器，URL 中状态保留
4. [ ] 选中 3 个凭据后切换页 / 切换筛选，点批量验活时只对当前可见的选中项生效
5. [ ] 暗色模式下进度条 5 段配色（含超额）仍清晰
6. [ ] 把浏览器窗口缩到 700px 宽，验证 MobileGuard 出现
7. [ ] 浏览器后退/前进按钮：URL 状态变更应触发列表更新（popstate 监听生效）
8. [ ] 表头排序循环：unsorted → desc → asc → unsorted

发现问题修一个，commit 一个。

- [ ] **Step 4: 检查无遗留**

```bash
cd admin-ui
grep -rn "credential-card" src/
grep -rn "from '@/components/credential-card'" src/
```

Expected: 两条命令均无输出（确保无残留 import）

- [ ] **Step 5: 最后一次提交（如有未提交的修复）+ 推送**

```bash
git status
# 如有 uncommitted 改动：
git add -A
git commit -m "polish(admin-ui): 列表视图改造收尾修复"
```

> 是否推送 / 开 PR 由用户决定，本计划不自动 push。

---

## Self-Review

实施完毕的成功标志：

- 所有 18 个 Task 的 commit 均已落地
- `admin-ui/src/components/credential-card.tsx` 已删除
- `pnpm test` 全绿（≥ 30 个派生层用例）
- `pnpm build` 成功
- 手动验证清单全部 ✅
- URL 同步生效（刷新后筛选保留）
- 暗色模式所有状态清晰
- 移动端守卫工作

---

## 附录 A：spec 覆盖映射

| spec 章节 | 实现位置 |
|---|---|
| 2.1 状态判定 | Task 1（`deriveStatus`） |
| 2.2 用量进度条 | Task 2（`deriveUsageSegment`）+ Task 7（UsageProgress） |
| 2.3 超额展示 | Task 7（UsageProgress 的 overflow 分支） |
| 2.4 详情展开 | Task 11（ExpandedRow）+ Task 16（CredentialTable 装配） |
| 2.5 主表 11 列 | Task 12（CredentialRow 与 TableHeader） |
| 2.6 单行操作密度 | Task 10（RowActions） |
| 2.7 优先级编辑 | Task 9（InlinePriorityEdit） |
| 2.8 顶部工具栏批量按钮 | Task 15（BatchActionBar / AddCredentialSplitButton） |
| 2.9 筛选/搜索/排序 | Task 3 + 4 + 5 + 14（FilterToolbar）+ 12（TableHeader） |
| 2.10 分页 | Task 13（TablePagination） |
| 2.11 顶部统计 chip | Task 14（TopStatsBar） |
| 2.12 移动端 | Task 16（MobileGuard） |
| 2.13 卡片视图删除 | Task 17 Step 4 |
| 5.1 URL 同步 | Task 5（useUrlState） |
| 5.5 行展开 | Task 11 + Task 16（CredentialTable expandedIds） |
| 5.6 选中跨页 | Task 17（visibleSelectedIds 过滤） |
| 5.8 移动端守卫 | Task 16（MobileGuard） |
| 6.1 状态派生 | Task 1 |
| 6.2 用量段派生 | Task 2 |
| 10.2 边界（filtered empty / total empty） | Task 16（CredentialTable 空态） |
| 12 测试 | Task 0 + 1-4（vitest 单测） |




