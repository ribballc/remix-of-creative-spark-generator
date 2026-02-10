-- Enable realtime for the generated_creatives table so the gallery updates live
ALTER PUBLICATION supabase_realtime ADD TABLE public.generated_creatives;