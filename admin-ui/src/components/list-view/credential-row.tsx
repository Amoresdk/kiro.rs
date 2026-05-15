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
