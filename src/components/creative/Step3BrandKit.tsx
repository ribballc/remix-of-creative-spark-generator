import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, ArrowRight, Palette, Pencil, Upload } from 'lucide-react';
import { ConfirmedBrandKit } from '@/types/creative';

interface Step3Props {
  websiteColors: { primary: string; secondary: string; accent: string } | null;
  productColors: { background: string; accent: string; text: string; cta: string } | null;
  typography: { headingFont: string | null; bodyFont: string | null; fontStacks?: { heading?: string[]; body?: string[] } | null } | null;
  logo: string | null;
  productImageBase64: string | null;
  detectedFonts: { heading: string[]; body: string[] } | null;
  onConfirm: (brandKit: ConfirmedBrandKit) => void;
  onPrev: () => void;
}

export function Step3BrandKit({
  websiteColors,
  productColors,
  typography,
  logo,
  productImageBase64,
  detectedFonts,
  onConfirm,
  onPrev,
}: Step3Props) {
  const [colors, setColors] = useState({
    background: productColors?.background || websiteColors?.primary || '#F5F5F5',
    accent: productColors?.accent || websiteColors?.accent || '#4A90D9',
    text: productColors?.text || websiteColors?.secondary || '#1A1A2E',
    cta: '#E84855', // keep internally but not shown
  });

  // Default to website font; fall back to product-detected font only if website didn't find one
  const websiteHeading = typography?.headingFont;
  const websiteBody = typography?.bodyFont;
  const productHeading = detectedFonts?.heading?.[0] || null;
  const productBody = detectedFonts?.body?.[0] || null;

  const [headingFont, setHeadingFont] = useState(
    websiteHeading || productHeading || 'Sans-serif'
  );
  const [bodyFont, setBodyFont] = useState(
    websiteBody || productBody || headingFont
  );
  const [logoUrl, setLogoUrl] = useState(logo || '');
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Build font options from website stacks + product-detected fonts + current selection
  const headingOptions = Array.from(new Set([
    headingFont,
    ...(typography?.fontStacks?.heading || []),
    ...(detectedFonts?.heading || []),
  ].filter(Boolean))) as string[];

  const bodyOptions = Array.from(new Set([
    bodyFont,
    ...(typography?.fontStacks?.body || []),
    ...(detectedFonts?.body || []),
  ].filter(Boolean))) as string[];

  const handleColorChange = (key: keyof typeof colors, value: string) => {
    setColors(prev => ({ ...prev, [key]: value }));
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setLogoUrl(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleConfirm = () => {
    onConfirm({
      colors,
      typography: {
        headingFont,
        bodyFont,
        h1Weight: 700,
        h2Weight: 500,
        bodyWeight: 400,
      },
      logo: logoUrl,
      productImageBase64: productImageBase64 || '',
    });
  };

  const colorFields: { key: keyof Pick<typeof colors, 'background' | 'accent' | 'text'>; label: string }[] = [
    { key: 'background', label: 'Background' },
    { key: 'accent', label: 'Accent' },
    { key: 'text', label: 'Text' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <Palette className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Brand Kit</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Review and adjust your brand identity before generating creatives.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Colors - editable */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-foreground uppercase tracking-wider">Colors</h4>
            <div className="grid grid-cols-3 gap-3">
              {colorFields.map(({ key, label }) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">{label}</label>
                  <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-2 py-1.5 border border-border">
                    <input
                      type="color"
                      value={colors[key]}
                      onChange={(e) => handleColorChange(key, e.target.value)}
                      className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent"
                    />
                    <Input
                      value={colors[key]}
                      onChange={(e) => handleColorChange(key, e.target.value)}
                      className="h-7 text-xs font-mono bg-transparent border-0 p-0"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Typography - dropdown selection */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground uppercase tracking-wider">Typography</h4>
              <Pencil className="w-3 h-3 text-muted-foreground" />
            </div>
            <div className="space-y-3">
              <div className="bg-secondary/30 rounded-lg px-4 py-3 border border-border">
                <label className="text-xs text-muted-foreground mb-1 block">Heading Font</label>
                {headingOptions.length > 1 ? (
                  <Select value={headingFont} onValueChange={setHeadingFont}>
                    <SelectTrigger className="h-8 text-sm font-semibold bg-transparent border-0 p-0">
                      <SelectValue placeholder="Select font" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border border-border z-50">
                      {headingOptions.map((font) => (
                        <SelectItem key={font} value={font}>{font}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={headingFont}
                    onChange={(e) => setHeadingFont(e.target.value)}
                    className="h-8 text-sm font-semibold bg-transparent border-0 p-0"
                    placeholder="e.g. Poppins"
                  />
                )}
                <p className="text-xs text-muted-foreground mt-0.5">Weight: 700 (H1) · 500 (H2)</p>
              </div>
              <div className="bg-secondary/30 rounded-lg px-4 py-3 border border-border">
                <label className="text-xs text-muted-foreground mb-1 block">Body Font</label>
                {bodyOptions.length > 1 ? (
                  <Select value={bodyFont} onValueChange={setBodyFont}>
                    <SelectTrigger className="h-8 text-sm bg-transparent border-0 p-0">
                      <SelectValue placeholder="Select font" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border border-border z-50">
                      {bodyOptions.map((font) => (
                        <SelectItem key={font} value={font}>{font}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={bodyFont}
                    onChange={(e) => setBodyFont(e.target.value)}
                    className="h-8 text-sm bg-transparent border-0 p-0"
                    placeholder="e.g. Inter"
                  />
                )}
                <p className="text-xs text-muted-foreground mt-0.5">Weight: 400</p>
              </div>
            </div>
          </div>
        </div>

        {/* Logo + Product preview row */}
        <div className="mt-6 pt-6 border-t border-border grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs text-muted-foreground uppercase tracking-wider">Logo</h4>
              <Pencil className="w-3 h-3 text-muted-foreground" />
            </div>
            <div
              onClick={() => logoInputRef.current?.click()}
              className="bg-secondary/30 rounded-lg p-3 border border-border flex items-center justify-center h-20 cursor-pointer hover:border-primary/40 transition-colors relative group"
            >
              {logoUrl ? (
                <>
                  <img src={logoUrl} alt="Logo" className="max-h-full max-w-full object-contain" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 rounded-lg">
                    <Upload className="w-4 h-4 text-white" />
                  </div>
                </>
              ) : (
                <div className="text-center">
                  <Upload className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
                  <p className="text-xs text-muted-foreground">Upload logo</p>
                </div>
              )}
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
            </div>
          </div>
          {productImageBase64 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs text-muted-foreground uppercase tracking-wider">Product</h4>
              </div>
              <div className="bg-secondary/30 rounded-lg p-3 border border-border flex items-center justify-center h-20">
                <img src={productImageBase64} alt="Product" className="max-h-full max-w-full object-contain" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onPrev} className="h-11 px-6 rounded-xl font-medium">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button onClick={handleConfirm} className="h-11 px-6 rounded-xl font-medium">
          Confirm & Generate
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
