import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { EmptyState, Spinner } from './components/States';
import { FlightFormPage } from './pages/FlightFormPage';
import { FlightsPage } from './pages/FlightsPage';
import { ImportPage } from './pages/ImportPage';

// MapLibre and Recharts are the heaviest dependencies; load them only on their pages.
const MapPage = lazy(() => import('./pages/MapPage').then((m) => ({ default: m.MapPage })));
const StatsPage = lazy(() => import('./pages/StatsPage').then((m) => ({ default: m.StatsPage })));

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route
          index
          element={
            <Suspense fallback={<Spinner label="Loading map…" />}>
              <MapPage />
            </Suspense>
          }
        />
        <Route path="flights" element={<FlightsPage />} />
        <Route path="flights/new" element={<FlightFormPage />} />
        <Route path="flights/:id/edit" element={<FlightFormPage />} />
        <Route
          path="stats"
          element={
            <Suspense fallback={<Spinner label="Loading stats…" />}>
              <StatsPage />
            </Suspense>
          }
        />
        <Route path="import" element={<ImportPage />} />
        <Route path="*" element={<EmptyState title="Page not found" />} />
      </Route>
    </Routes>
  );
}
