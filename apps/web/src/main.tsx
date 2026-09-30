import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ApiError } from './api/client';
import { handleUnauthorized } from './lib/auth';
import './index.css';

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (e) => handleUnauthorized(queryClient, e) }),
  mutationCache: new MutationCache({ onError: (e) => handleUnauthorized(queryClient, e) }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Don't retry client errors (4xx); do retry transient failures once.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
