import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LngLatBoundsLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 runs tile parsing in a module worker; let Vite bundle it and hand MapLibre its URL
// (the library's own relative lookup breaks under dependency pre-bundling).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { MapAirport, MapData } from '@flight-log/shared';
import { countryName } from '../lib/format';

maplibregl.setWorkerUrl(workerUrl);

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function toGeoJson(data: MapData) {
  return {
    routes: {
      type: 'FeatureCollection' as const,
      features: data.routes.map((r) => ({
        type: 'Feature' as const,
        properties: { key: r.key, a: r.airportA, b: r.airportB, count: r.count },
        geometry: { type: 'LineString' as const, coordinates: r.path },
      })),
    },
    airports: {
      type: 'FeatureCollection' as const,
      features: data.airports.map((a) => ({
        type: 'Feature' as const,
        properties: { id: a.id, code: a.iata ?? a.icao ?? '', visits: a.visits },
        geometry: { type: 'Point' as const, coordinates: [a.longitude, a.latitude] },
      })),
    },
  };
}

/**
 * Bounds covering every drawn point, oriented so the view doesn't split the data at ±180:
 * find the widest empty stretch of longitude and put the view's edges there. East may exceed
 * 180 (e.g. a Pacific-centered view), which MapLibre handles.
 */
export function boundsOf(data: MapData): LngLatBoundsLike | null {
  const pts: [number, number][] = data.routes.flatMap((r) => r.path);
  for (const a of data.airports) pts.push([a.longitude, a.latitude]);
  if (pts.length === 0) return null;
  const lats = pts.map((p) => p[1]);
  const s = Math.max(Math.min(...lats), -75);
  const n = Math.min(Math.max(...lats), 80);
  const lons = [...new Set(pts.map(([lon]) => ((((lon + 180) % 360) + 360) % 360) - 180))].sort(
    (a, b) => a - b,
  );
  if (lons.length === 1)
    return [
      [lons[0]! - 5, s - 3],
      [lons[0]! + 5, n + 3],
    ];
  // Largest gap between consecutive longitudes, including the wrap from last back to first.
  let gapStart = lons[lons.length - 1]!;
  let gapEnd = lons[0]! + 360;
  for (let i = 1; i < lons.length; i++) {
    if (lons[i]! - lons[i - 1]! > gapEnd - gapStart) {
      gapStart = lons[i - 1]!;
      gapEnd = lons[i]!;
    }
  }
  // The data runs from the end of the gap eastwards to its start.
  const west = gapEnd > 180 ? gapEnd - 360 : gapEnd;
  let east = gapStart;
  while (east < west) east += 360;
  return [
    [west, s],
    [east, n],
  ];
}

function popupContent(a: MapAirport) {
  const root = document.createElement('div');
  root.className = 'text-sm';
  const title = document.createElement('div');
  title.className = 'font-semibold';
  title.textContent = `${a.iata ?? a.icao} · ${a.name}`;
  const place = document.createElement('div');
  place.textContent = [a.city, countryName(a.country)].filter(Boolean).join(', ');
  const visits = document.createElement('div');
  visits.className = 'mt-1';
  visits.textContent = `${a.visits} visit${a.visits === 1 ? '' : 's'} (${a.departures} dep · ${a.arrivals} arr)`;
  root.append(title, place, visits);
  return root;
}

interface Props {
  styleUrl: string;
  data: MapData | undefined;
  selectedRoute: string | null;
  onSelectRoute: (key: string | null) => void;
}

