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

    const responseText = await response.text();
    if (!responseText || responseText.trim().length === 0) {
      console.error('AI returned empty response body');
      return new Response(JSON.stringify({ success: false, error: 'AI returned an empty response. Please try again.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (parseErr) {
      console.error('Failed to parse AI response:', responseText.substring(0, 500));
      return new Response(JSON.stringify({ success: false, error: 'AI returned an invalid response. Please try again.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
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

    // Extract image with fallback paths
    let imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageUrl) {
      const content = data.choices?.[0]?.message?.content;
      if (Array.isArray(content)) {
        const imageBlock = content.find((c: any) => c.type === 'image' || c.type === 'image_url');
        imageUrl = imageBlock?.image_url?.url || imageBlock?.url;
      }
    }

    if (!imageUrl) {
      console.error('No image in response:', JSON.stringify(data, null, 2));
      return new Response(JSON.stringify({ success: false, error: 'No image was generated. Please try again.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log('Creative generated successfully');

    const productTitle = productData?.title || 'Unknown Product';
    try {
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
        EdgeRuntime.waitUntil(saveCreativeToGallery(imageUrl, template.id, productTitle));
      } else {
        saveCreativeToGallery(imageUrl, template.id, productTitle).catch(e => console.error('Gallery save failed:', e));
      }
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
  scene_description?: string;
  education_copy?: string;
  footer_copy?: string;
  badge_pills?: string[];
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
    case 'concept':
      return buildConceptPrompt(adCopy, aspectRatio, canvasSize, dimensions, brand, productData);
    default:
      return buildFeaturesBenefitsPrompt(adCopy, aspectRatio, canvasSize, dimensions, brand);
  }
}

interface BrandValues { bgColor: string; textColor: string; accentColor: string; ctaColor: string; headingFont: string; bodyFont: string; }

function buildCoreCreativeDirection(brand: BrandValues, canvasSize: string, dimensions: string): string {
  return `SENIOR ART DIRECTOR brief: scroll-stopping Meta ad for a $100M DTC brand. Magazine-quality, editorial, poster-grade.

CANVAS: EXACTLY ${canvasSize} pixels (${dimensions}). FULL-BLEED — NO borders, frames, rounded corners, or card edges.

PRODUCT: The attached image is the HERO. 40-55% of canvas. Dramatic directional lighting. Preserve packaging exactly. Natural grounding shadow.

BACKGROUND: NEVER flat single-color. Use ONE of: (1) Rich gradient wash with brand colors + subtle texture (PREFERRED), (2) Lifestyle texture (marble, wood, linen), (3) Dramatic dark studio spotlight, (4) Soft blurred botanicals. Brand color ${brand.bgColor} as tonal guide. Must have DEPTH.
- Any ingredient elements: OUT OF FOCUS, desaturated vs product, loosely scattered, partially cropped, 10-20% of product size max.

TEXT RULES:
- ALL text CRISP, SHARP, readable at phone size. Horizontally centered.
- Headlines: BOLD, LARGE, standalone on background — NEVER inside a box/banner/pill/container.
- Text shadow (2px, rgba(0,0,0,0.4)) on all text over gradients.
- CONTRAST: White/cream on dark backgrounds. Black/charcoal on light. NEVER use accent color (orange/gold/amber) as text on warm backgrounds.
- Numbers ≥1000 must have commas (10,000 not 10000).

TYPOGRAPHY: Study the product packaging. Match its serif/sans-serif, weight, width, and letter-spacing for headlines. Body text: clean complementary font. All templates for same product = same type style.
- Font "${brand.headingFont}": if descriptive (e.g. "Match product packaging", "Elegant serif"), interpret the style visually.

LAYOUT: 40px min padding from edges. No text overlapping product. Max 4 callout points — use 3 if space is tight.`;
}

function buildFeaturesBenefitsPrompt(adCopy: AdCopyInput, aspectRatio: string, canvasSize: string, dimensions: string, brand: BrandValues): string {
  const headline = adCopy.headline_primary || adCopy.headline || 'Premium Quality';
  const subheadline = adCopy.subheadline_primary || adCopy.subheadline || '';

  let featureBenefits: FeatureBenefitCallout[] = adCopy.feature_benefits || [];
  if (featureBenefits.length === 0 && adCopy.bulletPoints) {
    featureBenefits = adCopy.bulletPoints.slice(0, 4).map((bp, i) => ({ text: bp.replace(/^[✓✗]\s*/, ''), meaning_keywords: 'general, quality', priority_rank: i + 1 }));
  }
  const sorted = [...featureBenefits].sort((a, b) => a.priority_rank - b.priority_rank).slice(0, 4);
  const calloutList = sorted.map((c, i) => `   ${i + 1}. "${c.text}" (icon keywords: ${c.meaning_keywords})`).join('\n');

  const coreDirection = buildCoreCreativeDirection(brand, canvasSize, dimensions);

  return `Generate a ${aspectRatio} Features & Benefits product poster for Meta ads.

${coreDirection}

LAYOUT:
1. HEADLINE (top 12-18%): "${headline}" — MASSIVE bold text, max 2 lines, centered. White/cream on dark, black on light. NEVER orange/gold on warm backgrounds. Subtle text shadow.

2. SUBHEADLINE (below headline): "${subheadline}" — smaller, lighter weight, clean text, no container. 80% opacity of headline color.

3. PRODUCT (center): Attached image, 45-55% canvas width, dramatic lighting, grounded.

4. FOUR BENEFIT CALLOUTS around product:
${aspectRatio === '9:16' ? '   Stacked VERTICALLY on LEFT, product on RIGHT.' : '   Staggered: 2 LEFT, 2 RIGHT of product.'}

${calloutList}

   Style: Icon ABOVE or LEFT of text (consistent for all 4). Thin line icons only (1.5-2px stroke, no fills, geometric, 28-36px, uniform). Text: bold, white on dark / dark on light. Subtle text shadow if needed, NO boxes/pills. All 4 identical in style, size, spacing.

   Icon guide: energy→zigzag bolt, brain/focus→circle+curves, heart→heart outline, cellular→hexagon, longevity→infinity, natural→leaf, shield→shield outline, gut→organ outline.

   NO arrows. NO hand-drawn/sketched icons.

OUTPUT: EXACTLY ${canvasSize} pixels. ${dimensions}.`;
}

function buildReviewPrompt(adCopy: AdCopyInput, aspectRatio: string, canvasSize: string, dimensions: string, brand: BrandValues): string {
  const actualRating = adCopy.rating || '4.8';
  const reviewCountRaw = adCopy.reviewCount || '0';
  const reviewCountNum = parseInt(reviewCountRaw.replace(/[^0-9]/g, ''));
  const showReviewCount = reviewCountNum >= 500;
  const formattedReviewCount = reviewCountNum.toLocaleString('en-US');
  const ratingLine = showReviewCount
    ? `Rated ${actualRating}/5 by ${formattedReviewCount}+ customers`
    : adCopy.subheadline || `★★★★★ ${actualRating}/5`;

  const words = adCopy.headline.split(' ');
  let headline = words.slice(0, 12).join(' ');
  const incompleteEndings = ['and', 'but', 'or', 'the', 'a', 'an', 'to', 'for', 'with', 'in', 'on', 'at', 'of', 'my', 'so', 'that', 'is', 'was'];
  const lastWord = headline.split(' ').pop()?.toLowerCase();
  if (lastWord && incompleteEndings.includes(lastWord)) headline = headline.split(' ').slice(0, -1).join(' ');

  const coreDirection = buildCoreCreativeDirection(brand, canvasSize, dimensions);

  return `Generate a premium ${aspectRatio} customer testimonial Meta ad.

${coreDirection}

LAYOUT:
1. FIVE STARS (top 8%): 5 small elegant gold (#D4A853) filled stars, centered.

2. TESTIMONIAL (upper 20-40%): "${headline}" — in quotation marks, LARGE bold serif/sans-serif, max 3 lines, centered. Color: ${brand.textColor}. Magazine pull-quote feel.

3. RATING LINE (below quote): "${ratingLine}" — smaller, lighter, 60% opacity, centered.

4. PRODUCT (lower half): Attached image, ~45% canvas width, dramatic lighting, grounded.

BACKGROUND: Rich warm gradient (tonal: ${brand.bgColor}), subtle texture/depth. NOT flat.

CRITICAL: Star rating MUST be ${actualRating}/5. Do NOT invent or change this number.

OUTPUT: EXACTLY ${canvasSize} pixels. ${dimensions}.`;
}

function buildComparisonPrompt(adCopy: AdCopyInput, aspectRatio: string, canvasSize: string, dimensions: string, brand: BrandValues): string {
  const oursPoints = adCopy.comparisonPoints?.ours?.map(p => `   ${p}`).join('\n') || '   ✓ Clean ingredients\n   ✓ Third-party tested\n   ✓ Full doses\n   ✓ No fillers';
  const theirsPoints = adCopy.comparisonPoints?.theirs?.map(p => `   ${p}`).join('\n') || '   ✗ Artificial additives\n   ✗ No testing\n   ✗ Underdosed\n   ✗ Hidden fillers';

  const coreDirection = buildCoreCreativeDirection(brand, canvasSize, dimensions);

  return `Generate a BOLD ${aspectRatio} "Us vs Them" comparison Meta ad. Opinionated, confident.

${coreDirection}

LAYOUT:
1. HEADLINE (top 15-20%): "${adCopy.headline}" — MASSIVE bold text, centered, no box/banner. White on dark, dark on light. Text shadow for readability.

2. SPLIT COMPARISON — two columns:
   LEFT (winner): Warm brand-tinted background, green ✓ checkmarks.
${oursPoints}
   RIGHT (loser): Cool grey/muted background, red ✗ marks.
${theirsPoints}
   Each point: MAX 4 WORDS rendered. Single vertical column per side, evenly spaced, aligned. Same count both sides. NO duplicates — drop any repeated points.

3. PRODUCT: Fully on LEFT side only. NEVER crosses center divider. Scale down if needed. Brand logo visible on positive side. Slight 5-10° tilt, dramatic lighting.

Strong vertical divider between columns. Bold editorial feel.

OUTPUT: EXACTLY ${canvasSize} pixels. ${dimensions}.`;
}

function buildBenefitsPrompt(adCopy: AdCopyInput, aspectRatio: string, canvasSize: string, dimensions: string, brand: BrandValues): string {
  const headline = adCopy.headline_primary || adCopy.headline || 'Premium Benefits';
  const benefits = adCopy.bulletPoints?.join('\n   • ') || adCopy.feature_benefits?.map(fb => fb.text).join('\n   • ') || 'Clean ingredients\n   • Science-backed\n   • Premium quality';

  const coreDirection = buildCoreCreativeDirection(brand, canvasSize, dimensions);

  return `Generate a ${aspectRatio} listicle-style benefits Meta ad. Clean, scannable, absorbable in 2 seconds.

${coreDirection}

LAYOUT:
1. HEADLINE (top): "${headline}" — BOLD, LARGE, max 2 lines, centered. High contrast, text shadow if needed.

2. BENEFITS LIST — vertical stack, each with thin line icon + text (3-5 words each):
   • ${benefits}

3. PRODUCT: alongside or below benefits, 40-50% canvas width, dramatic lighting, can slightly overlap list for depth.

OUTPUT: EXACTLY ${canvasSize} pixels. ${dimensions}.`;
}

function buildConceptPrompt(adCopy: AdCopyInput, aspectRatio: string, canvasSize: string, dimensions: string, brand: BrandValues, productData?: any): string {
  const productTitle = productData?.title || 'product';
  const productTitle = productData?.title || 'product';
  const productBenefits = productData?.benefits?.slice(0, 4)?.join(', ') || 'general wellness';
  const productFeatures = productData?.features?.slice(0, 4)?.join(', ') || '';
  const productCategory = productData?.description?.substring(0, 200) || '';

  return `You are an award-winning creative director. Generate a completely unique ${aspectRatio} cinematic advertisement. EXACTLY ${canvasSize} pixels (${dimensions}). FULL-BLEED — no borders/frames.

PRODUCT CONTEXT (inspire your concept — do NOT list as text):
- Product: ${productTitle}
- Benefits: ${productBenefits}
- Features: ${productFeatures}
- Category: ${productCategory}
- Brand colors: ${brand.bgColor}, accent ${brand.accentColor}

YOUR TASK: Invent a UNIQUE visual concept — a clever, cinematic scene that metaphorically communicates what this product does. Every generation must be completely different.

CONCEPT DIRECTION — pick ONE randomly:
1. METAPHOR: Real-world object mirroring the benefit (chess board, gas gauge on EMPTY, cracked trophy, hourglass, lab beakers, rusted vs polished gears)
2. CONTRAST: Two halves showing problem vs solution (chemical label vs clean ingredient, wilting vs thriving plant, cluttered cabinet vs single product)
3. ENVIRONMENT: Product in atmospheric setting communicating purpose (moody nightstand, gym locker with steam, sunlit kitchen, golden hour trail)

PHOTOGRAPHIC REALISM (must NOT look AI-generated):
- Look like a PHOTOGRAPH from a real shoot. One clear key light, natural shadows, realistic textures (wood grain, glass, metal patina). Cinematic muted color grading. Asymmetric composition. Shallow DOF. Subtle atmosphere (dust, haze). Small imperfections for realism. NO waxy surfaces, NO symmetric floating objects, NO oversaturation.

PRODUCT: Attached image is the HERO (15-25% canvas). Sharp, well-lit, label readable. Sits naturally in scene (on surface/shelf) — NOT floating. Packaging accurate.

TYPOGRAPHY: Match font style from product packaging.
- HEADLINE: 2-6 words, ALL CAPS, bold. Clever + intriguing, ties the metaphor. NOT generic ("Premium Quality") or aggressive ("Stop Poisoning Yourself"). YES: "THE AGING GAME.", "RUNNING ON FUMES.", "DATE NIGHT SHOULD WORK." Top 20-25%.
- EDUCATION LINE: 1 short sentence below headline, lighter weight, max 12 words.
- OPTIONAL PILLS: 2-3 keyword badges at bottom (e.g., "HEALTHY AGING | BRAIN SUPPORT"), small, semi-transparent. Skip if not needed.

CONTRAST: White text + shadow on dark scenes. Dark text on light. NEVER blend text into background.
SAFE ZONES: 40px padding. OUTPUT: EXACTLY ${canvasSize} pixels.`;
}
