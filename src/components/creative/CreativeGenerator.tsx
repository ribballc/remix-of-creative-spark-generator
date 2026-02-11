import { useCreativeGenerator } from '@/hooks/useCreativeGenerator';
import { StepIndicator } from './StepIndicator';
import { Step1ShopifyUrl } from './Step1ShopifyUrl';
import { Step2UploadProduct } from './Step2UploadProduct';
import { Step3BrandKit } from './Step3BrandKit';
import { Step3AdTemplates } from './Step3AdTemplates';
import headerBanner from '@/assets/header-banner.png';
import logoImage from '@/assets/ads-mastery-logo.png';
import { Zap } from 'lucide-react';

export function CreativeGenerator() {
  const {
    step,
    isLoading,
    loadingStage,
    productData,
    adCopies,
    generatedCreatives,
    productImageBase64,
    productColors,
    confirmedBrandKit,
    isAnalyzingImage,
    detectedFonts,
    scanShopifyUrl,
    analyzeProductImage,
    confirmBrandKit,
    generateCreative,
    nextStep,
    prevStep
  } = useCreativeGenerator();

  return (
    <div className="min-h-screen bg-background">
      {/* Header Banner */}
      <div 
        className="w-full h-[100px] bg-cover bg-center bg-no-repeat flex items-center justify-center"
        style={{ backgroundImage: `url(${headerBanner})` }}
      >
        <img 
          src={logoImage} 
          alt="Ads Mastery" 
          className="h-8 md:h-10"
        />
      </div>

      {/* Main content area */}
      <div className="container max-w-4xl px-4 py-12 md:py-16">
        {/* Main headline */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold uppercase tracking-widest mb-6">
            <Zap className="w-3.5 h-3.5" />
            AI-Powered Creative Engine
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight mb-5 text-foreground uppercase">
            AD CREATIVE GENERATOR
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto text-base md:text-lg leading-relaxed">
            Drop your Shopify URL. We'll analyze your product and generate stunning ad creatives using AI.
          </p>
        </div>




        {/* Step Indicator */}
        <StepIndicator currentStep={step} />

        {/* Step Content */}
        <div className="mt-8">
          {step === 1 && (
            <Step1ShopifyUrl
              isLoading={isLoading}
              loadingStage={loadingStage}
              productData={productData}
              onScan={scanShopifyUrl}
            />
          )}

          {step === 2 && (
            <Step2UploadProduct
              initialImages={productData?.images || []}
              isLoading={isAnalyzingImage}
              productColors={productColors}
              productImageBase64={productImageBase64}
              onAnalyze={analyzeProductImage}
              onNext={() => nextStep()}
              onPrev={prevStep}
            />
          )}

          {step === 3 && (
            <Step3BrandKit
              websiteColors={productData?.brandColors ? {
                primary: productData.brandColors.primary,
                secondary: productData.brandColors.secondary,
                accent: productData.brandColors.accent,
              } : null}
              productColors={productColors}
              typography={productData?.typography ? {
                headingFont: productData.typography.headingFont,
                bodyFont: productData.typography.bodyFont,
                fontStacks: productData.typography.fontStacks || null,
              } : null}
              detectedFonts={detectedFonts}
              logo={productData?.logo || null}
              productImageBase64={productImageBase64}
              onConfirm={confirmBrandKit}
              onPrev={prevStep}
            />
          )}

          {step === 4 && (
            <Step3AdTemplates
              adCopies={adCopies}
              generatedCreatives={generatedCreatives}
              onGenerateCreative={generateCreative}
              onPrev={prevStep}
              productImageBase64={confirmedBrandKit?.productImageBase64 || productImageBase64}
              loadingStage={loadingStage}
            />
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-16 pt-8 border-t border-border">
          <p className="text-sm text-muted-foreground">
            Built for DTC brands that want to scale • High-quality ad creatives
          </p>
        </div>
      </div>
    </div>
  );
}