export function FlightMap({ styleUrl, data, selectedRoute, onSelectRoute }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fitted = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const onSelectRef = useRef(onSelectRoute);
  onSelectRef.current = onSelectRoute;

  useEffect(() => {
    if (!container.current) return;
    let map: maplibregl.Map;
    let styleReady = false;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: styleUrl,
        center: [0, 25],
        zoom: 1.2,
        attributionControl: { compact: true },
        dragRotate: false,
      });
    } catch (e) {
      setError(`The map could not start (${(e as Error).message}). WebGL may be unavailable.`);
      return;
    }
    mapRef.current = map;
    // The container may be laid out after the map is created (and changes with the viewport).
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.touchZoomRotate.disableRotation();

    map.on('error', (e) => {
      if (!styleReady) {
        setError(`Could not load the basemap style (${e.error?.message ?? 'network error'}).`);
      }
    });

    map.on('load', () => {
      styleReady = true;
      setError(null);
      const route = cssVar('--map-route', '#eb6834');
      const airport = cssVar('--map-airport', '#2a78d6');
      map.addSource('routes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('airports', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'routes-line',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': route,
          'line-width': ['interpolate', ['linear'], ['get', 'count'], 1, 1.5, 5, 3.5, 20, 7],
          'line-opacity': ['interpolate', ['linear'], ['get', 'count'], 1, 0.55, 5, 0.8, 20, 0.95],
        },
      });
      map.addLayer({
        id: 'routes-selected',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'key'], ''],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#0b0b0b', 'line-width': 4 },
      });
      // Wide invisible line so thin arcs are easy to click/tap.
      map.addLayer({
        id: 'routes-hit',
        type: 'line',
        source: 'routes',
        paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 14 },
      });
      map.addLayer({
        id: 'airports-circle',
        type: 'circle',
        source: 'airports',
        paint: {
          'circle-color': airport,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['sqrt', ['get', 'visits']],
            1,
            4,
            3,
            8,
            8,
            15,
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
      if (map.getStyle().glyphs) {
        map.addLayer({
          id: 'airports-label',
          type: 'symbol',
          source: 'airports',
          layout: {
            'text-field': ['get', 'code'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 11,
            'text-offset': [0, 1.3],
            'text-anchor': 'top',
          },
          paint: { 'text-color': '#1c1c1a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
        });
      }

      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px' });
      map.on('click', 'airports-circle', (e) => {
        const id = e.features?.[0]?.properties?.id;
        const a = dataRef.current?.airports.find((x) => x.id === id);
        if (!a) return;
        popup.setLngLat(e.lngLat).setDOMContent(popupContent(a)).addTo(map);
      });
      map.on('click', 'routes-hit', (e) => {
        if (map.queryRenderedFeatures(e.point, { layers: ['airports-circle'] }).length) return;
        const key = e.features?.[0]?.properties?.key as string | undefined;
        if (key) onSelectRef.current(key);
      });
      for (const layer of ['airports-circle', 'routes-hit']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }
      setLoaded(true);
    });

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      fitted.current = false;
      setLoaded(false);
    };
    // The style is fixed for the session; re-creating the map on other changes would lose the view.
  }, [styleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    const routes = map?.getSource('routes') as GeoJSONSource | undefined;
    const airports = map?.getSource('airports') as GeoJSONSource | undefined;
    if (!map || !loaded || !data || !routes || !airports) return;
    const geo = toGeoJson(data);
    routes.setData(geo.routes);
    airports.setData(geo.airports);
    if (!fitted.current) {
      const b = boundsOf(data);
      if (b) {
        map.fitBounds(b, { padding: 60, maxZoom: 6, duration: 0 });
        fitted.current = true;
      }
    }
  }, [data, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !map.getLayer('routes-selected')) return;
    map.setFilter('routes-selected', ['==', ['get', 'key'], selectedRoute ?? '']);
  }, [selectedRoute, loaded]);

  return (
    <div className="absolute inset-0">
      <div
        ref={container}
        className="h-full w-full"
        role="region"
        aria-label="Map of your flight routes"
      />
      {error && (
        <div
          role="alert"
          className="absolute inset-x-4 top-4 mx-auto max-w-md rounded-lg bg-white p-4 text-sm shadow dark:bg-stone-900"
        >
          {error}
        </div>
      )}
    </div>
  );
}
