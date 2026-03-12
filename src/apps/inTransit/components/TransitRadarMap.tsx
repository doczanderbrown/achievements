import { useEffect, useMemo, useState } from 'react';

import L, { type LatLngBoundsExpression, type LatLngTuple } from 'leaflet';
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';

import type { InventoryItem } from '../types';
import { formatDateTime, formatDuration, HOUR_MS } from '../utils/age';
import { normalizeDestination } from '../utils/destination';
import 'leaflet/dist/leaflet.css';

type TransitRadarMapProps = {
  items: InventoryItem[];
  stuckThresholdHours: number;
};

type KnownFacility = {
  id: string;
  label: string;
  point: LatLngTuple;
  approximate: boolean;
  patterns: RegExp[];
};

type FacilityLookup = {
  id: string;
  label: string;
  point: LatLngTuple;
  isKnown: boolean;
  isApproximate: boolean;
};

type AirportNode = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  departures: number;
  arrivals: number;
  isKnown: boolean;
  isApproximate: boolean;
  sourceNames: string[];
};

type FlightTrack = {
  id: string;
  invID: string;
  desc: string;
  owningTower: string;
  from: string;
  to: string;
  ageMs: number | null;
  ageBucket: string;
  lastScanAgoRaw: string;
  lastScanAt: Date | null;
  lastScanBy: string;
  isStuck: boolean;
  start: LatLngTuple;
  end: LatLngTuple;
  plane: LatLngTuple;
  bearing: number;
};

const GAINESVILLE_CENTER: LatLngTuple = [29.6516, -82.3248];
const MAX_PLANES = 180;

const KNOWN_FACILITIES: KnownFacility[] = [
  {
    id: 'hvn',
    label: 'UF Heart, Vascular, Neuromedicine (HVN)',
    // OSM building centroid: "UF Health Heart & Vascular and Neuromedicine Hospitals"
    point: [29.639328, -82.340811],
    approximate: false,
    patterns: [/^hvn$/i, /heart.*vascular.*neuro/i, /heart\s*&\s*vascular/i, /neuromedicine/i],
  },
  {
    id: 'nt',
    label: 'UF Health North Tower (NT)',
    // Approximation based on north side of UF Health Shands hospital footprint.
    point: [29.64122, -82.34398],
    approximate: true,
    patterns: [/^nt$/i, /north tower/i],
  },
  {
    id: 'st',
    label: 'UF Health South Tower (ST)',
    // Approximation based on south side of UF Health Shands hospital footprint.
    point: [29.63902, -82.34405],
    approximate: true,
    patterns: [/^st$/i, /south tower/i],
  },
  {
    id: 'osc',
    label: 'The Oaks Surgery Center (OSC)',
    // Approximation near UF Health Eye Center at The Oaks.
    point: [29.654414, -82.408975],
    approximate: true,
    patterns: [/^osc$/i, /oaks surgery/i, /oaks surgical/i, /eye center at the oaks/i],
  },
  {
    id: 'fsc',
    label: 'UF Health Florida Surgical Center (FSC)',
    // OSM object: UF Health Florida Surgical Center, 3480 Hull Rd.
    point: [29.638986, -82.375273],
    approximate: false,
    patterns: [/^fsc$/i, /florida surgical center/i],
  },
  {
    id: 'offsite',
    label: 'UF Shands Offsite Processing Center',
    // Approximation near Gainesville Regional Airport / airport industrial area.
    point: [29.69231, -82.275997],
    approximate: true,
    patterns: [/off\s*site/i, /offsite/i, /remote sterile processing/i, /sterile processing/i],
  },
];

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const fallbackFacilityPoint = (facility: string): LatLngTuple => {
  const key = facility.trim().toLowerCase() || 'unknown';
  const seed = hashString(key);

  const angleRad = ((seed % 360) * Math.PI) / 180;
  const radiusKm = 1.3 + (seed % 850) / 100;

  const latOffset = (radiusKm / 111) * Math.sin(angleRad);
  const lngOffset =
    (radiusKm / (111 * Math.cos((GAINESVILLE_CENTER[0] * Math.PI) / 180))) *
    Math.cos(angleRad);

  return [GAINESVILLE_CENTER[0] + latOffset, GAINESVILLE_CENTER[1] + lngOffset];
};

