import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSetPriority } from '@/hooks/use-credentials'
import { extractErrorMessage } from '@/lib/utils'

interface InlinePriorityEditProps {
  id: number
  value: number
}

export function InlinePriorityEdit({ id, value }: InlinePriorityEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const setPriority = useSetPriority()

  const submit = () => {
    const n = parseInt(draft, 10)
    if (isNaN(n) || n < 0) {
      toast.error('优先级必须是非负整数')
      return
    }
    setPriority.mutate(
      { id, priority: n },
      {
        onSuccess: () => { toast.success('已更新优先级'); setEditing(false) },
        onError: (e) => toast.error('更新失败：' + extractErrorMessage(e)),
      }
    )
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="hover:underline font-medium"
        onClick={() => { setDraft(String(value)); setEditing(true) }}
        title="点击编辑"
      >
        {value}
      </button>
    )
  }

  return (
    <div className="inline-flex items-center gap-1">
      <Input
        type="number"
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-7 w-14 text-sm"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') { setEditing(false); setDraft(String(value)) }
        }}
      />
      <Button
        size="sm" variant="ghost" className="h-7 w-7 p-0"
        onClick={submit} disabled={setPriority.isPending}
      >✓</Button>
      <Button
        size="sm" variant="ghost" className="h-7 w-7 p-0"
        onClick={() => { setEditing(false); setDraft(String(value)) }}
      >✕</Button>
    </div>
  )
}
