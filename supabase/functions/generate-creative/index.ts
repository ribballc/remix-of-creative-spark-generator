import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LOVABLE_AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

// Helper to upload base64 image to storage and save to DB
async function saveCreativeToGallery(
  base64Image: string,
  templateId: string,
  productTitle: string
): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) { console.error('Supabase credentials not configured'); return null; }
    const supabase = createClient(supabaseUrl, supabaseKey);
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const filename = `creative_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
    const { error: uploadError } = await supabase.storage.from('generated-creatives').upload(filename, binaryData, { contentType: 'image/png', upsert: false });
    if (uploadError) { console.error('Storage upload error:', uploadError); return null; }
    const { data: urlData } = supabase.storage.from('generated-creatives').getPublicUrl(filename);
    const publicUrl = urlData.publicUrl;
    const { error: dbError } = await supabase.from('generated_creatives').insert({ image_url: publicUrl, template_id: templateId, product_title: productTitle });
    if (dbError) console.error('Database insert error:', dbError);
    console.log('Creative saved to gallery:', filename);
    return publicUrl;
  } catch (error) {
    console.error('Failed to save creative to gallery:', error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { template, productImageUrl, referenceImageUrl, adCopy, productData, confirmedBrandKit } = await req.json();

    if (!template || !adCopy) {
      return new Response(
        JSON.stringify({ success: false, error: 'Template and ad copy are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const imagePrompt = buildPromptForTemplate(template, adCopy, productData, confirmedBrandKit);

    console.log('Generating creative for template:', template.id);
    console.log('Prompt length:', imagePrompt.length);
    console.log('Has product image:', !!productImageUrl);

    const messageContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: 'text', text: imagePrompt }
    ];

    if (productImageUrl) {
      const productUrl = productImageUrl.startsWith('data:') ? productImageUrl : `data:image/png;base64,${productImageUrl}`;
      messageContent.push({ type: 'image_url', image_url: { url: productUrl } });
    }

    const response = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3-pro-image-preview',
        messages: [{ role: 'user', content: messageContent }],
        modalities: ['image', 'text']
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lovable AI error:', response.status, errorText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded. Please wait a moment and try again.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ success: false, error: 'AI credits exhausted. Please add credits to continue.' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      throw new Error(`Lovable AI error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('AI response keys:', JSON.stringify(Object.keys(data.choices?.[0]?.message || {})));

    const choiceError = data.choices?.[0]?.error;
    if (choiceError) {
      console.error('AI response error:', choiceError);
      const rawError = choiceError.metadata?.raw;
      if (rawError && (rawError.includes('429') || rawError.includes('RESOURCE_EXHAUSTED'))) {
        return new Response(JSON.stringify({ success: false, error: 'AI rate limit exceeded. Please wait and try again.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: false, error: choiceError.message || 'AI generation failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url
      || (Array.isArray(data.choices?.[0]?.message?.content)
          ? data.choices[0].message.content.find((c: any) => c.type === 'image')?.image_url?.url
          : null)
      || null;

    if (!imageUrl) {
      console.error('No image in response:', JSON.stringify(data, null, 2));
      return new Response(JSON.stringify({ success: false, error: 'No image was generated. Please try again.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log('Creative generated successfully');

    const productTitle = productData?.title || 'Unknown Product';
    try {
      EdgeRuntime.waitUntil(saveCreativeToGallery(imageUrl, template.id, productTitle));
    } catch {
      saveCreativeToGallery(imageUrl, template.id, productTitle).catch(err => console.error('Background save failed:', err));
    }

    return new Response(
      JSON.stringify({ success: true, imageUrl, compositing: { enabled: false } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating creative:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ─── Types ───────────────────────────────────────────────────────

interface FeatureBenefitCallout { text: string; meaning_keywords: string; priority_rank: number; }
interface AdCopyInput {
  headline: string; subheadline?: string;
  headline_primary?: string; subheadline_primary?: string;
  feature_benefits?: FeatureBenefitCallout[];
  bulletPoints?: string[];
  comparisonPoints?: { ours: string[]; theirs: string[] };
  reviewCount?: string; rating?: string;
  compliance_safe_version?: string;
}
interface BrandTypography { headingFont: string | null; bodyFont: string | null; fontSizes?: { h1?: string; h2?: string; body?: string } | null; fontStacks?: { heading?: string[]; body?: string[] } | null; }
interface ConfirmedBrandKitInput {
  colors: { background: string; accent: string; text: string; cta: string };
  typography: { headingFont: string; bodyFont: string; h1Weight: number; h2Weight: number; bodyWeight: number };
  logo: string; productImageBase64: string;
}

// ─── Prompt Builders ─────────────────────────────────────────────

function getCanvasSize(aspectRatio: string): string {
  if (aspectRatio === '9:16') return '1080x1920';
  if (aspectRatio === '4:5') return '1080x1350';
  return '1080x1080';
}

function getDimensions(aspectRatio: string): string {
  if (aspectRatio === '9:16') return '1080 pixels wide and 1920 pixels tall';
  if (aspectRatio === '4:5') return '1080 pixels wide and 1350 pixels tall';
  return '1080 pixels wide and 1080 pixels tall';
}

function getBrandValues(
  productData?: { typography?: BrandTypography; fonts?: any; title?: string; brandColors?: { primary: string; secondary: string; accent: string } },
  confirmedBrandKit?: ConfirmedBrandKitInput
) {
  const bgColor = confirmedBrandKit?.colors.background || productData?.brandColors?.primary || '#F5F5F5';
  const textColor = confirmedBrandKit?.colors.text || '#1A1A2E';
  const accentColor = confirmedBrandKit?.colors.accent || productData?.brandColors?.accent || '#4A90D9';
  const ctaColor = confirmedBrandKit?.colors.cta || '#E84855';
  const headingFont = confirmedBrandKit?.typography.headingFont || productData?.typography?.headingFont || 'Inter';
  const bodyFont = confirmedBrandKit?.typography.bodyFont || productData?.typography?.bodyFont || headingFont;
  return { bgColor, textColor, accentColor, ctaColor, headingFont, bodyFont };
}

function buildPromptForTemplate(
  template: { type: string; aspectRatio: string },
  adCopy: AdCopyInput,
  productData?: any,
  confirmedBrandKit?: ConfirmedBrandKitInput
): string {
  const { aspectRatio } = template;
  const canvasSize = getCanvasSize(aspectRatio);
  const dimensions = getDimensions(aspectRatio);
  const brand = getBrandValues(productData, confirmedBrandKit);

  switch (template.type) {
    case 'features_benefits':
      return buildFeaturesBenefitsPrompt(adCopy, aspectRatio, canvasSize, dimensions, brand);
    case 'review':
      return buildReviewPrompt(adCopy, aspectRatio, canvasSize, dimensions, brand);
    case 'comparison':
      return buildComparisonPrompt(adCopy, aspectRatio, canvasSize, dimensions, brand);
    case 'benefits':
      return buildBenefitsPrompt(adCopy, aspectRatio, canvasSize, dimensions, brand);
    default:
      return buildFeaturesBenefitsPrompt(adCopy, aspectRatio, canvasSize, dimensions, brand);
  }
}

interface BrandValues { bgColor: string; textColor: string; accentColor: string; ctaColor: string; headingFont: string; bodyFont: string; }

function buildFeaturesBenefitsPrompt(adCopy: AdCopyInput, aspectRatio: string, canvasSize: string, dimensions: string, brand: BrandValues): string {
  const headline = adCopy.headline_primary || adCopy.headline || 'Premium Quality';
  const subheadline = adCopy.subheadline_primary || adCopy.subheadline || '';

  let featureBenefits: FeatureBenefitCallout[] = adCopy.feature_benefits || [];
  if (featureBenefits.length === 0 && adCopy.bulletPoints) {
    featureBenefits = adCopy.bulletPoints.slice(0, 4).map((bp, i) => ({ text: bp.replace(/^[✓✗]\s*/, ''), meaning_keywords: 'general, quality', priority_rank: i + 1 }));
  }
  const sorted = [...featureBenefits].sort((a, b) => a.priority_rank - b.priority_rank).slice(0, 4);
  const calloutList = sorted.map((c, i) => `   ${i + 1}. "${c.text}" (icon keywords: ${c.meaning_keywords})`).join('\n');

  return `Generate a scroll-stopping Meta ad image for a DTC supplement/wellness brand.

CREATIVE STYLE: Modern DTC performance ad — think Grüns, AG1, Obvi, RYZE level quality. This should look like it was designed in Figma by a senior brand designer, NOT generated by AI. Premium, editorial, confident.

ASPECT RATIO: ${aspectRatio}
DIMENSIONS: EXACTLY ${canvasSize} pixels (${dimensions}).

VISUAL HIERARCHY (top to bottom):

1. HEADLINE BANNER — Takes up ~15% of top area
   - Text: "${headline}"
   - Style: HUGE bold text, ALL CAPS or Title Case, minimum 60pt equivalent
   - Sits inside a rounded-corner colored banner/pill shape
   - Banner color: ${brand.accentColor}
   - Text color: White or high-contrast light color
   - This is the SCROLL-STOPPER — make it DOMINANT and eye-catching

2. SUBHEADLINE — Directly below headline
   - Text: "${subheadline}"
   - Smaller pill/badge shape, DIFFERENT color than headline banner
   - Clean, readable, single line. MAX 1 LINE.
   - Slightly overlaps the bottom edge of the headline banner

3. PRODUCT HERO — Center ~50% of canvas
   - Place the product from the attached image CENTER STAGE
   - Product should be LARGE — filling ~50% of canvas width
   - Professional product photography look: soft directional lighting from upper-left, subtle shadow on a clean surface
   - Product must look premium, real, tangible — like a professional e-commerce product shot
   - DO NOT alter the product design, label, or colors

4. FOUR BENEFIT CALLOUTS — Arranged around the product
   - Two on the LEFT (staggered vertically), two on the RIGHT (staggered vertically)
   - Each callout: small clean line icon (16px, thin stroke, Lucide/Phosphor style) + 2-3 word text
   - Connected to the product with thin, elegant curved arrows (1-2px weight, smooth, small arrowhead)
   - Callouts:
${calloutList}

DESIGN RULES:
- Background: ${brand.bgColor} with subtle gradient — slightly lighter at center, slightly darker at edges. NOT flat. Add very subtle texture or noise for depth.
- Typography: "${brand.headingFont}" for headlines, "${brand.bodyFont}" for callouts. All text must be CRISP, SHARP, and READABLE at mobile phone size.
- Icons: Minimal thin line icons — NOT filled, NOT emoji-style, NOT clip-art.
- Arrows: Thin (1-2px), smooth curved lines with small arrowheads. NOT hand-drawn. NOT thick. NOT sketchy.
- Overall feel: Premium, clean, modern, confident. Like a $500M DTC brand's Instagram ad.
- NO watermarks, NO borders, NO extra decorative elements.

WHAT NOT TO DO:
- Do NOT make text blurry or AI-looking
- Do NOT use thick hand-drawn arrows
- Do NOT put product on a flat single-color background with no depth
- Do NOT make the headline small
- Do NOT add elements not specified above

OUTPUT: EXACTLY ${canvasSize} pixels. ${dimensions}.`;
}

function buildReviewPrompt(adCopy: AdCopyInput, aspectRatio: string, canvasSize: string, dimensions: string, brand: BrandValues): string {
  const actualRating = adCopy.rating || '4.8';
  const actualReviewCount = adCopy.reviewCount || '10,000';
  const ratingLine = `Rated ${actualRating}/5 by ${actualReviewCount}+ happy customers`;

  // Ensure headline is complete
  const words = adCopy.headline.split(' ');
  let headline = words.slice(0, 12).join(' ');
  const incompleteEndings = ['and', 'but', 'or', 'the', 'a', 'an', 'to', 'for', 'with', 'in', 'on', 'at', 'of', 'my', 'so', 'that', 'is', 'was'];
  const lastWord = headline.split(' ').pop()?.toLowerCase();
  if (lastWord && incompleteEndings.includes(lastWord)) headline = headline.split(' ').slice(0, -1).join(' ');

  return `Generate a premium customer testimonial Meta ad for a DTC wellness/supplement brand.

CREATIVE STYLE: Clean, minimal social proof ad — like Arrae, Seed, or Athletic Greens review ads. Premium and editorial, not busy. Less is more.

ASPECT RATIO: ${aspectRatio}
DIMENSIONS: EXACTLY ${canvasSize} pixels (${dimensions}).

LAYOUT (top to bottom):

1. FIVE STARS — Small, elegant, evenly spaced filled stars at top
   - Color: gold or ${brand.textColor}
   - Size: Small (~16px each), centered horizontally
   - Positioned in top 10% of canvas

2. TESTIMONIAL QUOTE — The hero element
   - Text: "${headline}"
   - In quotation marks (elegant curly quotes)
   - LARGE, bold, serif or elegant sans-serif font
   - Takes up ~25% of canvas height
   - Centered horizontally
   - Max 2 lines. If text is too long, REDUCE FONT SIZE to fit in 2 lines. NEVER 3+ lines.
   - Color: ${brand.textColor}, bold weight
   - Font: "${brand.headingFont}" or clean serif like Playfair Display

3. RATING LINE — Below the quote
   - Text: "${ratingLine}"
   - Smaller, lighter weight
   - Single line, centered
   - Color: ${brand.textColor} at 60% opacity

4. PRODUCT — Lower half of canvas
   - Product from attached image, placed in lower-center
   - Professional studio look with soft shadow
   - Product takes up ~40% of canvas width
   - Grounded on the surface, not floating

BACKGROUND:
- ${brand.bgColor} with very subtle warm gradient — slightly lighter in the center where product sits
- Clean, minimal, premium feel

DESIGN RULES:
- This is an EDITORIAL, MINIMAL ad. Less is more.
- All text must be crisp and sharp
- Stars should be simple filled star shapes
- Overall feel: Trustworthy, premium, like a testimonial from a luxury wellness brand
- NO watermarks, NO borders, NO extra elements

CRITICAL DATA ACCURACY: The rating is ${actualRating} out of 5. This MUST appear as "${actualRating}/5" in the image. Do NOT change this number. Do NOT use 1/5. The actual verified rating is ${actualRating}/5.

WHAT NOT TO DO:
- Do NOT change the rating number — it MUST be ${actualRating}/5
- Do NOT make text blurry
- Do NOT add busy decorative elements
- Do NOT make the quote text small — it's the hero element

OUTPUT: EXACTLY ${canvasSize} pixels. ${dimensions}.`;
}

function buildComparisonPrompt(adCopy: AdCopyInput, aspectRatio: string, canvasSize: string, dimensions: string, brand: BrandValues): string {
  const oursPoints = adCopy.comparisonPoints?.ours?.join('\n   ') || '✓ Clean ingredients\n   ✓ Third-party tested\n   ✓ Full doses\n   ✓ No fillers';
  const theirsPoints = adCopy.comparisonPoints?.theirs?.join('\n   ') || '✗ Artificial additives\n   ✗ No testing\n   ✗ Underdosed\n   ✗ Hidden fillers';

  return `Generate a bold "Us vs Them" comparison Meta ad for a DTC supplement/wellness brand.

CREATIVE STYLE: High-contrast split comparison — think supplement brand challenger ads. Bold, opinionated, scroll-stopping. Clean and modern, NOT cluttered.

ASPECT RATIO: ${aspectRatio}
DIMENSIONS: EXACTLY ${canvasSize} pixels (${dimensions}).

LAYOUT:

1. HEADLINE across full width at top
   - Text: "${adCopy.headline}"
   - Bold, large, provocative, ALL CAPS or Title Case
   - Color: ${brand.textColor}
   - Takes up top ~12% of canvas

2. SPLIT DESIGN — Two columns below headline

   LEFT SIDE (the winner — "Us"):
   - Slightly warm/positive tint or subtle ${brand.accentColor} wash
   - Green checkmarks + text for each point:
   ${oursPoints}
   - Clean, modern typography
   - Product placed here, overlapping center divide slightly

   RIGHT SIDE (the loser — "Them"):
   - Slightly cool/negative tint — muted grey or desaturated
   - Red/grey X marks + text for each point:
   ${theirsPoints}
   - Same typography, but the points feel clearly inferior

3. PRODUCT — Placed on the LEFT (winning) side
   - Product from attached image
   - Overlaps the center divider slightly
   - Professional, grounded with shadow

DESIGN RULES:
- Background: Left uses warm brand color, right uses muted cool grey
- Clear visual divider between the two sides (subtle line or color boundary)
- Typography: "${brand.headingFont}" for headline, "${brand.bodyFont}" for points
- Checkmarks: Clean, green, consistent size
- X marks: Clean, red or grey, consistent size
- Overall feel: Bold, confident, "the choice is obvious"
- All text crisp and readable at mobile size
- NO watermarks, NO borders

OUTPUT: EXACTLY ${canvasSize} pixels. ${dimensions}.`;
}

function buildBenefitsPrompt(adCopy: AdCopyInput, aspectRatio: string, canvasSize: string, dimensions: string, brand: BrandValues): string {
  const headline = adCopy.headline_primary || adCopy.headline || 'Premium Benefits';
  const benefits = adCopy.bulletPoints?.join('\n   • ') || adCopy.feature_benefits?.map(fb => fb.text).join('\n   • ') || 'Clean ingredients\n   • Science-backed\n   • Premium quality';

  return `Generate a clean, benefit-focused Meta ad for a DTC supplement/wellness brand.

CREATIVE STYLE: Minimalist, premium DTC ad — clean and confident. Think AG1, Seed, or Ritual style. Focused entirely on communicating product benefits with visual clarity.

ASPECT RATIO: ${aspectRatio}
DIMENSIONS: EXACTLY ${canvasSize} pixels (${dimensions}).

LAYOUT:

1. HEADLINE at top
   - Text: "${headline}"
   - Bold, large, inside a rounded pill/banner shape
   - Banner color: ${brand.accentColor}
   - Text color: White or high-contrast
   - Takes up top ~12% of canvas

2. PRODUCT — Center of canvas
   - Product from attached image, large and prominent (~50% of canvas width)
   - Professional studio look: soft lighting, subtle shadow, grounded on surface
   - DO NOT alter product design or colors

3. BENEFITS LIST — Below or around the product
   - Clean list with small line icons + short text for each benefit:
   • ${benefits}
   - Icons: thin line style (Lucide/Phosphor), consistent
   - Text: "${brand.bodyFont}", clean and readable
   - Color: ${brand.textColor}

BACKGROUND:
- ${brand.bgColor} with subtle gradient for depth — NOT flat
- Premium, clean feel

DESIGN RULES:
- Typography: "${brand.headingFont}" for headline, "${brand.bodyFont}" for benefits
- All text crisp and sharp at mobile size
- Minimal design — no clutter, no extra elements
- Overall feel: Premium, trustworthy, clean
- NO watermarks, NO borders

OUTPUT: EXACTLY ${canvasSize} pixels. ${dimensions}.`;
}
