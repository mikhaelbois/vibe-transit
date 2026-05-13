import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseGtfsZip } from '@/lib/gtfs/parse';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STOPS_CSV = `stop_id,stop_name,stop_lat,stop_lon,stop_desc,zone_id
S1,Main St,45.5017,-73.5673,Main Street stop,A
S2,Park Ave,45.5100,-73.5800,,
`;

const ROUTES_CSV = `route_id,agency_id,route_short_name,route_long_name,route_type,route_color
R1,AGENCY1,10,Downtown Express,3,FF0000
R2,,20,Night Owl,3,
`;

async function buildZip(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' });
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseGtfsZip', () => {
  describe('happy path', () => {
    it('parses stops and routes from a valid ZIP', async () => {
      const buffer = await buildZip({ 'stops.txt': STOPS_CSV, 'routes.txt': ROUTES_CSV });
      const result = await parseGtfsZip(buffer);

      expect(result.stops).toHaveLength(2);
      expect(result.routes).toHaveLength(2);
    });

    it('returns the correct stop data', async () => {
      const buffer = await buildZip({ 'stops.txt': STOPS_CSV, 'routes.txt': ROUTES_CSV });
      const { stops } = await parseGtfsZip(buffer);

      expect(stops[0]).toEqual({
        stop_id: 'S1',
        stop_name: 'Main St',
        stop_lat: 45.5017,
        stop_lon: -73.5673,
        stop_desc: 'Main Street stop',
        zone_id: 'A',
      });
    });

    it('returns the correct route data', async () => {
      const buffer = await buildZip({ 'stops.txt': STOPS_CSV, 'routes.txt': ROUTES_CSV });
      const { routes } = await parseGtfsZip(buffer);

      expect(routes[0]).toEqual({
        route_id: 'R1',
        agency_id: 'AGENCY1',
        route_short_name: '10',
        route_long_name: 'Downtown Express',
        route_type: 3,
        route_color: 'FF0000',
      });
    });
  });

  describe('missing files', () => {
    it('throws when stops.txt is missing from the ZIP', async () => {
      const buffer = await buildZip({ 'routes.txt': ROUTES_CSV });
      await expect(parseGtfsZip(buffer)).rejects.toThrow('stops.txt not found in ZIP');
    });

    it('throws when routes.txt is missing from the ZIP', async () => {
      const buffer = await buildZip({ 'stops.txt': STOPS_CSV });
      await expect(parseGtfsZip(buffer)).rejects.toThrow('routes.txt not found in ZIP');
    });
  });

  describe('field type coercion', () => {
    it('parses stop_lat and stop_lon as numbers', async () => {
      const buffer = await buildZip({ 'stops.txt': STOPS_CSV, 'routes.txt': ROUTES_CSV });
      const { stops } = await parseGtfsZip(buffer);

      expect(typeof stops[0].stop_lat).toBe('number');
      expect(typeof stops[0].stop_lon).toBe('number');
    });

    it('parses route_type as an integer', async () => {
      const buffer = await buildZip({ 'stops.txt': STOPS_CSV, 'routes.txt': ROUTES_CSV });
      const { routes } = await parseGtfsZip(buffer);

      expect(typeof routes[0].route_type).toBe('number');
      expect(Number.isInteger(routes[0].route_type)).toBe(true);
      expect(routes[0].route_type).toBe(3);
    });
  });

  describe('null fallback for empty/missing optional fields', () => {
    it('coerces empty stop_desc and zone_id to null', async () => {
      const buffer = await buildZip({ 'stops.txt': STOPS_CSV, 'routes.txt': ROUTES_CSV });
      const { stops } = await parseGtfsZip(buffer);

      // S2 has empty stop_desc and zone_id
      expect(stops[1].stop_desc).toBeNull();
      expect(stops[1].zone_id).toBeNull();
    });

    it('coerces empty agency_id and route_color to null', async () => {
      const buffer = await buildZip({ 'stops.txt': STOPS_CSV, 'routes.txt': ROUTES_CSV });
      const { routes } = await parseGtfsZip(buffer);

      // R2 has empty agency_id and route_color
      expect(routes[1].agency_id).toBeNull();
      expect(routes[1].route_color).toBeNull();
    });

    it('coerces absent optional stop fields to null', async () => {
      const csv = `stop_id,stop_name,stop_lat,stop_lon\nS3,,,\n`;
      const buffer = await buildZip({ 'stops.txt': csv, 'routes.txt': ROUTES_CSV });
      const { stops } = await parseGtfsZip(buffer);

      expect(stops[0].stop_lat).toBeNull();
      expect(stops[0].stop_lon).toBeNull();
      expect(stops[0].stop_name).toBeNull();
    });

    it('coerces absent route_type to null', async () => {
      const csv = `route_id,agency_id,route_short_name,route_long_name,route_type,route_color\nR3,,,,,\n`;
      const buffer = await buildZip({ 'stops.txt': STOPS_CSV, 'routes.txt': csv });
      const { routes } = await parseGtfsZip(buffer);

      expect(routes[0].route_type).toBeNull();
    });
  });
});
