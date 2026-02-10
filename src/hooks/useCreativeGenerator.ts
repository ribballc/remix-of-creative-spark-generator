import { useState } from 'react';
import { ProductData, AdCopy, AdTemplate, GeneratedCreative, ConfirmedBrandKit } from '@/types/creative';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { compositeImages, CompositingData, compositeProductOnBackdrop } from '@/utils/imageUtils';

interface ProductColors {
  background: string;
  accent: string;
  text: string;
  cta: string;
}

interface DetectedFonts {
  heading: string[];
  body: string[];
}

export function useCreativeGenerator() {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<string>('');
  const [productData, setProductData] = useState<ProductData | null>(null);
  const [scannedUrl, setScannedUrl] = useState<string>('');
  const [adCopies, setAdCopies] = useState<AdCopy[]>([]);
  const [generatedCreatives, setGeneratedCreatives] = useState<GeneratedCreative[]>([]);
  
  // New states for 4-step flow
  const [productImageBase64, setProductImageBase64] = useState<string | null>(null);
  const [productCutoutBase64, setProductCutoutBase64] = useState<string | null>(null);
  const [productColors, setProductColors] = useState<ProductColors | null>(null);
  const [confirmedBrandKit, setConfirmedBrandKit] = useState<ConfirmedBrandKit | null>(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [studioProductImage, setStudioProductImage] = useState<string | null>(null);
  const [detectedFonts, setDetectedFonts] = useState<DetectedFonts | null>(null);

  // Internal function to generate ad copy
  const generateAdCopyInternal = async (productDataToUse: ProductData): Promise<AdCopy[]> => {
    const { data, error } = await supabase.functions.invoke('generate-ad-copy', {
      body: { productData: productDataToUse }
    });
    if (error) throw error;
    if (data.success && data.adCopies) return data.adCopies;
    throw new Error(data.error || 'Failed to generate ad copy');
  };

  const scanShopifyUrl = async (url: string) => {
    setIsLoading(true);
    setScannedUrl(url);
    setLoadingStage('Connecting to store...');
    
    try {
      const { data, error } = await supabase.functions.invoke('scrape-shopify', {
        body: { url }
      });
      if (error) throw error;
      
      if (data.success && data.productData) {
        setProductData(data.productData);
        setLoadingStage('Generating ad copy...');
        
        try {
          const generatedCopies = await generateAdCopyInternal(data.productData);
          setAdCopies(generatedCopies);
        } catch (adCopyError) {
          console.error('Error generating ad copy:', adCopyError);
          setAdCopies([]);
          toast({
            title: 'Ad copy generation failed',
            description: adCopyError instanceof Error ? adCopyError.message : 'Please try regenerating',
            variant: 'destructive'
          });
        }
        
        // Auto-advance to Step 2 (Upload Product Image)
        setLoadingStage('Complete!');
        setStep(2);
      } else {
        throw new Error(data.error || 'Failed to scan product');
      }
    } catch (error) {
      console.error('Error scanning Shopify URL:', error);
      toast({
        title: 'Error scanning product',
        description: error instanceof Error ? error.message : 'Failed to scan Shopify product page',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
      setLoadingStage('');
    }
  };

  const analyzeProductImage = async (base64: string) => {
    setIsAnalyzingImage(true);
    setProductImageBase64(base64);
    
    try {
      const { data, error } = await supabase.functions.invoke('analyze-product-image', {
        body: { productImageBase64: base64 }
      });
      
      if (error) throw error;
      
      if (data.success && data.dominantColors) {
        setProductColors(data.dominantColors);
        if (data.detectedFonts) {
          setDetectedFonts(data.detectedFonts);
        }
      } else {
        throw new Error(data.error || 'Failed to analyze product image');
      }
    } catch (error) {
      console.error('Error analyzing product image:', error);
      toast({
        title: 'Error analyzing image',
        description: error instanceof Error ? error.message : 'Failed to extract colors',
        variant: 'destructive'
      });
    } finally {
      setIsAnalyzingImage(false);
    }
  };

  const confirmBrandKit = (brandKit: ConfirmedBrandKit) => {
    setConfirmedBrandKit(brandKit);
    setStep(4);
  };

  const generateCreative = async (
    template: AdTemplate,
    productImageUrl: string,
    selectedAdCopy: AdCopy,
    referenceImageUrl?: string
  ) => {
    const creativeId = `creative_${Date.now()}`;
    const rawProductImage = confirmedBrandKit?.productImageBase64 || productImageBase64 || productImageUrl;
    
    setGeneratedCreatives(prev => [...prev, {
      id: creativeId,
      templateId: template.id,
      productImageUrl: rawProductImage,
      adCopy: selectedAdCopy,
      status: 'generating'
    }]);

    try {
      const isReviewTemplate = template.type === 'review';

      // === Step A: Remove background ===
      setLoadingStage('Removing background...');
      console.log('Step A: Removing product background...');
      const { data: bgData, error: bgError } = await supabase.functions.invoke('remove-background', {
        body: { productImageBase64: rawProductImage }
      });
      if (bgError) throw bgError;
      if (!bgData?.success) throw new Error(bgData?.error || 'Background removal failed');
      const cutoutBase64 = bgData.cutoutBase64;
      const cutoutUrl = cutoutBase64.startsWith('data:') ? cutoutBase64 : `data:image/png;base64,${cutoutBase64}`;
      setProductCutoutBase64(cutoutUrl);
      console.log('Background removed successfully');

      // === Step B: Generate creative ===
      setLoadingStage('Creating ad creative...');
      console.log('Step D: Generating creative...');

      // For non-review: send the CUTOUT (transparent bg) to the AI.
      // The AI prompt already generates a studio backdrop, so sending a cutout
      // avoids the double-backdrop problem.
      // For review: the AI skips the product image anyway (product zone is empty),
      // so we send the cutout for reference but it won't be used in the AI output.
      const imageForAI = cutoutUrl;

      const { data, error } = await supabase.functions.invoke('generate-creative', {
        body: {
          template,
          productImageUrl: imageForAI,
          referenceImageUrl,
          adCopy: selectedAdCopy,
          productData,
          confirmedBrandKit
        }
      });

      if (error) throw error;
      
      let finalImageUrl = data.imageUrl;

      // If compositing is enabled, layer product onto AI scene
      if (data.compositing?.enabled) {
        console.log('Compositing product cutout onto scene...');
        try {
          const compositedBase64 = await compositeImages(
            data.imageUrl,
            cutoutUrl,
            data.compositing as CompositingData
          );
          finalImageUrl = compositedBase64;
        } catch (compErr) {
          console.error('Compositing failed, using AI output as-is:', compErr);
        }
      }

      // Strip any transparency to avoid white borders — output as solid JPEG
      try {
        const { stripTransparency } = await import('@/utils/imageUtils');
        finalImageUrl = await stripTransparency(finalImageUrl);
      } catch (stripErr) {
        console.error('Strip transparency failed:', stripErr);
      }

      
      setGeneratedCreatives(prev => prev.map(c => 
        c.id === creativeId 
          ? { ...c, outputImageUrl: finalImageUrl, status: 'completed' as const }
          : c
      ));

      toast({ title: 'Creative generated!', description: 'Your ad creative is ready' });
    } catch (error) {
      console.error('Error generating creative:', error);
      setGeneratedCreatives(prev => prev.map(c => 
        c.id === creativeId ? { ...c, status: 'error' as const } : c
      ));
      toast({
        title: 'Error generating creative',
        description: error instanceof Error ? error.message : 'Failed to generate creative',
        variant: 'destructive'
      });
    } finally {
      setLoadingStage('');
    }
  };

  const nextStep = () => setStep(prev => Math.min(prev + 1, 4));
  const prevStep = () => setStep(prev => Math.max(prev - 1, 1));

  return {
    step,
    setStep,
    isLoading,
    loadingStage,
    productData,
    adCopies,
    generatedCreatives,
    productImageBase64,
    productCutoutBase64,
    productColors,
    confirmedBrandKit,
    isAnalyzingImage,
    studioProductImage,
    detectedFonts,
    scanShopifyUrl,
    analyzeProductImage,
    confirmBrandKit,
    generateCreative,
    nextStep,
    prevStep
  };
}
