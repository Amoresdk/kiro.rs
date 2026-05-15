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
