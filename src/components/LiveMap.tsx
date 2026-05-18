import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Props = {
  lat: number | null;
  lng: number | null;
  trail?: Array<[number, number]>;
};

const bikeIcon = L.divIcon({
  className: "",
  html: `<div style="
    width:22px;height:22px;border-radius:9999px;
    background:oklch(0.88 0.21 125);
    border:3px solid oklch(0.16 0.012 250);
    box-shadow:0 0 0 4px oklch(0.88 0.21 125 / 0.35),0 4px 14px oklch(0 0 0 / 0.4);
  "></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export function LiveMap({ lat, lng, trail = [] }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const polyRef = useRef<L.Polyline | null>(null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const m = L.map(elRef.current, {
      center: [lat ?? 20, lng ?? 0],
      zoom: lat && lng ? 16 : 2,
      zoomControl: true,
      attributionControl: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(m);
    mapRef.current = m;
    return () => {
      m.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || lat == null || lng == null) return;
    if (!markerRef.current) {
      markerRef.current = L.marker([lat, lng], { icon: bikeIcon }).addTo(m);
      m.setView([lat, lng], 16);
    } else {
      markerRef.current.setLatLng([lat, lng]);
      m.panTo([lat, lng]);
    }
  }, [lat, lng]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    polyRef.current?.remove();
    if (trail.length > 1) {
      polyRef.current = L.polyline(trail, {
        color: "oklch(0.88 0.21 125)",
        weight: 4,
        opacity: 0.85,
      }).addTo(m);
    }
  }, [trail]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border">
      <div ref={elRef} className="h-full w-full" />
      {lat == null && (
        <div className="absolute inset-0 flex items-center justify-center bg-card/60 text-sm text-muted-foreground backdrop-blur">
          Waiting for GPS signal…
        </div>
      )}
    </div>
  );
}
