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
  onRefreshBalance: (id: number) => void
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
  balances, loadingBalances, onRefreshBalance,
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
                onRefreshBalance={onRefreshBalance}
              />
            ]
            if (expandedIds.has(cred.id)) {
              rows.push(
                <ExpandedRow
                  key={`e-${cred.id}`}
                  cred={cred}
                  balance={balances.get(cred.id) ?? null}
                  loadingBalance={loadingBalances.has(cred.id)}
                  onQueryBalance={onRefreshBalance}
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
