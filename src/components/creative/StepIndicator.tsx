import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface StepIndicatorProps {
  currentStep: number;
}

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  const steps = [
    { number: 1, title: 'Scan Product' },
    { number: 2, title: 'Upload Image' },
    { number: 3, title: 'Brand Kit' },
    { number: 4, title: 'Generate' }
  ];

  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((step, index) => (
        <div key={step.number} className="flex items-center">
          <div className="flex flex-col items-center group">
            <div
              className={cn(
                'w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-500 ease-out',
                currentStep > step.number
                  ? 'bg-[hsl(145,100%,41%)] text-black scale-100'
                  : currentStep === step.number
                  ? 'bg-white text-black ring-4 ring-white/20 scale-110 shadow-lg shadow-white/10'
                  : 'bg-secondary text-muted-foreground hover:bg-secondary/80 hover:scale-105'
              )}
            >
              {currentStep > step.number ? (
                <Check className="w-5 h-5 animate-scale-in" />
              ) : (
                <span className={cn(
                  "transition-all duration-300",
                  currentStep === step.number && "font-bold"
                )}>
                  {step.number}
                </span>
              )}
            </div>
            <span
              className={cn(
                'mt-2 text-xs font-medium transition-all duration-300',
                currentStep > step.number
                  ? 'text-[hsl(145,100%,41%)]'
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
                  "absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out",
                  currentStep > step.number ? "w-full bg-[hsl(145,100%,41%)]" : "w-0"
                )}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
