import { useEffect, useState } from 'react'
import { Monitor } from 'lucide-react'

const BREAKPOINT = 768

export function MobileGuard({ children }: { children: React.ReactNode }) {
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < BREAKPOINT
  )

  useEffect(() => {
    const handler = () => setIsNarrow(window.innerWidth < BREAKPOINT)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  if (isNarrow) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
        <Monitor className="h-12 w-12 text-gray-400 mb-4" />
        <h2 className="text-lg font-semibold mb-2">请在桌面端访问 Kiro Admin</h2>
        <p className="text-sm text-gray-500 max-w-xs">
          当前界面针对桌面端优化。窗口宽度 ≥ 768px 后将自动加载完整功能。
        </p>
      </div>
    )
  }

  return <>{children}</>
}
