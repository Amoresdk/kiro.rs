import { Plus, ChevronDown, Upload, FileUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

interface AddCredentialSplitButtonProps {
  onAdd: () => void
  onBatchImport: () => void
  onKamImport: () => void
}

export function AddCredentialSplitButton({ onAdd, onBatchImport, onKamImport }: AddCredentialSplitButtonProps) {
  return (
    <div className="inline-flex">
      <Button onClick={onAdd} size="sm" className="rounded-r-none">
        <Plus className="h-3.5 w-3.5 mr-1.5" />添加凭据
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="rounded-l-none border-l border-primary-foreground/30 px-2">
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={onAdd}>
            <Plus className="mr-2 h-4 w-4" /> 单条添加
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onBatchImport}>
            <Upload className="mr-2 h-4 w-4" /> 批量导入
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onKamImport}>
            <FileUp className="mr-2 h-4 w-4" /> Kiro Account Manager
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
