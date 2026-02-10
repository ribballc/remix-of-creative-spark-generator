-- Create a table to store generated creatives
CREATE TABLE public.generated_creatives (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  image_url TEXT NOT NULL,
  template_id TEXT,
  product_title TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS but allow public read access (anyone can see the gallery)
ALTER TABLE public.generated_creatives ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view creatives (public gallery)
CREATE POLICY "Anyone can view generated creatives" 
ON public.generated_creatives 
FOR SELECT 
USING (true);

-- Allow inserts from service role (edge function)
CREATE POLICY "Service role can insert creatives" 
ON public.generated_creatives 
FOR INSERT 
WITH CHECK (true);

-- Create storage bucket for generated images
INSERT INTO storage.buckets (id, name, public) 
VALUES ('generated-creatives', 'generated-creatives', true);

-- Allow public read access to the bucket
CREATE POLICY "Public read access for generated creatives"
ON storage.objects
FOR SELECT
USING (bucket_id = 'generated-creatives');

-- Allow service role to upload
CREATE POLICY "Service role can upload generated creatives"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'generated-creatives');