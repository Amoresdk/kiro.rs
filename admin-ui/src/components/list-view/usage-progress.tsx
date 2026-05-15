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
