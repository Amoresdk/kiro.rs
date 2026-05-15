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
