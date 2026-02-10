export interface ExtractedBrandKit {
  sourceUrl: string;
  background: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  accentPrimary: string;
  accentSecondary: string;
  border: string;
  icon: string;
  rating: string;
  ctaBg: string;
  ctaText: string;
  fonts: { heading: string; body: string };
  logoUrl: string;
  confidence: { background: number; text: number; accent: number };
  rawCandidates: { backgrounds: string[]; texts: string[]; accents: string[] };
}

export interface BrandKitExtractionOptions {
  forceLightMode: boolean;
  preferCssVars: boolean;
  fallbackImageSampling: boolean;
}
