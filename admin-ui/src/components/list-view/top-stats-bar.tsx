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
