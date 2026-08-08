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

// Mock framer-motion to eliminate animation timers that cause act() warnings.
//
// IMPORTANT: the per-tag component returned by the Proxy must be a STABLE
// reference (cached) and must forward refs. `<motion.div>` in JSX re-evaluates
// the `motion.div` property access on every render of the consuming component.
// A Proxy `get` trap that returns a brand-new arrow function each time hands
// React a different component type on every render, which forces React to
// unmount + remount the entire subtree under that element (losing focus,
// local state, and invalidating any DOM node references a test captured
// earlier via `getByRole`/`getByLabelText`, etc.). Caching by tag name and
// using forwardRef avoids both that remount churn and "function components
// cannot be given refs" warnings for components (e.g. modals) that pass a
// ref through motion.div for focus-trap management.
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  const componentCache = new Map<string, React.ForwardRefExoticComponent<any>>()
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => {
          let Comp = componentCache.get(tag)
          if (!Comp) {
            Comp = React.forwardRef(({ children, ...rest }: any, ref: React.Ref<any>) =>
              React.createElement(tag, { ...rest, ref }, children),
            )
            Comp.displayName = `motion.${tag}`
            componentCache.set(tag, Comp)
          }
          return Comp
        },
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
