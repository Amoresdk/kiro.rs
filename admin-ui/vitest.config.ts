import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // TODO(Task 0 bootstrap): 临时允许"无测试文件"通过，仅为本 Task 验收使用。
    // 一旦 Task 1 落地第一个 *.test.ts 文件，请移除此项，
    // 以避免 CI 静默吞掉"测试套件意外为空"的失败。
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
