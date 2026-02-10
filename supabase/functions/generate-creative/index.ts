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

function buildCoreCreativeDirection(brand: BrandValues, canvasSize: string, dimensions: string): string {
  return `YOU ARE A SENIOR ART DIRECTOR designing a scroll-stopping Meta ad. This must look like a real ad from a $100M DTC brand — NOT like an AI template fill.

QUALITY BENCHMARK:
- This ad must look like it was designed by a senior designer at a $500M DTC brand
- Think editorial, magazine-quality, poster-grade production value
- SIMPLE > BUSY. If in doubt, remove elements. Less clutter = more professional.
- The PRODUCT and HEADLINE are the only two things that matter. Everything else supports them.
- Background should enhance, not compete with, the product
- If the output looks "busy" or "cluttered" — it's wrong. Simplify.

FULL-BLEED OUTPUT (MANDATORY):
- The image must be a FULL-BLEED poster with NO borders, NO frames, NO rounded corners, NO card edges, NO drop shadows around the edge.
- Content should extend to ALL edges of the canvas — background goes edge-to-edge.
- This is a standalone Meta ad image, not a card inside a UI. No visible container.
- If there is any white border, black border, or frame visible around the output: REGENERATE.

CREATIVE DIRECTION:
- This is a POSTER-STYLE PRODUCT ADVERTISEMENT, not a catalog photo
- The product is the HERO — it should feel dramatic, premium, owning the frame
- The overall energy should make someone STOP SCROLLING and actually look

BACKGROUND PHILOSOPHY (CRITICAL — THIS IS WHAT MAKES OR BREAKS THE AD):
- NEVER use a flat, single-color background. That looks cheap and AI-generated.
- The background should be a RICH, CONTEXTUAL ENVIRONMENT that matches the product's brand story.
- Choose ONE of these background approaches based on the product category:
  * BOLD GRADIENT WASH (PREFERRED — most reliable, most professional): Rich, moody gradient using the brand's color palette — warm to cool transition, or light to dark. Subtle texture overlay (paper grain, linen, soft noise). Soft warm bokeh or light orbs. These approaches ALWAYS look more professional than attempting photorealistic ingredients.
  * LIFESTYLE TEXTURE: A real-world surface like marble, terracotta, linen, dark wood, or concrete that matches the brand's aesthetic. Product sits on it with real shadow. (Best for: premium products, artisanal brands)
  * DRAMATIC STUDIO: Deep black or very dark moody background with a single dramatic spotlight on the product. High contrast, editorial feel. (Best for: bold/masculine brands, nighttime products)
  * SURREAL INGREDIENT WORLD: Only if gradient/texture won't work. Floating botanicals softly blurred behind the product. (Best for: supplements, food, wellness)
- The background should use brand colors (${brand.bgColor}) as a TONAL GUIDE, not as a literal flat fill.
- Background must have DEPTH — layers, blur, gradient, texture. Never flat.

BACKGROUND REALISM RULE (CRITICAL):
- If the background includes ingredient elements (fruits, herbs, botanicals), they MUST be:
  * Subtly OUT OF FOCUS with bokeh blur — never sharp and in-focus like the product
  * De-saturated slightly compared to the product — the product is the color hero, not the background elements
  * Scattered LOOSELY and ORGANICALLY — not arranged symmetrically or floating in a grid
  * Partially cropped at the edges of the frame (some elements only half-visible)
  * SMALL relative to the product — ingredient elements should be 10-20% of product size max
- NEVER render background elements with the same sharpness, saturation, or focus as the product. The product must be the ONLY sharp, crisp element.
- If in doubt, use a GRADIENT or TEXTURED background instead of ingredient elements. A rich warm gradient with subtle light always looks more professional than AI-rendered fruit.

PRODUCT INTEGRATION:
- The attached image is the product. Integrate it as the HERO.
- Product should feel LARGER THAN LIFE — taking up 40-55% of the canvas.
- Use dramatic, directional lighting (key light from upper-left, subtle rim light)
- Natural grounding shadow OR floating with soft glow underneath
- Preserve the product EXACTLY as provided — do not alter, redraw, or stylize the label/packaging.
- Do NOT add other products or objects unless they are relevant ingredient elements in the background.

TEXT RULES:
- ALL text must be CRISP, SHARP, and clearly readable at mobile phone size
- Headline: BOLD, LARGE — this is the scroll-stopper. Should dominate the top 25-30% of canvas.
- Use high contrast: light text on dark, dark text on light. Always.
- Text color: ${brand.textColor}. Accent color: ${brand.accentColor}.
- ALL text HORIZONTALLY CENTERED on the canvas.

HEADLINE STYLE (APPLIES TO ALL TEMPLATES):
- Headlines are NEVER inside a box, banner, pill, rectangle, or any container shape.
- Headlines are ALWAYS rendered as clean, bold, standalone text directly on the background.
- Use text shadow (subtle, 2px, dark) for readability on busy or gradient backgrounds.
- The review template headline style is the reference: bold serif or sans-serif text, large, floating cleanly on a rich background with no UI elements around it.
- This rule also applies to subheadlines — no containers, no pills, no boxes.

NUMBER FORMATTING (MANDATORY):
- ALL numbers 1,000 or greater MUST include commas (e.g., 1,000 — 10,000 — 100,000 — 1,000,000).
- NEVER render a number like "10000" or "1000" without a comma. Always "10,000" and "1,000".
- This applies to review counts, customer counts, dosages, and any numeric text in the ad.

OUTPUT: EXACTLY ${canvasSize} pixels. ${dimensions}.`;
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

  return `Generate a scroll-stopping ${aspectRatio} Features & Benefits product poster for Meta ads.

${coreDirection}

THIS IS A PRODUCT POSTER — bold, in-your-face, designed to make someone stop scrolling in under 0.5 seconds.

LAYOUT:

1. HEADLINE — TOP OF CANVAS
   - Text: "${headline}"
   - NO box, NO banner, NO pill shape, NO rounded rectangle behind the text
   - Render as BOLD, LARGE standalone text directly on the background
   - Text color: White or cream (on dark/rich backgrounds) OR dark charcoal (on light backgrounds) — whichever gives maximum contrast
   - Add a subtle text shadow (2px, 50% opacity black) if needed for readability on complex backgrounds
   - TEXT MUST BE MASSIVE — this is the scroll-stopper
   - Max 2 lines. Takes up top 12-18% of canvas.
   - Centered horizontally

2. SUBHEADLINE — Directly below headline
   - Text: "${subheadline}"
   - NO pill shape, NO box, NO container behind the text
   - Render as clean text, slightly smaller and lighter weight than headline
   - Same color as headline or slightly reduced opacity (80%)
   - Single line, centered horizontally

3. PRODUCT — CENTER HERO
   - Place the attached product image CENTER STAGE
   - Product should be LARGE — 45-55% of canvas width
   - Dramatic, premium lighting
   - Natural shadow and grounding on the background environment

4. FOUR BENEFIT CALLOUTS — Staggered around product
   - LEFT SIDE (staggered vertically):
     - Callout 1: Upper-left area
     - Callout 2: Lower-left area
   - RIGHT SIDE (staggered vertically):
     - Callout 3: Upper-right area
     - Callout 4: Lower-right area
   
   Each callout = ICON + TEXT + CURVED ARROW pointing to product:
   - Icon: Small (14-18px), thin line style, relevant to the benefit
   - Text: 2-4 words, clean and readable
   - Arrow: Thin (1-2px), smooth curve toward product, small arrowhead
   - Left callouts: text right-aligned, arrow curves right
   - Right callouts: text left-aligned, arrow curves left

   Callouts:
${calloutList}

CALLOUT READABILITY (CRITICAL):
- Each callout text must have a subtle semi-transparent backing pill/card behind it for readability
  * Background: white at 70% opacity (on dark backgrounds) or dark at 70% opacity (on light backgrounds)
  * Rounded corners, just enough to frame the icon + text
  * This ensures callouts are readable even against busy or gradient backgrounds
- Callout text must be at MINIMUM 18pt equivalent — readable on a phone screen
- Icon + text + backing pill form a single visual unit

ICON STYLE:
- Thin, elegant, modern line icons (like Lucide or Phosphor)
- NOT filled, NOT emoji, NOT clip-art
- Color matches callout text color
- Category-aware: supplements→body/leaf/shield, skincare→droplet/sparkle, food→utensils/heart

ARROW STYLE:
- Thin (1-2px), smooth curved lines
- Subtle, elegant — NOT thick or hand-drawn
- Small arrowhead at product end

TYPOGRAPHY: "${brand.headingFont}" for headlines, "${brand.bodyFont}" for callouts.

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
  const reviewCountRaw = adCopy.reviewCount || '0';
  const reviewCountNum = parseInt(reviewCountRaw.replace(/[^0-9]/g, ''));
  const showReviewCount = reviewCountNum >= 500;
  const formattedReviewCount = reviewCountNum.toLocaleString('en-US');
  const ratingLine = showReviewCount
    ? `Rated ${actualRating}/5 by ${formattedReviewCount}+ customers`
    : adCopy.subheadline || `★★★★★ ${actualRating}/5`;

  // Ensure headline is complete
  const words = adCopy.headline.split(' ');
  let headline = words.slice(0, 12).join(' ');
  const incompleteEndings = ['and', 'but', 'or', 'the', 'a', 'an', 'to', 'for', 'with', 'in', 'on', 'at', 'of', 'my', 'so', 'that', 'is', 'was'];
  const lastWord = headline.split(' ').pop()?.toLowerCase();
  if (lastWord && incompleteEndings.includes(lastWord)) headline = headline.split(' ').slice(0, -1).join(' ');

  const coreDirection = buildCoreCreativeDirection(brand, canvasSize, dimensions);

  return `Generate a premium, editorial-style ${aspectRatio} customer testimonial Meta ad.

${coreDirection}

THIS IS A SOCIAL PROOF AD — it should feel like an authentic customer endorsement on a premium brand's Instagram.

LAYOUT:

1. FIVE STARS — Top of canvas
   - 5 small, elegant filled stars in a horizontal row
   - Color: Gold (#D4A853) or brand accent color
   - Centered horizontally, positioned in top 8% of canvas
   - Small and tasteful — NOT oversized

2. TESTIMONIAL QUOTE — The HERO text element
   - Text: "${headline}"
   - In quotation marks ("..." style, elegant)
   - LARGE, bold, commanding serif or bold sans-serif
   - MAX 3 LINES. If text is too long, reduce font size to fit in 3 lines.
   - Centered horizontally, positioned in upper 20-40% of canvas
   - Color: ${brand.textColor}, bold weight
   - This should feel like a pull-quote from a magazine
   - Font: "${brand.headingFont}" or clean serif like Playfair Display

3. RATING LINE — Below the quote
   - Text: "${ratingLine}"
   - Smaller, lighter weight, understated
   - Single line, centered
   - Color: ${brand.textColor} at 60% opacity

4. PRODUCT — Lower half of canvas, centered
   - Product from attached image, LARGE and commanding
   - Professional lighting, dramatic but clean
   - Natural grounding or floating with soft shadow
   - Product takes up ~45% of canvas width

BACKGROUND:
- Rich, warm gradient using brand palette (tonal guide: ${brand.bgColor})
- NOT a flat single color
- Subtle texture or depth — could be a soft radial gradient, fabric-like texture, or warm bokeh
- Should feel premium, editorial, magazine-quality

CRITICAL DATA ACCURACY:
- The star rating is ${actualRating} out of 5. MUST appear exactly as "${actualRating}/5" if shown.
- Do NOT change, invent, or hallucinate any rating number.
- If the rating line says "1/5" that is WRONG. Use ${actualRating}/5.

WHAT NOT TO DO:
- Do NOT change the rating number — it MUST be ${actualRating}/5
- Do NOT make text blurry
- Do NOT add busy decorative elements
- Do NOT make the quote text small — it's the hero element

OUTPUT: EXACTLY ${canvasSize} pixels. ${dimensions}.`;
}

function buildComparisonPrompt(adCopy: AdCopyInput, aspectRatio: string, canvasSize: string, dimensions: string, brand: BrandValues): string {
  const oursPoints = adCopy.comparisonPoints?.ours?.map(p => `   ${p}`).join('\n') || '   ✓ Clean ingredients\n   ✓ Third-party tested\n   ✓ Full doses\n   ✓ No fillers';
  const theirsPoints = adCopy.comparisonPoints?.theirs?.map(p => `   ${p}`).join('\n') || '   ✗ Artificial additives\n   ✗ No testing\n   ✗ Underdosed\n   ✗ Hidden fillers';

  const coreDirection = buildCoreCreativeDirection(brand, canvasSize, dimensions);

  return `Generate a BOLD, high-impact ${aspectRatio} "Us vs Them" comparison Meta ad.

${coreDirection}

THIS IS A DEBATE AD — IT PICKS A FIGHT. The design should feel OPINIONATED and CONFIDENT.

LAYOUT:

1. HEADLINE — Full width across top
   - Text: "${adCopy.headline}"
   - NO banner, NO bar, NO box, NO colored rectangle behind the text
   - MASSIVE bold text rendered directly on the background
   - Text color: White or cream (on dark backgrounds) OR dark charcoal/black (on light backgrounds)
   - Add subtle text shadow for readability if background is complex
   - Should feel bold, confident, and clean — like the review template headline style
   - Takes up top 15-20% of canvas, centered

2. SPLIT COMPARISON — Two distinct columns below headline
   LEFT COLUMN (THE WINNER — our product):
   - Warm, positive background tint (use brand accent color at 15% opacity)
   - Green checkmarks (bold, modern style — not clip-art)
   - Points:
${oursPoints}
   - Text should be bold, confident, specific

   RIGHT COLUMN (THE LOSER — the competition):
   - Cool, muted, grey/washed-out background tint
   - Red X marks (bold, clear)
   - Points:
${theirsPoints}
   - Text should feel damning but factual

3. PRODUCT — Placed on the LEFT (winning) side, overlapping the center divider slightly
   - Product is the hero of the winning side
   - Angled slightly (~5-10° tilt) to add dynamism
   - Dramatic product lighting, premium feel

TEXT LENGTH RULE FOR COMPARISON POINTS:
- Each comparison point must be MAXIMUM 4 WORDS rendered in the image
- If the provided text is longer, use only the first 3-4 words or rephrase to be shorter
- Short = readable at phone size = better ad performance
- Example: "Activates AMPK for cellular repair" → render as "Cellular Repair"

DESIGN ENERGY: Think debate stage, confident brand, "the choice is obvious" energy
- Strong vertical divider between columns (can be subtle gradient fade or clean line)
- Typography: "${brand.headingFont}" for headline, "${brand.bodyFont}" for points
- Overall feel: Bold, editorial, makes the viewer instantly see which side wins

OUTPUT: EXACTLY ${canvasSize} pixels. ${dimensions}.`;
}

function buildBenefitsPrompt(adCopy: AdCopyInput, aspectRatio: string, canvasSize: string, dimensions: string, brand: BrandValues): string {
  const headline = adCopy.headline_primary || adCopy.headline || 'Premium Benefits';
  const benefits = adCopy.bulletPoints?.join('\n   • ') || adCopy.feature_benefits?.map(fb => fb.text).join('\n   • ') || 'Clean ingredients\n   • Science-backed\n   • Premium quality';

  const coreDirection = buildCoreCreativeDirection(brand, canvasSize, dimensions);

  return `Generate a bold, listicle-style ${aspectRatio} benefits advertisement for Meta.

${coreDirection}

THIS IS A "MINI LANDING PAGE" AD — clean, scannable, benefit-focused. Think of it as a listicle someone can absorb in 2 seconds.

LAYOUT:

1. HEADLINE — Top of canvas
   - Text: "${headline}"
   - NO box, NO banner, NO pill behind the text
   - BOLD, LARGE standalone text directly on the background
   - High contrast color against background (white on dark, dark on light)
   - Subtle text shadow if needed for readability
   - Max 2 lines
   - Centered

2. BENEFITS LIST — Vertically stacked, clean layout
   - Each benefit has a small thin line icon + text
   - Icons: thin line style (Lucide/Phosphor), colored with brand accent
   - Text: Clean, readable, 3-5 words each
   - Subtle separator or spacing between items
   - Benefits:
   • ${benefits}

3. PRODUCT — Positioned alongside or below the benefits list
   - Hero treatment, dramatic lighting
   - Can be slightly overlapping the benefits list for visual depth
   - Takes up ~40-50% of canvas width

BACKGROUND: Rich gradient or textured surface using brand palette (${brand.bgColor} as tonal guide). NOT flat.
TYPOGRAPHY: "${brand.headingFont}" for headline, "${brand.bodyFont}" for benefits.

WHAT NOT TO DO:
- Do NOT use a flat single-color background
- Do NOT make text small or hard to read
- Do NOT clutter with too many elements

OUTPUT: EXACTLY ${canvasSize} pixels. ${dimensions}.`;
}
