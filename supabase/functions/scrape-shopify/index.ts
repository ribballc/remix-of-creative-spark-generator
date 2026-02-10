import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      console.error('FIRECRAWL_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl connector not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log('Scraping Shopify URL:', formattedUrl);

    // Retry logic for intermittent timeouts
    const maxRetries = 2;
    let lastError: Error | null = null;
    let data: any = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`Retry attempt ${attempt}/${maxRetries}...`);
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }

        const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: formattedUrl,
            formats: ['markdown', 'html', 'branding'],
            onlyMainContent: true,
            timeout: 45000, // 45 second timeout
            waitFor: 2000, // Wait 2 seconds for JS to render
          }),
        });

        data = await response.json();

        if (!response.ok) {
          // Check if it's a timeout error
          if (data.code === 'SCRAPE_SITE_ERROR' && data.error?.includes('TIMED_OUT')) {
            throw new Error('Website timed out');
          }
          console.error('Firecrawl API error:', data);
          return new Response(
            JSON.stringify({ success: false, error: data.error || 'Failed to scrape page' }),
            { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Success - break out of retry loop
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(`Attempt ${attempt + 1} failed:`, lastError.message);
        
        if (attempt === maxRetries) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'The website is slow or unresponsive. Please try again in a moment, or try a different product URL.' 
            }),
            { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Extract content from response (handle nested data structure)
    const markdown = data.data?.markdown || data.markdown || '';
    const metadata = data.data?.metadata || data.metadata || {};
    const html = data.data?.html || data.html || '';
    const branding = data.data?.branding || data.branding || {};

    console.log('Branding data extracted:', branding);

    // Extract brand colors from Firecrawl branding data
    const extractedColors = branding.colors || {};
    
    // Use extracted colors with fallbacks to sensible defaults
    const brandColors = {
      primary: extractedColors.background || extractedColors.primary || '#FFFFFF',
      secondary: extractedColors.textPrimary || extractedColors.secondary || '#1F1F1F',
      accent: extractedColors.accent || extractedColors.primary || '#FF6B35',
      textSecondary: extractedColors.textSecondary || null,
      secondaryAccent: extractedColors.secondary || null,
    };
    
    console.log('Firecrawl branding colors:', extractedColors);
    console.log('Using brand colors:', brandColors);

    // Extract typography from Firecrawl branding data
    const extractedTypography = branding.typography || {};
    const extractedFonts = branding.fonts || [];
    
    // Build structured typography object
    const typography = {
      headingFont: extractedTypography.fontFamilies?.heading 
        || extractedFonts.find((f: any) => f.role === 'heading')?.family 
        || null,
      bodyFont: extractedTypography.fontFamilies?.primary 
        || extractedTypography.fontFamilies?.body
        || extractedFonts.find((f: any) => f.role === 'body')?.family 
        || null,
      fontSizes: extractedTypography.fontSizes || null,
      fontStacks: extractedTypography.fontStacks || null,
    };
    
    console.log('Firecrawl typography:', extractedTypography);
    console.log('Using typography:', typography);

    // Parse product information
    const productData = {
      title: metadata.title || extractTitle(markdown),
      description: metadata.description || extractDescription(markdown),
      features: extractFeatures(markdown),
      benefits: extractBenefits(markdown),
      price: extractPrice(markdown),
      images: extractImages(html),
      reviewCount: extractReviewCount(markdown, html),
      rating: extractRating(markdown, html),
      brandColors: brandColors,
      logo: branding.logo || branding.images?.logo || null,
      typography: typography,
      fonts: typography, // Keep for backward compatibility
    };

    console.log('Product data extracted:', productData.title);

    return new Response(
      JSON.stringify({ success: true, productData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error scraping Shopify:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function extractTitle(markdown: string): string {
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  return titleMatch ? titleMatch[1].trim() : 'Product';
}

function extractDescription(markdown: string): string {
  const lines = markdown.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  return lines.slice(0, 3).join(' ').substring(0, 500);
}

function extractFeatures(markdown: string): string[] {
  const features: string[] = [];
  const bulletPoints = markdown.match(/^[-*•]\s+(.+)$/gm);
  if (bulletPoints) {
    bulletPoints.slice(0, 10).forEach(point => {
      const text = point.replace(/^[-*•]\s+/, '').trim();
      if (text.length > 5 && text.length < 200) {
        features.push(text);
      }
    });
  }
  return features;
}

function extractBenefits(markdown: string): string[] {
  const benefitKeywords = ['benefit', 'advantage', 'helps', 'improves', 'reduces', 'increases', 'saves'];
  const sentences = markdown.split(/[.!?]+/);
  const benefits: string[] = [];
  
  sentences.forEach(sentence => {
    const lower = sentence.toLowerCase();
    if (benefitKeywords.some(keyword => lower.includes(keyword)) && sentence.length < 200) {
      benefits.push(sentence.trim());
    }
  });
  
  return benefits.slice(0, 5);
}

function extractPrice(markdown: string): string {
  const priceMatch = markdown.match(/\$[\d,]+\.?\d*/);
  return priceMatch ? priceMatch[0] : '';
}

function extractImages(html: string): string[] {
  const imgMatches = html.match(/src="([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/gi);
  if (!imgMatches) return [];
  
  return imgMatches
    .map(match => {
      const urlMatch = match.match(/src="([^"]+)"/);
      return urlMatch ? urlMatch[1] : '';
    })
    .filter(url => url && !url.includes('icon') && !url.includes('logo'))
    .slice(0, 5);
}

function extractReviewCount(markdown: string, html: string): string {
  const patterns = [
    /(\d{1,3}(?:,\d{3})*)\s*(?:reviews?|ratings?)/i,
    /(\d{1,3}(?:,\d{3})*)\s*(?:customer\s*)?reviews?/i,
    /reviews?\s*\((\d{1,3}(?:,\d{3})*)\)/i,
    /(\d{1,3}(?:,\d{3})*)\+?\s*(?:5-star\s*)?reviews?/i
  ];
  
  const content = markdown + ' ' + html;
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1].replace(/,/g, '');
    }
  }
  return '';
}

function extractRating(markdown: string, html: string): string {
  const patterns = [
    /(\d+\.?\d*)\s*(?:out of\s*)?(?:\/\s*)?5\s*stars?/i,
    /(\d+\.?\d*)\s*stars?/i,
    /rating[:\s]+(\d+\.?\d*)/i
  ];
  
  const content = markdown + ' ' + html;
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && parseFloat(match[1]) <= 5) {
      return match[1];
    }
  }
  return '';
}
