import { Search, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'

interface FilterToolbarProps {
  status: 'all' | 'normal' | 'throttled' | 'error'
  onStatusChange: (s: 'all' | 'normal' | 'throttled' | 'error') => void
  subscription: string
  subscriptionOptions: string[]
  onSubscriptionChange: (s: string) => void
  authMethods: string[]
  onAuthMethodsChange: (m: string[]) => void
  query: string
  onQueryChange: (q: string) => void
  rightSlot?: React.ReactNode
}

const AUTH_OPTIONS: { value: string; label: string }[] = [
  { value: 'social', label: 'Social' },
  { value: 'idc', label: 'IdC' },
  { value: 'api_key', label: 'API Key' },
]

export function FilterToolbar({
  status, onStatusChange,
  subscription, subscriptionOptions, onSubscriptionChange,
  authMethods, onAuthMethodsChange,
  query, onQueryChange,
  rightSlot,
}: FilterToolbarProps) {
  const toggleAuth = (v: string) => {
    onAuthMethodsChange(authMethods.includes(v) ? authMethods.filter(x => x !== v) : [...authMethods, v])
  }

  const authLabel = authMethods.length === 0
    ? '全部认证'
    : authMethods.length === AUTH_OPTIONS.length
      ? '全部认证'
      : `认证 (${authMethods.length})`

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <Tabs value={status} onValueChange={(v) => onStatusChange(v as 'all' | 'normal' | 'throttled' | 'error')}>
        <TabsList>
          <TabsTrigger value="all">全部</TabsTrigger>
          <TabsTrigger value="normal">正常</TabsTrigger>
          <TabsTrigger value="throttled">限速</TabsTrigger>
          <TabsTrigger value="error">异常</TabsTrigger>
        </TabsList>
      </Tabs>

      <Select value={subscription || '__all__'} onValueChange={(v) => onSubscriptionChange(v === '__all__' ? '' : v)}>
        <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="全部订阅" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">全部订阅</SelectItem>
          {subscriptionOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9">
            {authLabel} <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-2">
          <div className="flex flex-col gap-1">
            {AUTH_OPTIONS.map(opt => (
              <label key={opt.value} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer">
                <Checkbox checked={authMethods.includes(opt.value)} onCheckedChange={() => toggleAuth(opt.value)} />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索邮箱 / API Key 后四位 / 凭据 ID"
          className="h-9 pl-8"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">{rightSlot}</div>
    </div>
  )
}
