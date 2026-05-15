import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { LogOut, Moon, Sun, Server, RefreshCw } from 'lucide-react'
import { storage } from '@/lib/storage'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { TooltipProvider } from '@/components/ui/tooltip'
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
  const [batchBalanceRefreshing, setBatchBalanceRefreshing] = useState(false)
  const [batchBalanceProgress, setBatchBalanceProgress] = useState({ current: 0, total: 0 })

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

  // —— 单条余额刷新（行内 Wallet 图标 / 展开行立即查询） ——
  const handleQueryOne = async (id: number) => {
    setLoadingBalanceIds(prev => { const n = new Set(prev); n.add(id); return n })
    try {
      const balance = await getCredentialBalance(id)
      setBalanceMap(prev => { const n = new Map(prev); n.set(id, balance); return n })
    } catch (e) {
      toast.error('刷新余额失败：' + extractErrorMessage(e))
    } finally {
      setLoadingBalanceIds(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  // —— 批量刷新余额（按选中范围；仅启用凭据） ——
  const handleBatchRefreshBalance = async () => {
    const ids = visibleSelectedIds.filter(id => {
      const c = credentials.find(x => x.id === id)
      return c && !c.disabled
    })
    if (ids.length === 0) { toast.error('选中的凭据中没有可刷新余额的凭据'); return }

    setBatchBalanceRefreshing(true); setBatchBalanceProgress({ current: 0, total: ids.length })
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
      setBatchBalanceProgress({ current: i + 1, total: ids.length })
    }

    setBatchBalanceRefreshing(false)
    if (fail === 0) toast.success(`余额刷新完成：${success}/${ids.length}`)
    else toast.warning(`余额刷新完成：成功 ${success}，失败 ${fail}`)
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
              batchBalanceRefreshing={batchBalanceRefreshing}
              batchBalanceProgress={batchBalanceProgress}
              onCancelSelection={cancelSelection}
              onBatchVerify={handleBatchVerify}
              onBatchForceRefresh={handleBatchForceRefresh}
              onBatchRefreshBalance={handleBatchRefreshBalance}
              onBatchResetFailure={handleBatchResetFailure}
              onBatchDelete={handleBatchDelete}
              onClearAllDisabled={handleClearAllDisabled}
            />

            <CredentialTable
              pageItems={pageItems}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleAllOnPage={toggleAllOnPage}
              balances={balanceMap}
              loadingBalances={loadingBalanceIds}
              onRefreshBalance={handleQueryOne}
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
}
