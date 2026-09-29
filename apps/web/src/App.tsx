import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { EmptyState } from './components/States';
import { FlightFormPage } from './pages/FlightFormPage';
import { FlightsPage } from './pages/FlightsPage';
import { ImportPage } from './pages/ImportPage';
import { MapPage } from './pages/MapPage';
import { StatsPage } from './pages/StatsPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<MapPage />} />
        <Route path="flights" element={<FlightsPage />} />
        <Route path="flights/new" element={<FlightFormPage />} />
        <Route path="flights/:id/edit" element={<FlightFormPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="*" element={<EmptyState title="Page not found" />} />
      </Route>
    </Routes>
  );
}
