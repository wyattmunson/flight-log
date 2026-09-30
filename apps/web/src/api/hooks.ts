import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AirlineSummary,
  AirportSummary,
  AppConfig,
  AuthMe,
  ChangePasswordInput,
  FilterOptions,
  FlightDetail,
  FlightFilters,
  FlightInput,
  FlightListItem,
  FlightPatch,
  ImportBatch,
  ImportPreview,
  ImportSummary,
  LoginInput,
  LookupResponse,
  MapData,
  Paginated,
  RouteFlight,
  Stats,
} from '@flight-log/shared';
import { apiFetch } from './client';

export const ME_KEY = ['me'] as const;

/** The signed-in user, or (with AUTH_REQUIRED off) the default user with `authRequired: false`. */
export const useMe = () =>
  useQuery({
    queryKey: ME_KEY,
    queryFn: () => apiFetch<AuthMe>('/auth/me'),
    staleTime: 5 * 60_000,
  });

/** Login and logout swap the acting user, so nothing cached for the previous one may survive. */
export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      apiFetch<AuthMe>('/auth/login', { method: 'POST', json: input }),
    onSuccess: (me) => {
      queryClient.clear();
      queryClient.setQueryData(ME_KEY, me);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => queryClient.clear(),
  });
}

export const useChangePassword = () =>
  useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      apiFetch<void>('/auth/password', { method: 'POST', json: input }),
  });

export const useConfig = () =>
  useQuery({
    queryKey: ['config'],
    queryFn: () => apiFetch<AppConfig>('/config'),
    staleTime: Infinity,
  });

export const useFilterOptions = () =>
  useQuery({
    queryKey: ['filter-options'],
    queryFn: () => apiFetch<FilterOptions>('/filter-options'),
  });

export type FlightListParams = FlightFilters & {
  page: number;
  pageSize: number;
  sort: string;
  q?: string;
};

export const useFlights = (params: FlightListParams) =>
  useQuery({
    queryKey: ['flights', params],
    queryFn: () => apiFetch<Paginated<FlightListItem>>('/flights', { query: params }),
    placeholderData: keepPreviousData,
  });

export const useFlight = (id: string | null | undefined) =>
  useQuery({
    queryKey: ['flight', id],
    queryFn: () => apiFetch<FlightDetail>(`/flights/${id}`),
    enabled: !!id,
  });

export const useMapData = (filters: FlightFilters) =>
  useQuery({
    queryKey: ['map', filters],
    queryFn: () => apiFetch<MapData>('/map', { query: filters }),
    placeholderData: keepPreviousData,
  });

export const useRouteFlights = (route: { a: number; b: number } | null, filters: FlightFilters) =>
  useQuery({
    queryKey: ['route-flights', route, filters],
    queryFn: () =>
      apiFetch<RouteFlight[]>(`/map/routes/${route!.a}/${route!.b}/flights`, { query: filters }),
    enabled: !!route,
  });

export const useStats = (filters: FlightFilters) =>
  useQuery({
    queryKey: ['stats', filters],
    queryFn: () => apiFetch<Stats>('/stats', { query: filters }),
    placeholderData: keepPreviousData,
  });

export const useAirportSearch = (q: string) =>
  useQuery({
    queryKey: ['airport-search', q],
    queryFn: () => apiFetch<AirportSummary[]>('/airports/search', { query: { q } }),
    enabled: q.trim().length > 0,
    staleTime: 5 * 60_000,
  });

export const useAirlineSearch = (q: string) =>
  useQuery({
    queryKey: ['airline-search', q],
    queryFn: () => apiFetch<AirlineSummary[]>('/airlines/search', { query: { q } }),
    enabled: q.trim().length > 0,
    staleTime: 5 * 60_000,
  });

export const useImportBatches = () =>
  useQuery({
    queryKey: ['import-batches'],
    queryFn: () => apiFetch<ImportBatch[]>('/import/batches'),
  });

/** Invalidate everything derived from the user's flights. */
function useInvalidateFlightData() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [
        'flights',
        'flight',
        'map',
        'stats',
        'filter-options',
        'import-batches',
        'route-flights',
      ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
    );
}

export function useSaveFlight() {
  const invalidate = useInvalidateFlightData();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: FlightInput | FlightPatch }) =>
      id
        ? apiFetch<FlightDetail>(`/flights/${id}`, { method: 'PATCH', json: input })
        : apiFetch<FlightDetail>('/flights', { method: 'POST', json: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteFlight() {
  const invalidate = useInvalidateFlightData();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/flights/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useImportPreview() {
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return apiFetch<ImportPreview>('/import/preview', { method: 'POST', body });
    },
  });
}

export function useImportCommit() {
  const invalidate = useInvalidateFlightData();
  return useMutation({
    mutationFn: (previewId: string) =>
      apiFetch<ImportSummary>('/import/commit', { method: 'POST', json: { previewId } }),
    onSuccess: invalidate,
  });
}

export function useUndoImport() {
  const invalidate = useInvalidateFlightData();
  return useMutation({
    mutationFn: (batchId: string) =>
      apiFetch<{ deletedFlights: number }>(`/import/batches/${batchId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useLookup() {
  return useMutation({
    mutationFn: (input: { flightNumber: string; date: string }) =>
      apiFetch<LookupResponse>('/lookup', { method: 'POST', json: input }),
  });
}
