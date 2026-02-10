import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Upload, ImagePlus, Loader2, ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProductColors {
  background: string;
  accent: string;
  text: string;
  cta: string;
}

interface Step2Props {
  initialImages: string[];
  isLoading: boolean;
  productColors: ProductColors | null;
  productImageBase64: string | null;
  productCutoutBase64: string | null;
  onAnalyze: (base64: string) => Promise<void>;
  onNext: () => void;
  onPrev: () => void;
}

export function Step2UploadProduct({
  initialImages,
  isLoading,
  productColors,
  productImageBase64,
  productCutoutBase64,
  onAnalyze,
  onNext,
  onPrev,
}: Step2Props) {
  const [previewUrl, setPreviewUrl] = useState<string>(
    productImageBase64 || initialImages?.[0] || ''
  );
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      setPreviewUrl(base64);
      await onAnalyze(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const colorLabels: { key: keyof ProductColors; label: string }[] = [
    { key: 'background', label: 'Background' },
    { key: 'accent', label: 'Accent' },
    { key: 'text', label: 'Text' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bg-card border border-border rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-foreground mb-1">Upload Product Image</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Upload a clean product photo. We'll extract colors from the packaging to build your brand kit.
        </p>

        {/* Upload area */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "relative border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 overflow-hidden",
            "flex items-center justify-center",
            isDragging
              ? "border-primary bg-primary/5"
              : previewUrl
              ? "border-primary/40"
              : "border-border hover:border-primary/30 hover:bg-secondary/30",
            "aspect-square max-w-sm mx-auto"
          )}
        >
          {previewUrl ? (
            <>
              <img src={previewUrl} alt="Product" className="w-full h-full object-contain p-4" />
              <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                <Upload className="w-6 h-6 text-white" />
              </div>
            </>
          ) : (
            <div className="text-center p-8">
              <ImagePlus className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">Drop image here or click to upload</p>
              <p className="text-xs text-muted-foreground mt-1">PNG, JPG up to 10MB</p>
            </div>
          )}
          <Input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileInput}
            className="hidden"
          />
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center gap-3 mt-6 py-4">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Extracting colors...</span>
          </div>
        )}

        {/* Extracted colors */}
        {productColors && !isLoading && (
          <div className="mt-6 space-y-3">
            <h4 className="text-sm font-medium text-foreground">Extracted Product Colors</h4>
            <div className="flex gap-4">
              {colorLabels.map(({ key, label }) => (
                <div key={key} className="flex flex-col items-center gap-1.5">
                  <div
                    className="w-10 h-10 rounded-lg border border-border shadow-sm"
                    style={{ backgroundColor: productColors[key] }}
                  />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onPrev} className="h-11 px-6 rounded-xl font-medium">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={!productColors || isLoading}
          className="h-11 px-6 rounded-xl font-medium"
        >
          Continue
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
