import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CredentialStatusItem, BalanceResponse } from '@/types/api'
import { formatDate, formatRelativeFuture } from '@/lib/utils'

interface ExpandedRowProps {
  cred: CredentialStatusItem
  balance: BalanceResponse | null
  loadingBalance: boolean
  onQueryBalance: (id: number) => void
}

const AUTH_LABEL: Record<string, string> = {
  social: 'Social',
  idc: 'IdC',
  api_key: 'API Key',
}

export function ExpandedRow({ cred, balance, loadingBalance, onQueryBalance }: ExpandedRowProps) {
  return (
    <tr className="bg-gray-50 dark:bg-gray-900/40">
      <td colSpan={12} className="p-0">
        <div className="ml-[70px] mr-4 my-3 rounded-lg border bg-white dark:bg-gray-950 dark:border-gray-800 p-4">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <Field label="凭据 ID"><span className="font-mono">#{cred.id}</span></Field>
            <Field label="认证方式">
              {cred.authMethod ? AUTH_LABEL[cred.authMethod] ?? cred.authMethod : '—'}
              {cred.expiresAt && <span className="text-gray-400"> · 下次刷新 {formatDate(cred.expiresAt)}</span>}
            </Field>
            <Field label="Endpoint">
              <span className="font-mono">{cred.endpoint || '—'}</span>
            </Field>
            <Field label="API Key">
              <span className="font-mono">{cred.maskedApiKey || '—'}</span>
            </Field>
            <Field label="代理">
              <span className="font-mono">{cred.hasProxy ? cred.proxyUrl ?? '—' : '—'}</span>
            </Field>
            <Field label="Profile ARN">{cred.hasProfileArn ? '有 ✓' : '—'}</Field>
            <Field label="订阅详情">
              {loadingBalance ? (
                <span className="text-gray-500"><Loader2 className="inline w-3 h-3 animate-spin mr-1" />加载中</span>
              ) : balance ? (
                <span>
                  剩余 {balance.remaining.toLocaleString()} / {balance.usageLimit.toLocaleString()}
                  （{(100 - balance.usagePercentage).toFixed(1)}%）
                  <span className="text-gray-400"> · 下次重置 {formatRelativeFuture(balance.nextResetAt)}</span>
                </span>
              ) : (
                <span className="space-x-2">
                  <span className="text-gray-500">未查询</span>
                  <Button size="sm" variant="outline" className="h-6" onClick={() => onQueryBalance(cred.id)}>
                    立即查询
                  </Button>
                </span>
              )}
            </Field>
            <Field label="禁用原因">
              {cred.disabled ? (cred.disabledReason || '—') : '—'}
            </Field>
            <Field label="成功调用">{cred.successCount.toLocaleString()}</Field>
          </div>
          {cred.disabled && cred.disabledReasonDetail && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              <div className="text-xs text-gray-500 mb-1">失败详情</div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 px-3 py-2 rounded border border-red-100 dark:border-red-900 max-h-40 overflow-auto">
{cred.disabledReasonDetail}
              </pre>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div>{children}</div>
    </div>
  )
}
