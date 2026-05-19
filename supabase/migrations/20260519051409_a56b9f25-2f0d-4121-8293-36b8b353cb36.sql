
ALTER TABLE public.live_session
  ADD COLUMN IF NOT EXISTS distance_km double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS place_name text;

CREATE TABLE IF NOT EXISTS public.recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'Untitled ride',
  storage_path text NOT NULL,
  duration_seconds integer NOT NULL DEFAULT 0,
  distance_km double precision NOT NULL DEFAULT 0,
  size_bytes bigint NOT NULL DEFAULT 0,
  mime_type text NOT NULL DEFAULT 'video/webm',
  started_at timestamptz,
  ended_at timestamptz,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recordings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view public recordings" ON public.recordings;
CREATE POLICY "Public can view public recordings"
  ON public.recordings FOR SELECT
  USING (is_public = true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('recordings', 'recordings', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public can read recordings bucket" ON storage.objects;
CREATE POLICY "Public can read recordings bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'recordings');
