import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

interface TablePaginationProps {
  total: number
  page: number
  size: 50 | 100 | 200
  onPageChange: (page: number) => void
  onSizeChange: (size: 50 | 100 | 200) => void
}

export function TablePagination({ total, page, size, onPageChange, onSizeChange }: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / size))
  const safePage = Math.min(Math.max(1, page), totalPages)

  // 紧凑分页：始终显示首末页 + 当前页 ±1
  const pages: (number | '...')[] = []
  const add = (n: number | '...') => { if (pages[pages.length - 1] !== n) pages.push(n) }
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - safePage) <= 1) add(i)
    else add('...')
  }

  return (
    <div className="flex items-center justify-between py-3 px-4 text-sm">
      <div className="flex items-center gap-3 text-gray-500">
        <span>每页</span>
        <Select value={String(size)} onValueChange={(v) => onSizeChange(Number(v) as 50 | 100 | 200)}>
          <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="50">50</SelectItem>
            <SelectItem value="100">100</SelectItem>
            <SelectItem value="200">200</SelectItem>
          </SelectContent>
        </Select>
        <span>条 · 共 {total} 条</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm" variant="outline" className="h-8 w-8 p-0"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage === 1}
          aria-label="上一页"
        ><ChevronLeft className="h-4 w-4" /></Button>
        {pages.map((p, idx) =>
          p === '...' ? (
            <span key={`d-${idx}`} className="px-2 text-gray-400">…</span>
          ) : (
            <Button
              key={p}
              size="sm"
              variant={p === safePage ? 'default' : 'outline'}
              className="h-8 min-w-8 px-2"
              onClick={() => onPageChange(p)}
            >{p}</Button>
          )
        )}
        <Button
          size="sm" variant="outline" className="h-8 w-8 p-0"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          aria-label="下一页"
        ><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  )
}
