export interface BrandTypography {
  headingFont: string | null;
  bodyFont: string | null;
  fontSizes?: {
    h1?: string;
    h2?: string;
    body?: string;
  } | null;
  fontStacks?: {
    heading?: string[];
    body?: string[];
  } | null;
}

export interface ProductData {
  title: string;
  description: string;
  features: string[];
  benefits: string[];
  price: string;
  images: string[];
  reviewCount?: string;
  rating?: string;
  brandColors?: {
    primary: string;
    secondary: string;
    accent: string;
    textSecondary?: string | null;
    secondaryAccent?: string | null;
  };
  logo?: string;
  typography?: BrandTypography;
  fonts?: BrandTypography; // Keep for backward compatibility
}

export interface BrandKit {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  logoUrl?: string;
}

export interface ConfirmedBrandKit {
  colors: {
    background: string;
    accent: string;
    text: string;
    cta: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    h1Weight: number;
    h2Weight: number;
    bodyWeight: number;
  };
  logo: string;
  productImageBase64: string;
}

export interface FeatureBenefitCallout {
  text: string;
  meaning_keywords: string;
  priority_rank: number;
}

export interface AdCopy {
  headline: string;
  subheadline?: string;
  type: 'feature' | 'benefit' | 'comparison' | 'review' | 'features_benefits';
  bulletPoints?: string[];  // Keep for backward compatibility
  
  // New fields for features_benefits spec
  headline_primary?: string;
  subheadline_primary?: string;
  feature_benefits?: FeatureBenefitCallout[];
  badge_text?: string;
  compliance_safe_version?: string;
  
  comparisonPoints?: {
    ours: string[];
    theirs: string[];
  };
  reviewCount?: string;
  rating?: string;
}

export interface AdTemplate {
  id: string;
  name: string;
  type: 'features_benefits' | 'comparison' | 'review' | 'benefits';
  aspectRatio: '9:16' | '1:1' | '4:5';
  description: string;
}

export interface GeneratedCreative {
  id: string;
  templateId: string;
  productImageUrl: string;
  adCopy: AdCopy;
  outputImageUrl?: string;
  status: 'pending' | 'generating' | 'completed' | 'error';
}

export const AD_TEMPLATES: AdTemplate[] = [
  {
    id: 'features_benefits_916',
    name: 'Features & Benefits',
    type: 'features_benefits',
    aspectRatio: '9:16',
    description: 'Highlight key features and benefits in vertical format'
  },
  {
    id: 'features_benefits_45',
    name: 'Features & Benefits',
    type: 'features_benefits',
    aspectRatio: '4:5',
    description: 'Optimal format for Meta feed posts (4:5)'
  },
  {
    id: 'features_benefits_11',
    name: 'Features & Benefits',
    type: 'features_benefits',
    aspectRatio: '1:1',
    description: 'Square format for feed posts'
  },
  {
    id: 'comparison_916',
    name: 'Comparison',
    type: 'comparison',
    aspectRatio: '9:16',
    description: 'Us vs Them comparison in vertical'
  },
  {
    id: 'comparison_45',
    name: 'Comparison',
    type: 'comparison',
    aspectRatio: '4:5',
    description: 'Us vs Them comparison for Meta feed (4:5)'
  },
  {
    id: 'comparison_11',
    name: 'Comparison',
    type: 'comparison',
    aspectRatio: '1:1',
    description: 'Side-by-side comparison in square format'
  },
  {
    id: 'review_916',
    name: 'Customer Review',
    type: 'review',
    aspectRatio: '9:16',
    description: 'Social proof with customer testimonials'
  },
  {
    id: 'review_45',
    name: 'Customer Review',
    type: 'review',
    aspectRatio: '4:5',
    description: 'Customer review for Meta feed (4:5)'
  },
  {
    id: 'review_11',
    name: 'Customer Review',
    type: 'review',
    aspectRatio: '1:1',
    description: 'Review highlight in square format'
  },
  {
    id: 'benefits_916',
    name: 'Pure Benefits',
    type: 'benefits',
    aspectRatio: '9:16',
    description: 'Focus purely on product benefits'
  },
  {
    id: 'benefits_45',
    name: 'Pure Benefits',
    type: 'benefits',
    aspectRatio: '4:5',
    description: 'Benefit-focused Meta feed ad (4:5)'
  },
  {
    id: 'benefits_11',
    name: 'Pure Benefits',
    type: 'benefits',
    aspectRatio: '1:1',
    description: 'Benefit-focused square ad'
  }
];
