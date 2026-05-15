import { useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Wallet, MoreHorizontal, ChevronUp, ChevronDown, Trash2, Loader2, RotateCcw } from 'lucide-react'
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
  loadingBalance: boolean
  onRefreshBalance: (id: number) => void
}

export function RowActions({ cred, loadingBalance, onRefreshBalance }: RowActionsProps) {
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

  const handleRefreshToken = () => refresh.mutate(cred.id, {
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
              onClick={handleRefreshToken} disabled={refreshDisabled}
              aria-label="刷新 Token"
              aria-busy={refresh.isPending}
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
              onClick={() => onRefreshBalance(cred.id)}
              disabled={loadingBalance || cred.disabled}
              aria-label="刷新余额"
              aria-busy={loadingBalance}
            >
              {loadingBalance
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Wallet className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{cred.disabled ? '已禁用的凭据无法刷新余额' : '刷新余额'}</TooltipContent>
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
