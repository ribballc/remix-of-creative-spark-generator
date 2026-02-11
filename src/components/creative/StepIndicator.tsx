import { cn } from '@/lib/utils';
import { Check, Search, Upload, Palette, Sparkles } from 'lucide-react';

interface StepIndicatorProps {
  currentStep: number;
}

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  const steps = [
    { number: 1, title: 'Scan Product', icon: Search },
    { number: 2, title: 'Upload Image', icon: Upload },
    { number: 3, title: 'Brand Kit', icon: Palette },
    { number: 4, title: 'Generate', icon: Sparkles }
  ];

  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((step, index) => {
        const StepIcon = step.icon;
        return (
          <div key={step.number} className="flex items-center">
            <div className="flex flex-col items-center group">
              <div
                className={cn(
                  'w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-500 ease-out',
                  currentStep > step.number
                    ? 'bg-primary text-primary-foreground scale-100'
                    : currentStep === step.number
                    ? 'bg-primary text-primary-foreground ring-4 ring-primary/20 scale-110 shadow-lg shadow-primary/30'
                    : 'bg-secondary text-muted-foreground hover:bg-secondary/80 hover:scale-105'
                )}
              >
                {currentStep > step.number ? (
                  <Check className="w-5 h-5 animate-scale-in" />
                ) : (
                  <StepIcon className={cn(
                    "w-4 h-4 transition-all duration-300",
                  )} />
                )}
              </div>
              <span
                className={cn(
                  'mt-2 text-xs font-medium transition-all duration-300',
                  currentStep > step.number
                    ? 'text-primary'
                    : currentStep === step.number
                    ? 'text-foreground font-semibold'
                    : 'text-muted-foreground group-hover:text-foreground/70'
                )}
              >
                {step.title}
              </span>
            </div>
            
            {index < steps.length - 1 && (
              <div className="relative w-12 h-0.5 mx-2">
                <div className="absolute inset-0 bg-secondary rounded-full" />
                <div 
                  className={cn(
                    "absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-500 ease-out",
                    currentStep > step.number ? "w-full" : "w-0"
                  )}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
