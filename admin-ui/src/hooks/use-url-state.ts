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
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 ? n : 1
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
