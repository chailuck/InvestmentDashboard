import '@testing-library/jest-dom'
import { vi } from 'vitest'
import React from 'react'

// Mock Next.js router — must happen before any component import that uses it
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}))

// Mock next/dynamic — returns a wrapper that renders children synchronously
// so dynamic(() => import('echarts-for-react')) resolves immediately in tests
vi.mock('next/dynamic', () => ({
  default: (importFn: () => Promise<any>) => {
    // Return a placeholder component; the echarts mock below takes effect anyway
    const Comp = (props: any) => React.createElement('div', { 'data-testid': 'dynamic-component', ...props })
    Comp.displayName = 'DynamicComponent'
    return Comp
  },
}))

// Mock echarts-for-react — heavy Canvas dependency not available in jsdom
vi.mock('echarts-for-react', () => ({
  default: ({ option, style }: { option: unknown; style?: React.CSSProperties }) =>
    React.createElement('div', {
      'data-testid': 'echarts',
      'data-option': JSON.stringify(option),
      style,
    }),
}))

// Mock framer-motion to eliminate animation timers that cause act() warnings
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) =>
          ({ children, ...rest }: any) =>
            React.createElement(tag, rest, children),
      },
    ),
  }
})

// Browser APIs missing in jsdom
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
})) as unknown as typeof ResizeObserver

global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
  root: null,
  rootMargin: '',
  thresholds: [],
  takeRecords: vi.fn(() => []),
})) as unknown as typeof IntersectionObserver

// Silence noisy console errors from missing CSS / canvas
const originalError = console.error.bind(console)
console.error = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : ''
  if (
    msg.includes('Warning: ReactDOM.render') ||
    msg.includes('act(') ||
    msg.includes('Not implemented: navigation')
  ) {
    return
  }
  originalError(...args)
}
