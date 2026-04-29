'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            retry: 1,
            refetchInterval: 2000,
            refetchIntervalInBackground: true,
            refetchOnMount: 'always',
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
