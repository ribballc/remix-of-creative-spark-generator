import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AD_TEMPLATES, AdTemplate, AdCopy, GeneratedCreative, FeatureBenefitCallout } from '@/types/creative';
import { ImagePlus, Sparkles, Download, ArrowLeft, Upload, AlertCircle } from 'lucide-react';
import { imageUrlToBase64, fileToBase64 } from '@/utils/imageUtils';
import { cn } from '@/lib/utils';

// Import reference images for each type and aspect ratio
import refFeaturesBenefits916 from '@/assets/ref-features-benefits-916.jpg';
import refFeaturesBenefits1080 from '@/assets/ref-features-benefits-1080.jpg';
import refComparison1080 from '@/assets/ref-comparison-1080.jpg';
import refReview916 from '@/assets/ref-review-916.jpg';
import refReview1080 from '@/assets/ref-review-1080.jpg';
import refBenefits916 from '@/assets/ref-benefits-916.jpg';
import refBenefits1080 from '@/assets/ref-benefits-1080.jpg';

// Reference images mapping by template ID
const REFERENCE_IMAGES: Record<string, string> = {
  'features_benefits_916': refFeaturesBenefits916,
  'features_benefits_11': refFeaturesBenefits1080,
  'comparison_916': refComparison1080,
  'comparison_11': refComparison1080,
  'review_916': refReview916,
  'review_11': refReview1080,
  'benefits_916': refBenefits916,
  'benefits_11': refBenefits1080
};

interface Step3Props {
  adCopies: AdCopy[];
  generatedCreatives: GeneratedCreative[];
  onGenerateCreative: (template: AdTemplate, productImageUrl: string, adCopy: AdCopy, referenceImageUrl?: string) => Promise<void>;
  onPrev: () => void;
  productImageBase64?: string | null;
  loadingStage?: string;
}

interface UnifiedTemplateCardProps {
  templateType: 'features_benefits' | 'comparison' | 'review' | 'benefits';
  title: string;
  description: string;
  adCopies: AdCopy[];
  onGenerate: (template: AdTemplate, productImageUrl: string, adCopy: AdCopy, referenceImageUrl?: string) => Promise<void>;
  generatedCreatives: GeneratedCreative[];
  disabled?: boolean;
  disabledReason?: string;
  globalProductImage?: string | null;
}