const resolveFacility = (facility: string): FacilityLookup => {
  const cleaned = facility.trim() || 'Unknown';
  const normalized = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const known = KNOWN_FACILITIES.find((candidate) =>
    candidate.patterns.some((pattern) =>
      pattern.test(normalized) || pattern.test(cleaned),
    ),
  );

  if (known) {
    return {
      id: known.id,
      label: known.label,
      point: known.point,
      isKnown: true,
      isApproximate: known.approximate,
    };
  }

  return {
    id: `fallback:${cleaned.toLowerCase()}`,
    label: cleaned,
    point: fallbackFacilityPoint(cleaned),
    isKnown: false,
    isApproximate: true,
  };
};

const bearingBetween = (start: LatLngTuple, end: LatLngTuple): number => {
  const latDiff = end[0] - start[0];
  const lngDiff = end[1] - start[1];

  if (Math.abs(latDiff) < 0.000001 && Math.abs(lngDiff) < 0.000001) {
    return 0;
  }

  return (Math.atan2(lngDiff, latDiff) * 180) / Math.PI;
};

const interpolatePoint = (
  start: LatLngTuple,
  end: LatLngTuple,
  progress: number,
): LatLngTuple => {
  const clamped = Math.max(0.05, Math.min(0.95, progress));
  const lat = start[0] + (end[0] - start[0]) * clamped;
  const lng = start[1] + (end[1] - start[1]) * clamped;
  return [lat, lng];
};

const createPlaneIcon = (
  isStuck: boolean,
  isSelected: boolean,
  bearing: number,
) => {
  const stateClass = isStuck ? 'radar-plane--stuck' : 'radar-plane--flowing';
  const selectedClass = isSelected ? ' radar-plane--selected' : '';
  return L.divIcon({
    className: 'radar-plane-icon',
    iconAnchor: [11, 11],
    iconSize: [22, 22],
    html: `<div class="radar-plane ${stateClass}${selectedClass}" style="transform: rotate(${bearing.toFixed(1)}deg)">▲</div>`,
  });
};

const FitToBounds = ({ bounds }: { bounds: LatLngBoundsExpression }) => {
  const map = useMap();

  useEffect(() => {
    map.fitBounds(bounds, {
      padding: [26, 26],
      maxZoom: 14,
    });
  }, [bounds, map]);

  return null;
};

