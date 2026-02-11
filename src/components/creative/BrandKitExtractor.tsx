import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ExtractedBrandKit, BrandKitExtractionOptions } from '@/types/brandKit';
import { ProductData } from '@/types/creative';
import { Globe, Sparkles, ChevronDown, RefreshCw, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface BrandKitExtractorProps {
  onExtracted: (brandKit: ExtractedBrandKit) => void;
  extractedBrandKit: ExtractedBrandKit | null;
  productData?: ProductData | null;
  scannedUrl?: string;
}

export function BrandKitExtractor({ onExtracted, extractedBrandKit, productData, scannedUrl }: BrandKitExtractorProps) {
  const { toast } = useToast();
  const [brandUrl, setBrandUrl] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [hasAutoPopulated, setHasAutoPopulated] = useState(false);
  const [options, setOptions] = useState<BrandKitExtractionOptions>({
    forceLightMode: true,
    preferCssVars: true,
    fallbackImageSampling: true,
  });

  // Pre-populate from product scan data
  useEffect(() => {
    if (productData?.brandColors && !hasAutoPopulated && !extractedBrandKit) {
      const autoExtracted: ExtractedBrandKit = {
        sourceUrl: scannedUrl || '',
        background: productData.brandColors.primary || '#FFFFFF',
        surface: adjustLightness(productData.brandColors.primary || '#FFFFFF', -5),
        textPrimary: productData.brandColors.secondary || '#1F1F1F',
        textSecondary: '#6B6B6B',
        accentPrimary: productData.brandColors.accent || '#FF6B35',
        accentSecondary: adjustLightness(productData.brandColors.accent || '#FF6B35', 20),
        border: '#E5E5E5',
        icon: productData.brandColors.accent || '#FF6B35',
        rating: productData.brandColors.secondary || '#1F1F1F',
        ctaBg: productData.brandColors.secondary || '#1F1F1F',
        ctaText: '#FFFFFF',
        fonts: {
          heading: (productData.fonts as any)?.find((f: any) => f.role === 'heading')?.family || 'Inter',
          body: (productData.fonts as any)?.find((f: any) => f.role === 'body')?.family || 'Inter',
        },
        logoUrl: productData.logo || '',
        confidence: { background: 85, text: 85, accent: 85 },
        rawCandidates: {
          backgrounds: [productData.brandColors.primary || '#FFFFFF'],
          texts: [productData.brandColors.secondary || '#1F1F1F'],
          accents: [productData.brandColors.accent || '#FF6B35'],
        },
      };
      
      onExtracted(autoExtracted);
      setHasAutoPopulated(true);
      
      // Pre-fill the URL field with scanned URL or derive homepage
      if (scannedUrl) {
        try {
          const url = new URL(scannedUrl);
          setBrandUrl(url.origin);
        } catch {
          setBrandUrl(scannedUrl);
        }
      }
    }
  }, [productData, hasAutoPopulated, extractedBrandKit, scannedUrl, onExtracted]);

  const handleExtract = async () => {
    if (!brandUrl.trim()) {
      toast({
        title: 'URL Required',
        description: 'Please enter a brand website URL',
        variant: 'destructive',
      });
      return;
    }

    setIsExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke('extract-brand-kit', {
        body: {
          url: brandUrl,
          forceLightMode: options.forceLightMode,
          preferCssVars: options.preferCssVars,
          fallbackImageSampling: options.fallbackImageSampling,
        },
      });

      if (error) throw error;

      if (data.success && data.brandKit) {
        onExtracted(data.brandKit);
        toast({
          title: 'Brand Kit Extracted!',
          description: 'Colors and fonts have been auto-populated',
        });
      } else {
        throw new Error(data.error || 'Failed to extract brand kit');
      }
    } catch (error) {
      console.error('Error extracting brand kit:', error);
      toast({
        title: 'Extraction Failed',
        description: error instanceof Error ? error.message : 'Failed to extract brand kit',
        variant: 'destructive',
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const getConfidenceLabel = (value: number) => {
    if (value >= 80) return { label: 'High', color: 'text-green-500' };
    if (value >= 60) return { label: 'Medium', color: 'text-yellow-500' };
    return { label: 'Low', color: 'text-orange-500' };
  };

  return (
    <Card className="border-border bg-card transition-all duration-300 hover:border-primary/30">
      <CardHeader className="text-center">
        <CardTitle className="flex items-center justify-center gap-2 text-foreground">
          <Globe className="w-5 h-5 text-primary" />
          Brand Kit Extractor
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {productData?.brandColors 
            ? 'Brand colors auto-extracted from product page. Regenerate from a different URL if needed.'
            : 'Automatically extract brand colors and typography from any website'
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Auto-populated notice */}
        {hasAutoPopulated && (
          <div className="flex items-start gap-2 p-3 bg-primary/10 rounded-xl border border-primary/20 text-sm">
            <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <span className="text-foreground">
              Colors auto-populated from your product page scan. Use the URL field below to extract from a different brand website.
            </span>
          </div>
        )}

        {/* URL Input */}
        <div className="space-y-2">
          <Label htmlFor="brandUrl" className="text-foreground">Brand Website URL</Label>
          <Input
            id="brandUrl"
            type="url"
            placeholder="https://example.com or https://example.com/products/item"
            value={brandUrl}
            onChange={(e) => setBrandUrl(e.target.value)}
            className="bg-secondary border-border text-foreground h-12 rounded-xl"
          />
          <p className="text-xs text-muted-foreground">
            Tip: Product page URLs often work better than homepages
          </p>
        </div>

        {/* Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex items-center justify-between p-3 bg-secondary rounded-xl border border-border">
            <Label htmlFor="forceLightMode" className="text-sm text-foreground cursor-pointer">
              Force Light Mode
            </Label>
            <Switch
              id="forceLightMode"
              checked={options.forceLightMode}
              onCheckedChange={(checked) => setOptions(prev => ({ ...prev, forceLightMode: checked }))}
            />
          </div>
          <div className="flex items-center justify-between p-3 bg-secondary rounded-xl border border-border">
            <Label htmlFor="preferCssVars" className="text-sm text-foreground cursor-pointer">
              Prefer CSS Variables
            </Label>
            <Switch
              id="preferCssVars"
              checked={options.preferCssVars}
              onCheckedChange={(checked) => setOptions(prev => ({ ...prev, preferCssVars: checked }))}
            />
          </div>
          <div className="flex items-center justify-between p-3 bg-secondary rounded-xl border border-border">
            <Label htmlFor="fallbackImageSampling" className="text-sm text-foreground cursor-pointer">
              Fallback Image Sampling
            </Label>
            <Switch
              id="fallbackImageSampling"
              checked={options.fallbackImageSampling}
              onCheckedChange={(checked) => setOptions(prev => ({ ...prev, fallbackImageSampling: checked }))}
            />
          </div>
        </div>

        {/* Generate Button */}
        <Button
          onClick={handleExtract}
          disabled={isExtracting}
          size="lg"
          variant={extractedBrandKit ? "outline" : "default"}
          className={cn(
            "w-full rounded-xl px-8 font-semibold text-base h-12 transition-all duration-300",
            !isExtracting && !extractedBrandKit && "hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/25"
          )}
        >
          {isExtracting ? (
            <div className="flex items-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Extracting Brand Kit...</span>
            </div>
          ) : extractedBrandKit ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              Re-extract from URL
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Generate Brand Kit
            </>
          )}
        </Button>

        {/* Extracted Results */}
        {extractedBrandKit && (
          <div className="space-y-4 animate-fade-in">
            {/* Confidence Indicators */}
            <div className="flex items-center justify-between p-3 bg-secondary rounded-xl border border-border">
              <span className="text-sm text-muted-foreground">Extraction Confidence:</span>
              <div className="flex gap-4">
                {(['background', 'text', 'accent'] as const).map((key) => {
                  const conf = getConfidenceLabel(extractedBrandKit.confidence[key]);
                  return (
                    <div key={key} className="flex items-center gap-1">
                      {extractedBrandKit.confidence[key] >= 70 ? (
                        <CheckCircle2 className={cn("w-3 h-3", conf.color)} />
                      ) : (
                        <AlertCircle className={cn("w-3 h-3", conf.color)} />
                      )}
                      <span className={cn("text-xs capitalize", conf.color)}>
                        {key}: {conf.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Color Preview */}
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <div
                  className="w-full h-12 rounded-lg border border-border"
                  style={{ backgroundColor: extractedBrandKit.background }}
                />
                <span className="text-xs text-muted-foreground mt-1 block">Background</span>
              </div>
              <div className="text-center">
                <div
                  className="w-full h-12 rounded-lg border border-border"
                  style={{ backgroundColor: extractedBrandKit.textPrimary }}
                />
                <span className="text-xs text-muted-foreground mt-1 block">Text</span>
              </div>
              <div className="text-center">
                <div
                  className="w-full h-12 rounded-lg border border-border"
                  style={{ backgroundColor: extractedBrandKit.accentPrimary }}
                />
                <span className="text-xs text-muted-foreground mt-1 block">Accent</span>
              </div>
            </div>

            {/* Fonts Preview */}
            <div className="p-3 bg-secondary rounded-xl border border-border">
              <span className="text-xs text-muted-foreground">Fonts: </span>
              <span className="text-sm text-foreground">
                {extractedBrandKit.fonts.heading} / {extractedBrandKit.fonts.body}
              </span>
            </div>

            {/* Debug Panel */}
            <Collapsible open={showDebug} onOpenChange={setShowDebug}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <span className="text-xs text-muted-foreground">Raw Candidates (Debug)</span>
                  <ChevronDown className={cn("w-4 h-4 transition-transform", showDebug && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 pt-2">
                <div className="text-xs space-y-2 p-3 bg-secondary/50 rounded-lg font-mono">
                  <div>
                    <span className="text-muted-foreground">Backgrounds:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {extractedBrandKit.rawCandidates.backgrounds.map((c, i) => (
                        <div
                          key={i}
                          className="w-6 h-6 rounded border border-border"
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Texts:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {extractedBrandKit.rawCandidates.texts.map((c, i) => (
                        <div
                          key={i}
                          className="w-6 h-6 rounded border border-border"
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Accents:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {extractedBrandKit.rawCandidates.accents.map((c, i) => (
                        <div
                          key={i}
                          className="w-6 h-6 rounded border border-border"
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Helper function for color adjustment
function adjustLightness(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  hsl.l = Math.max(0, Math.min(100, hsl.l + amount));
  
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;
  
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  
  return '#' + [r * 255, g * 255, b * 255].map(x => {
    const hex = Math.round(x).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    };
  }
  return null;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