function UnifiedTemplateCard({ 
  templateType, 
  title, 
  description,
  adCopies, 
  onGenerate, 
  generatedCreatives,
  disabled = false,
  disabledReason,
  globalProductImage
}: UnifiedTemplateCardProps) {
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '1:1'>('9:16');
  const [productImageUrl, setProductImageUrl] = useState(globalProductImage || '');
  const [productImageFile, setProductImageFile] = useState<File | null>(null);
  const [selectedCopyIndex, setSelectedCopyIndex] = useState<string>('0');
  const [isGenerating, setIsGenerating] = useState(false);
  
  const hasGlobalImage = !!globalProductImage;

  // Get the template based on type and aspect ratio
  const templateId = aspectRatio === '9:16' 
    ? `${templateType}_916` 
    : `${templateType}_11`;
  
  const template = AD_TEMPLATES.find(t => t.id === templateId) || AD_TEMPLATES[0];
  const referenceImage = REFERENCE_IMAGES[templateId] || refFeaturesBenefits1080;

  // Safely filter adCopies - features_benefits includes feature, benefit, and features_benefits types
  const relevantCopies = Array.isArray(adCopies) 
    ? adCopies.filter(copy => {
        if (templateType === 'features_benefits') {
          return copy.type === 'feature' || copy.type === 'benefit' || copy.type === 'features_benefits';
        }
        if (templateType === 'benefits') return copy.type === 'benefit' || copy.type === 'features_benefits';
        if (templateType === 'comparison') return copy.type === 'comparison';
        if (templateType === 'review') return copy.type === 'review';
        return false;
      })
    : [];

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setProductImageFile(file);
      setProductImageUrl(URL.createObjectURL(file));
    }
  };

  const handleGenerate = async () => {
    const imageSource = hasGlobalImage ? globalProductImage! : (productImageFile ? '' : productImageUrl);
    if (!hasGlobalImage && !productImageUrl && !productImageFile) return;
    if (!relevantCopies[parseInt(selectedCopyIndex)]) return;
    setIsGenerating(true);
    try {
      let productBase64: string;
      if (hasGlobalImage) {
        productBase64 = globalProductImage!;
      } else {
        productBase64 = productImageFile 
          ? await fileToBase64(productImageFile)
          : await imageUrlToBase64(productImageUrl);
      }
      
      // Reference image conversion with error handling
      let referenceBase64: string | undefined;
      try {
        referenceBase64 = await imageUrlToBase64(referenceImage);
      } catch (err) {
        console.warn('Could not convert reference image, proceeding without it:', err);
        referenceBase64 = undefined;
      }
      
      await onGenerate(template, productBase64, relevantCopies[parseInt(selectedCopyIndex)], referenceBase64);
    } finally {
      setIsGenerating(false);
    }
  };

  const templateCreatives = generatedCreatives.filter(c => c.templateId === template.id);
  const latestCreative = templateCreatives[templateCreatives.length - 1];
  const selectedCopy = relevantCopies[parseInt(selectedCopyIndex)];

  if (disabled) {
    return (
      <div className="bg-card/50 border border-border rounded-2xl overflow-hidden opacity-60">
        <div className="px-6 py-4 border-b border-border bg-secondary/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-muted-foreground" />
              <div>
                <h3 className="text-lg font-semibold text-muted-foreground">{title}</h3>
                <p className="text-sm text-muted-foreground/70 mt-0.5">{disabledReason || 'Not available for this product'}</p>
              </div>
            </div>
          </div>
        </div>
        <div className="p-6">
          <div className="flex items-center justify-center gap-4 py-8">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-3">
                <AlertCircle className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground max-w-xs">
                {disabledReason || 'This template requires data that is not available for the current product.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleDownload = () => {
    const url = latestCreative?.outputImageUrl;
    if (url) {
      fetch(url)
        .then(res => res.blob())
        .then(blob => {
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = `creative-${template.id}-${Date.now()}.jpg`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(blobUrl);
        });
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-secondary/30">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          </div>
          
          {/* Aspect Ratio Toggle */}
          <div className="flex items-center gap-1 bg-secondary rounded-lg p-1">
            <button
              onClick={() => setAspectRatio('9:16')}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-md transition-all",
                aspectRatio === '9:16' 
                  ? "bg-primary text-primary-foreground" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              9:16
            </button>
            <button
              onClick={() => setAspectRatio('1:1')}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-md transition-all",
                aspectRatio === '1:1' 
                  ? "bg-primary text-primary-foreground" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              1:1
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {/* Image Preview Row - Stacks on mobile */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
          {/* Reference Image */}
          <div className="flex-1 w-full space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider text-center block">Reference</Label>
            <div 
              className={cn(
                "border border-border rounded-xl overflow-hidden bg-secondary/50 mx-auto",
                aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-square',
                "sm:max-w-none max-w-[200px]"
              )}
            >
              <img
                src={referenceImage}
                alt="Reference"
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          {/* Plus Sign */}
          <div className="text-2xl font-bold text-primary sm:mt-6 shrink-0">+</div>

          {/* Product Image */}
          <div className="flex-1 w-full space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider text-center block">Product</Label>
            <div 
              className={cn(
                "border rounded-xl flex items-center justify-center bg-secondary/30 relative overflow-hidden transition-colors mx-auto",
                hasGlobalImage ? "border-primary/50" : "border-2 border-dashed",
                !hasGlobalImage && (productImageUrl ? "border-primary/50" : "border-border hover:border-primary/30"),
                aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-square',
                "sm:max-w-none max-w-[200px]"
              )}
            >
              {hasGlobalImage ? (
                <img
                  src={globalProductImage!}
                  alt="Product"
                  className="w-full h-full object-contain p-2 rounded-xl"
                />
              ) : productImageUrl ? (
                <>
                  <img
                    src={productImageUrl}
                    alt="Product"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <label className="absolute inset-0 cursor-pointer bg-black/0 hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                    <Upload className="w-5 h-5 text-white" />
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                </>
              ) : (
                <label className="cursor-pointer text-center p-2 w-full h-full flex flex-col items-center justify-center group">
                  <ImagePlus className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors mb-1" />
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">Upload</span>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          {/* Equals Sign */}
          <div className="text-2xl font-bold text-primary sm:mt-6 shrink-0">=</div>

          {/* Output Creative */}
          <div className="flex-1 w-full space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider text-center block">Output</Label>
            <div 
              className={cn(
                "border border-border rounded-xl flex items-center justify-center bg-gradient-to-br from-secondary/50 to-muted/50 overflow-hidden relative mx-auto",
                aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-square',
                "sm:max-w-none max-w-[200px]"
              )}
            >
              {latestCreative?.status === 'completed' ? (
                <>
                  <div className="absolute inset-0 bg-white" />
                  <img
                    src={latestCreative.outputImageUrl}
                    alt="Generated"
                    className="w-full h-full object-contain relative z-10"
                  />
                  <Button
                    size="icon"
                    variant="secondary"
                    className="absolute bottom-2 right-2 h-7 w-7 rounded-lg shadow-lg z-20"
                    onClick={handleDownload}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                </>
              ) : latestCreative?.status === 'generating' ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  <span className="text-xs text-muted-foreground">Generating...</span>
                </div>
              ) : latestCreative?.status === 'error' ? (
                <div className="flex flex-col items-center gap-2 p-3">
                  <AlertCircle className="w-6 h-6 text-destructive" />
                  <span className="text-xs text-destructive font-medium">Generation failed</span>
                  <span className="text-xs text-muted-foreground">Click Generate to retry</span>
                </div>
              ) : (
                <div className="text-center p-3">
                  <Sparkles className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                  <span className="text-xs text-muted-foreground">Output</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Ad Copy & Generate Row */}
        <div className="flex items-center gap-4">
          {/* Ad Copy Dropdown with Preview */}
          <div className="flex-1">
          <Select value={selectedCopyIndex} onValueChange={setSelectedCopyIndex}>
              <SelectTrigger className="h-12 bg-secondary/50 border-border rounded-xl text-left">
                <div className="flex flex-col items-start gap-0.5 overflow-hidden">
                  {selectedCopy ? (
                    <>
                      <span className="font-medium text-sm truncate w-full">
                        {selectedCopy.headline_primary || selectedCopy.headline}
                      </span>
                      {(selectedCopy.subheadline_primary || selectedCopy.subheadline) && (
                        <span className="text-xs text-muted-foreground truncate w-full">
                          {selectedCopy.subheadline_primary || selectedCopy.subheadline}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Select ad copy...</span>
                  )}
                </div>
              </SelectTrigger>
              <SelectContent className="max-w-[500px] bg-card border-border rounded-xl">
                {relevantCopies.map((copy, index) => (
                  <SelectItem key={index} value={index.toString()} className="py-3">
                    <div className="flex flex-col gap-1.5 text-left">
                      <span className="font-medium">
                        {copy.headline_primary || copy.headline}
                      </span>
                      {(copy.subheadline_primary || copy.subheadline) && (
                        <span className="text-muted-foreground text-xs">
                          {copy.subheadline_primary || copy.subheadline}
                        </span>
                      )}
                      {copy.feature_benefits && copy.feature_benefits.length > 0 && (
                        <div className="flex flex-col gap-0.5 mt-1 pl-1 border-l-2 border-primary/30">
                          {copy.feature_benefits.slice(0, 4).map((fb, i) => (
                            <span key={i} className="text-xs text-muted-foreground">
                              {fb.text} <span className="text-primary/50">({fb.meaning_keywords.split(',')[0].trim()})</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {!copy.feature_benefits && copy.bulletPoints && copy.bulletPoints.length > 0 && (
                        <div className="flex flex-col gap-0.5 mt-1 pl-1 border-l-2 border-primary/30">
                          {copy.bulletPoints.slice(0, 4).map((point, i) => (
                            <span key={i} className="text-xs text-muted-foreground">{point}</span>
                          ))}
                        </div>
                      )}
                      {copy.type === 'review' && copy.rating && (
                        <span className="text-xs text-accent">★ {copy.rating} · {copy.reviewCount}+ reviews</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={isGenerating || (!hasGlobalImage && !productImageUrl) || !selectedCopy}
            size="lg"
            className="h-12 px-6 rounded-xl font-semibold gap-2 shrink-0"
          >
            {isGenerating ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Step3AdTemplates({ adCopies, generatedCreatives, onGenerateCreative, onPrev, productImageBase64, loadingStage }: Step3Props) {
  const hasReviews = Array.isArray(adCopies) && adCopies.some(copy => copy.type === 'review');
  const hasComparison = Array.isArray(adCopies) && adCopies.some(copy => copy.type === 'comparison');
  const hasBenefits = Array.isArray(adCopies) && adCopies.some(copy => copy.type === 'benefit' || copy.type === 'features_benefits');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Loading stage banner */}
      {loadingStage && (
        <div className="flex items-center justify-center gap-2 py-3 px-4 bg-primary/10 border border-primary/20 rounded-xl mb-4">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-primary font-medium">{loadingStage}</span>
        </div>
      )}

      <UnifiedTemplateCard
        templateType="features_benefits"
        title="Features & Benefits"
        description="Highlight key product features and their benefits"
        adCopies={adCopies}
        onGenerate={onGenerateCreative}
        generatedCreatives={generatedCreatives}
        globalProductImage={productImageBase64}
      />

      <UnifiedTemplateCard
        templateType="comparison"
        title="Us vs Them"
        description="Side-by-side comparison highlighting your advantages"
        adCopies={adCopies}
        onGenerate={onGenerateCreative}
        generatedCreatives={generatedCreatives}
        disabled={!hasComparison}
        disabledReason="No comparison data generated"
        globalProductImage={productImageBase64}
      />

      <UnifiedTemplateCard
        templateType="review"
        title="Customer Review"
        description="Build trust with social proof and customer testimonials"
        adCopies={adCopies}
        onGenerate={onGenerateCreative}
        generatedCreatives={generatedCreatives}
        disabled={!hasReviews}
        disabledReason="No reviews found on the product page"
        globalProductImage={productImageBase64}
      />

      <UnifiedTemplateCard
        templateType="benefits"
        title="Pure Benefits"
        description="Focus purely on product benefits with clean layout"
        adCopies={adCopies}
        onGenerate={onGenerateCreative}
        generatedCreatives={generatedCreatives}
        disabled={!hasBenefits}
        disabledReason="No benefit copy generated"
        globalProductImage={productImageBase64}
      />

      <div className="pt-4">
        <Button 
          variant="outline" 
          onClick={onPrev} 
          className="h-11 px-6 rounded-xl font-medium"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
      </div>
    </div>
  );
}