const TransitRadarMap = ({ items, stuckThresholdHours }: TransitRadarMapProps) => {
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
  const stuckThresholdMs = stuckThresholdHours * HOUR_MS;

  const { airports, flights, bounds } = useMemo(() => {
    const airportMap = new Map<string, AirportNode>();
    const tracks: FlightTrack[] = [];

    const sorted = [...items]
      .sort((left, right) => {
        const leftAge = left.ageMs ?? -1;
        const rightAge = right.ageMs ?? -1;
        return rightAge - leftAge;
      })
      .slice(0, MAX_PLANES);

    const ensureAirport = (rawName: string): AirportNode => {
      const cleaned = rawName.trim() || 'Unknown';
      const resolved = resolveFacility(cleaned);
      const existing = airportMap.get(resolved.id);
      if (existing) {
        if (!existing.sourceNames.includes(cleaned)) {
          existing.sourceNames.push(cleaned);
        }
        return existing;
      }

      const node: AirportNode = {
        id: resolved.id,
        name: resolved.label,
        lat: resolved.point[0],
        lng: resolved.point[1],
        departures: 0,
        arrivals: 0,
        isKnown: resolved.isKnown,
        isApproximate: resolved.isApproximate,
        sourceNames: [cleaned],
      };
      airportMap.set(resolved.id, node);
      return node;
    };

    sorted.forEach((item, index) => {
      const fromName = item.fromFacility?.trim() || item.lastScanFacility.trim() || 'Unknown';
      const toName = normalizeDestination(item.toLocation ?? item.lastScanLoc ?? 'Unknown');

      const fromAirport = ensureAirport(fromName);
      const toAirport = ensureAirport(toName);

      fromAirport.departures += 1;
      toAirport.arrivals += 1;

      const seed = hashString(`${item.invID}|${item.lastScanAgoRaw}|${index}`);
      const progress = 0.08 + (seed % 84) / 100;
      const start: LatLngTuple = [fromAirport.lat, fromAirport.lng];
      const end: LatLngTuple = [toAirport.lat, toAirport.lng];

      tracks.push({
        id: `${item.invID}-${item.lastScanLoc}-${index}`,
        invID: item.invID,
        desc: item.desc,
        owningTower: item.owningTower,
        from: fromAirport.name,
        to: toAirport.name,
        ageMs: item.ageMs,
        ageBucket: item.ageBucket,
        lastScanAgoRaw: item.lastScanAgoRaw,
        lastScanAt: item.lastScanAt,
        lastScanBy: item.lastScanBy,
        isStuck: item.ageMs !== null && item.ageMs >= stuckThresholdMs,
        start,
        end,
        plane: interpolatePoint(start, end, progress),
        bearing: bearingBetween(start, end),
      });
    });

    const airportList = Array.from(airportMap.values());

    const mapBounds: LatLngBoundsExpression = airportList.length
      ? [
          [
            Math.min(...airportList.map((airport) => airport.lat)) - 0.014,
            Math.min(...airportList.map((airport) => airport.lng)) - 0.02,
          ],
          [
            Math.max(...airportList.map((airport) => airport.lat)) + 0.014,
            Math.max(...airportList.map((airport) => airport.lng)) + 0.02,
          ],
        ]
      : [
          [GAINESVILLE_CENTER[0] - 0.05, GAINESVILLE_CENTER[1] - 0.05],
          [GAINESVILLE_CENTER[0] + 0.05, GAINESVILLE_CENTER[1] + 0.05],
        ];

    return {
      airports: airportList,
      flights: tracks,
      bounds: mapBounds,
    };
  }, [items, stuckThresholdMs]);

  const selectedFlight = useMemo(
    () => flights.find((flight) => flight.id === selectedFlightId) ?? null,
    [flights, selectedFlightId],
  );

  const stuckFlights = useMemo(
    () => flights.filter((flight) => flight.isStuck).length,
    [flights],
  );

  const busiestAirports = useMemo(
    () =>
      [...airports]
        .sort(
          (left, right) =>
            right.arrivals + right.departures -
            (left.arrivals + left.departures),
        )
        .slice(0, 6),
    [airports],
  );

  const unmappedAirports = useMemo(
    () => airports.filter((airport) => !airport.isKnown),
    [airports],
  );

  const approximateKnownAirports = useMemo(
    () => airports.filter((airport) => airport.isKnown && airport.isApproximate),
    [airports],
  );

  if (flights.length === 0) {
    return (
      <section className="rounded-3xl border border-stroke bg-card/90 p-6 text-sm text-muted shadow-soft">
        Upload a workbook to generate the Gainesville radar map.
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-stroke bg-card/90 p-4 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-muted">
            Transit Radar
          </div>
          <div className="mt-1 text-sm text-muted">
            Facilities as airports, sets as planes in Gainesville airspace
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <span className="rounded-full border border-stroke bg-white px-3 py-1">
            Planes: {flights.length}
          </span>
          <span className="rounded-full border border-stroke bg-white px-3 py-1">
            Airports: {airports.length}
          </span>
          <span className="rounded-full border border-stroke bg-white px-3 py-1">
            Stuck: {stuckFlights}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="radar-map-shell rounded-2xl border border-stroke">
          <MapContainer
            center={GAINESVILLE_CENTER}
            zoom={12}
            scrollWheelZoom
            className="radar-map"
            minZoom={10}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <FitToBounds bounds={bounds} />

            {flights.map((flight) => (
              <Polyline
                key={`route-${flight.id}`}
                positions={[flight.start, flight.end]}
                color={flight.isStuck ? '#ea580c' : '#0ea5e9'}
                weight={selectedFlightId === flight.id ? 4 : 2}
                opacity={
                  selectedFlightId === null || selectedFlightId === flight.id
                    ? 0.85
                    : 0.28
                }
              />
            ))}

            {airports.map((airport) => {
              const traffic = airport.arrivals + airport.departures;
              const radius = Math.max(6, Math.min(14, 4 + Math.sqrt(traffic) * 2));
              return (
                <CircleMarker
                  key={`airport-${airport.id}`}
                  center={[airport.lat, airport.lng]}
                  radius={radius}
                  pathOptions={{
                    color: '#a16207',
                    weight: 1,
                    fillColor: '#f59e0b',
                    fillOpacity: 0.6,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -8]}>
                    {airport.name}
                  </Tooltip>
                  <Popup>
                    <div className="space-y-1 text-xs">
                      <div className="font-semibold text-ink">{airport.name}</div>
                      <div>Departures: {airport.departures}</div>
                      <div>Arrivals: {airport.arrivals}</div>
                      {!airport.isKnown ? (
                        <div>Map status: auto-placed</div>
                      ) : airport.isApproximate ? (
                        <div>Map status: mapped (approx)</div>
                      ) : (
                        <div>Map status: mapped</div>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}

            {flights.map((flight) => (
              <Marker
                key={`plane-${flight.id}`}
                position={flight.plane}
                icon={createPlaneIcon(
                  flight.isStuck,
                  selectedFlightId === flight.id,
                  flight.bearing,
                )}
                eventHandlers={{
                  click: () => setSelectedFlightId(flight.id),
                }}
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={0.9}>
                  {flight.invID}: {flight.from} to {flight.to}
                </Tooltip>
              </Marker>
            ))}
          </MapContainer>
        </div>

        <aside className="space-y-3 rounded-2xl border border-stroke bg-white/90 p-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted">Legend</div>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted">
              <span className="inline-block h-2 w-8 rounded-full bg-sky-500"></span>
              Flowing routes
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted">
              <span className="inline-block h-2 w-8 rounded-full bg-orange-600"></span>
              Stuck routes (&gt;= {stuckThresholdHours}h)
            </div>
          </div>

          <div className="rounded-2xl border border-stroke bg-slate-50 p-3 text-xs text-muted">
            <div className="font-semibold text-ink">Selected plane</div>
            {selectedFlight ? (
              <div className="mt-2 space-y-1">
                <div className="font-semibold text-ink">{selectedFlight.invID}</div>
                <div>{selectedFlight.desc || 'No description'}</div>
                <div>Tower: {selectedFlight.owningTower}</div>
                <div>
                  Route: {selectedFlight.from} to {selectedFlight.to}
                </div>
                <div>
                  Age: {formatDuration(selectedFlight.ageMs, selectedFlight.lastScanAgoRaw)}
                </div>
                <div>Bucket: {selectedFlight.ageBucket}</div>
                <div>
                  Last scan: {formatDateTime(selectedFlight.lastScanAt)} by{' '}
                  {selectedFlight.lastScanBy || 'Unknown'}
                </div>
              </div>
            ) : (
              <div className="mt-2">Click a plane marker for details.</div>
            )}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted">
              Busiest Airports
            </div>
            <div className="mt-2 space-y-2 text-xs text-muted">
              {busiestAirports.map((airport) => (
                <div
                  key={`airport-row-${airport.id}`}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="line-clamp-2 text-ink">{airport.name}</span>
                  <span className="rounded-full border border-stroke px-2 py-0.5 text-[11px] text-ink">
                    {airport.arrivals + airport.departures}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {unmappedAirports.length > 0 ? (
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-muted">
                Unmapped Facilities
              </div>
              <div className="mt-2 space-y-2 text-xs text-muted">
                {unmappedAirports.slice(0, 6).map((airport) => (
                  <div key={`unmapped-${airport.id}`} className="rounded-xl border border-stroke bg-slate-50 px-2 py-1">
                    {airport.sourceNames[0]}
                  </div>
                ))}
                {unmappedAirports.length > 6 ? (
                  <div>+{unmappedAirports.length - 6} more</div>
                ) : null}
              </div>
            </div>
          ) : null}

          {approximateKnownAirports.length > 0 ? (
            <div className="text-xs text-muted">
              Approximate mapped facilities: {approximateKnownAirports.map((airport) => airport.name).join(', ')}
            </div>
          ) : null}
        </aside>
      </div>

      <p className="mt-3 text-[11px] text-muted">
        Known UF facilities use fixed coordinates. Any unmatched facility is auto-placed near Gainesville.
      </p>
    </section>
  );
};

export default TransitRadarMap;
