import JSZip from 'jszip';
import Papa from 'papaparse';

// Types for the two GTFS tables implemented in this PoC.
// TODO: Add types for trips, stop_times, calendar, calendar_dates, shapes,
//       agency, fare_attributes, fare_rules, frequencies, transfers, feed_info
//       as each table is added to the pipeline.

export interface StopRow {
  stop_id: string;
  stop_name: string | null;
  stop_lat: number | null;
  stop_lon: number | null;
  stop_desc: string | null;
  zone_id: string | null;
}

export interface RouteRow {
  route_id: string;
  agency_id: string | null;
  route_short_name: string | null;
  route_long_name: string | null;
  route_type: number | null;
  route_color: string | null;
}

export interface ParsedGtfs {
  stops: StopRow[];
  routes: RouteRow[];
}

export async function parseGtfsZip(buffer: Buffer): Promise<ParsedGtfs> {
  const zip = await JSZip.loadAsync(buffer);

  // TODO: Extract and parse additional GTFS files as tables are added:
  // trips.txt, stop_times.txt, calendar.txt, calendar_dates.txt,
  // shapes.txt, agency.txt, fare_attributes.txt, fare_rules.txt,
  // frequencies.txt, transfers.txt, feed_info.txt

  const stopsFile = zip.file('stops.txt');
  const routesFile = zip.file('routes.txt');

  if (!stopsFile)
    throw new Error('stops.txt not found in ZIP');
  if (!routesFile)
    throw new Error('routes.txt not found in ZIP');

  const [stopsText, routesText] = await Promise.all([
    stopsFile.async('string'),
    routesFile.async('string'),
  ]);

  return {
    stops: parseStops(stopsText),
    routes: parseRoutes(routesText),
  };
}

function parseCsv(text: string): Record<string, string>[] {
  // papaparse handles BOM, CRLF line endings, and quoted fields — all common in GTFS exports.
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return result.data;
}

function parseStops(text: string): StopRow[] {
  return parseCsv(text).map(row => ({
    stop_id: row.stop_id,
    stop_name: row.stop_name || null,
    stop_lat: row.stop_lat ? Number.parseFloat(row.stop_lat) : null,
    stop_lon: row.stop_lon ? Number.parseFloat(row.stop_lon) : null,
    stop_desc: row.stop_desc || null,
    zone_id: row.zone_id || null,
  }));
}

function parseRoutes(text: string): RouteRow[] {
  return parseCsv(text).map(row => ({
    route_id: row.route_id,
    agency_id: row.agency_id || null,
    route_short_name: row.route_short_name || null,
    route_long_name: row.route_long_name || null,
    route_type: row.route_type ? Number.parseInt(row.route_type, 10) : null,
    route_color: row.route_color || null,
  }));
}
