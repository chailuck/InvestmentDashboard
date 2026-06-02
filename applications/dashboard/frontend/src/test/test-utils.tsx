import React, { type ReactElement } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Creates a QueryClient configured for test isolation:
 * - No retries so failed queries surface immediately
 * - Zero gcTime so cached data is discarded between tests
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

function AllProviders({ children }: { children: React.ReactNode }) {
  const qc = createTestQueryClient()
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

/**
 * Custom render that wraps the component under test with all app-level providers.
 * Import `render` from this module (not from @testing-library/react) in tests.
 */
function customRender(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: AllProviders, ...options })
}

// Re-export everything from RTL so tests only need one import
export * from '@testing-library/react'
export { customRender as render }
