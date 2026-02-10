import { useState } from 'react';
import { ProductData, AdCopy, AdTemplate, GeneratedCreative, ConfirmedBrandKit } from '@/types/creative';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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
  
  const [productImageBase64, setProductImageBase64] = useState<string | null>(null);
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
      // Send raw product image directly — AI handles product integration natively
      setLoadingStage('Designing your ad...');
      console.log('Generating creative — sending raw product image to AI...');

      const { data, error } = await supabase.functions.invoke('generate-creative', {
        body: {
          template,
          productImageUrl: rawProductImage,
          referenceImageUrl,
          adCopy: selectedAdCopy,
          productData,
          confirmedBrandKit
        }
      });

      if (error) throw error;
      
      let finalImageUrl = data.imageUrl;

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
