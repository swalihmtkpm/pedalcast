// Lightweight reverse geocoder using OpenStreetMap Nominatim.
// Throttles to one request per ~2s and only refetches when moved >120m.

let lastFetchAt = 0;
let lastLat: number | null = null;
let lastLng: number | null = null;
let lastName: string | null = null;
let inflight: Promise<string | null> | null = null;

function dist(a: [number, number], b: [number, number]) {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const now = Date.now();
  if (
    lastLat != null &&
    lastLng != null &&
    dist([lastLat, lastLng], [lat, lng]) < 120 &&
    lastName
  ) {
    return lastName;
  }
  if (now - lastFetchAt < 2000 && inflight) return inflight;
  lastFetchAt = now;
  inflight = (async () => {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lng}`,
        { headers: { Accept: "application/json" } },
      );
      if (!r.ok) return lastName;
      const j = (await r.json()) as {
        address?: Record<string, string>;
        display_name?: string;
      };
      const a = j.address ?? {};
      const place =
        a.suburb ||
        a.neighbourhood ||
        a.village ||
        a.town ||
        a.city ||
        a.county ||
        a.state ||
        j.display_name?.split(",")[0] ||
        null;
      lastLat = lat;
      lastLng = lng;
      lastName = place ?? lastName;
      return lastName;
    } catch {
      return lastName;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
