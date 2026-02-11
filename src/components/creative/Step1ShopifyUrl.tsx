import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ProductData } from '@/types/creative';
import { Link, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RecentCreativesGallery } from './RecentCreativesGallery';

interface Step1Props {
  isLoading: boolean;
  loadingStage: string;
  productData: ProductData | null;
  onScan: (url: string) => Promise<void>;
}

export function Step1ShopifyUrl({ isLoading, loadingStage, onScan }: Step1Props) {
  const [url, setUrl] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const handleScan = async () => {
    if (url.trim()) {
      await onScan(url.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && url.trim() && !isLoading) {
      handleScan();
    }
  };

  return (
    <div className="space-y-6">
      {/* Input card */}
      <div 
        className={cn(
          "bg-secondary rounded-2xl p-2 max-w-2xl mx-auto transition-all duration-300",
          isFocused && "ring-2 ring-accent/50 shadow-lg shadow-accent/10"
        )}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 flex-1 px-4">
            <Link className={cn(
              "w-5 h-5 shrink-0 transition-colors duration-200",
              isFocused ? "text-accent" : "text-muted-foreground"
            )} />
            <input
              type="url"
              placeholder="Paste your Shopify product URL..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              disabled={isLoading}
              className="flex-1 bg-transparent border-0 text-foreground placeholder:text-muted-foreground focus:outline-none text-base py-3 disabled:opacity-50"
            />
          </div>
          <Button 
            onClick={handleScan} 
            disabled={isLoading || !url.trim()}
            size="lg"
            className={cn(
              "rounded-full px-8 font-semibold text-base h-12 min-w-[120px] transition-all duration-300",
              !isLoading && url.trim() && "hover:scale-105"
            )}
          >
            {isLoading ? 'SCANNING...' : 'SCAN'}
          </Button>
        </div>
      </div>

      {/* Helper text */}
      <p className="text-center text-sm text-muted-foreground">
        Works with any Shopify product page
      </p>

      {/* Loading state - smooth animated progress */}
      {isLoading && <ScanningAnimation currentStage={loadingStage} />}

      {/* Recent creatives gallery */}
      {!isLoading && <RecentCreativesGallery />}
    </div>
  );
}

function ScanningAnimation({ currentStage }: { currentStage: string }) {
  // Determine which step we're on based on the stage text
  const getStepStatus = (stepKey: string) => {
    const stage = currentStage.toLowerCase();
    if (stepKey === 'connect') {
      if (stage.includes('connect')) return 'active';
      if (stage.includes('extract') || stage.includes('generat') || stage.includes('complete')) return 'done';
      return 'pending';
    }
    if (stepKey === 'extract') {
      if (stage.includes('extract')) return 'active';
      if (stage.includes('generat') || stage.includes('complete')) return 'done';
      return 'pending';
    }
    if (stepKey === 'generate') {
      if (stage.includes('generat')) return 'active';
      if (stage.includes('complete')) return 'done';
      return 'pending';
    }
    return 'pending';
  };

  const steps = [
    { key: 'connect', label: 'Connecting to store', icon: '🔗' },
    { key: 'extract', label: 'Extracting product data', icon: '📦' },
    { key: 'generate', label: 'Generating ad copy', icon: '✨' },
  ];

  return (
    <div className="max-w-md mx-auto animate-fade-in">
      <div className="bg-card/50 rounded-2xl p-6 border border-border">
        {/* Step list */}
        <div className="space-y-3">
          {steps.map((step) => {
            const status = getStepStatus(step.key);
            return (
              <div 
                key={step.key}
                className={cn(
                  "flex items-center gap-3 py-2.5 px-4 rounded-xl transition-all duration-300",
                  status === 'active' && "bg-accent/10 border border-accent/20",
                  status === 'done' && "opacity-60",
                  status === 'pending' && "opacity-40"
                )}
              >
                <span className="text-lg w-6 text-center">{step.icon}</span>
                <span className={cn(
                  "flex-1 text-sm transition-colors duration-200",
                  status === 'active' ? "text-foreground font-medium" : "text-muted-foreground"
                )}>
                  {step.label}
                </span>
                {status === 'active' && (
                  <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                )}
                {status === 'done' && (
                  <Check className="w-4 h-4 text-[hsl(145,100%,41%)]" />
                )}
              </div>
            );
          })}
        </div>

        {/* Time estimate */}
        <p className="text-center text-xs text-muted-foreground mt-4">
          Usually takes 5-10 seconds
        </p>
      </div>
    </div>
  );
}
