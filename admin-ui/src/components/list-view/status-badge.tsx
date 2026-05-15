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
