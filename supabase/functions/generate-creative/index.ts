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
  const productBenefits = productData?.benefits?.slice(0, 5)?.join(', ') || 'general wellness';
  const productFeatures = productData?.features?.slice(0, 5)?.join(', ') || '';
  const productCategory = productData?.description?.substring(0, 300) || '';
  const productPrice = productData?.price || '';
  const safeZone = '40px';

  return `You are the most awarded creative director in DTC advertising. You've made ads for brands like Liquid Death, Oatly, Dollar Shave Club, and Surreal Cereal. You think in IDEAS first, visuals second. Your ads make people screenshot them and send to friends.

PRODUCT TO ADVERTISE:
- Name: ${productTitle}
- Benefits: ${productBenefits}
- Features: ${productFeatures}
- Description: ${productCategory}
${productPrice ? `- Price: ${productPrice}` : ''}
- Brand colors: ${brand.bgColor} (background), ${brand.accentColor} (accent)

STUDY THE ATTACHED PRODUCT IMAGE CAREFULLY. You need to:
1. Understand what this product looks like physically
2. Match the typography style from the packaging
3. Use the brand's color palette as your guide
4. Reproduce the product accurately in your scene

YOUR TASK: Generate a ${aspectRatio} advertisement with a BRILLIANT creative concept.

BEFORE you design anything, you must FIRST come up with a CREATIVE IDEA — a conceptual hook that makes this ad memorable. Then build the visual around that idea.

HERE ARE THE CREATIVE FRAMEWORKS (pick ONE randomly — genuinely randomize, don't default to the same one):

FRAMEWORK 1 — ABSURD VISUAL METAPHOR
Take the product's core benefit and visualize it through something IMPOSSIBLE or SURREAL that could never exist in real life. The more unexpected the better.
- If product helps with AGING → What if aging was a chess match and the product is the winning move? What if wrinkles were cracks in a wall being repaired by tiny painters? What if gray hair was wires being replaced with fiber optics?
- If product helps with ENERGY → What if a human battery had a low charge indicator? What if someone was plugging themselves into a wall outlet? What if a gas station pumped the product instead of fuel?
- If product helps with SKIN → What if skin was a canvas being painted by tiny artists? What if pores were volcanoes being sealed? What if the product was served at a fancy restaurant on a silver platter to your face?
- If product helps with DIGESTION → What if the gut was a garden being tended? What if bloating was a balloon animal that the product deflates? What if the product was a tiny plumber fixing pipes inside a body?
- If product is for PETS → What if the pet was a food critic at a fancy restaurant? What if the pet was a CEO running a board meeting about their dinner? What if the product fell from the sky like manna?
The KEY: it must be a visual you've NEVER seen before. If you've seen it in a stock photo, it's not creative enough.

FRAMEWORK 2 — CLEVER OBJECT PLAY
Place the product INTO, ONTO, or NEXT TO a real-world object in a way that creates a visual PUNCHLINE — a moment of "oh that's clever."
- Product frozen inside an ice block ("break glass in case of emergency")
- Product balancing on a tightrope between two problems it solves
- Product emerging from a cracked egg like it was born
- Product sitting in a museum display case with a "priceless" label
- Product used as the weight on a balance scale against a pile of competitor bottles
- Product placed inside a first aid kit as the only item
- Product as the last piece of a jigsaw puzzle clicking into place
The KEY: the object interaction must CREATE A MEANING. It's not just "product next to an hourglass." It's "product INSIDE the hourglass replacing the sand."

FRAMEWORK 3 — SCENE THAT TELLS A MICRO-STORY
Create a single image that implies a before, during, or after — a frozen moment in a story the viewer's brain completes.
- Someone reaching for the product on a shelf while their other hand drops a competitor in a trash can
- A medicine cabinet with everything crossed out except the product
- A "breaking news" TV screen format announcing the product
- A dating profile for the product ("likes: long walks, clean ingredients. Dislikes: fillers")
- A product lineup where every other product is grey/faded and only this one is in color
- An "employee of the month" wall where the product's photo is in every frame
The KEY: the viewer should FEEL something — humor, surprise, recognition, "that's so true."

FRAMEWORK 4 — SCALE PLAY / PERSPECTIVE TRICK
Use dramatic scale differences to create visual impact.
- GIANT product towering over a tiny cityscape
- TINY people climbing the product like a mountain
- Product held between two fingers against a massive landscape
- Macro close-up of the product's texture/ingredients with tiny people exploring it
- Product as a building in a skyline
- Product casting a shadow that reveals what it does (shadow shaped like a shield, a brain, a heart, etc.)
The KEY: the scale shift must feel intentional and meaningful, not random.

FRAMEWORK 5 — CULTURAL MASHUP / FORMAT HIJACK
Borrow a visual format people already recognize and insert the product into it.
- Movie poster style (dramatic lighting, credits at bottom)
- Mugshot format ("wanted: for making other supplements obsolete")
- Recipe card format but the "recipe" is just "Step 1: take this. Step 2: feel amazing."
- Nutrition label format but ENORMOUS, comparing to competitors
- Text message screenshot between two people discussing the product
- Social media post format (Instagram story, tweet, etc.)
- Museum exhibition placard next to the product
The KEY: the borrowed format must be instantly recognizable AND create humor or intrigue when the product is inserted.

CRITICAL CREATIVE RULES:
1. THE IDEA COMES FIRST. If you can't describe the concept in one sentence that makes someone smile or think "that's clever," the idea isn't strong enough. Start over.
2. NEVER use the most obvious metaphor. Hourglass for aging? Too obvious. Clock for time? Too obvious. Brain for thinking? Too obvious. Go TWO LEVELS DEEPER. What's an unexpected way to show aging? A crumbling sandcastle being rebuilt. A vintage car getting a fresh coat of paint. A phoenix. A software update downloading on a human.
3. THE PRODUCT MUST BE THE HERO. The concept SERVES the product, not the other way around. The product should be the most prominent, sharpest, best-lit element in the scene.
4. HUMOR > DRAMA. Clever and witty beats dark and moody 4 out of 5 times. The best DTC ads make you smile, not worry.
5. SPECIFICITY > GENERALITY. "Socks frozen in an ice block" is better than "cold weather socks." "Tiny people climbing on teeth" is better than "dental care." The more SPECIFIC and DETAILED the concept, the better.

HEADLINE RULES:
- 2-8 words. Punchy. Has personality.
- The headline should COMPLETE the visual concept — scene + headline together tell the full story
- Has a voice. Could be witty, deadpan, confident, cheeky, or knowing.
- GOOD: "Too Long Between Shaves?", "In Case Of Frozen Toes, Break Glass", "For Cats Who Crave The Real Thing", "Baby Smooth Shaves", "Healthy Gut Healthy Butt", "The Last Pan You'll Ever Need", "A Tinted Moisturizer For Non-Foundation People", "Remember When Life Felt Brighter?", "Strength From The Source"
- BAD: "Reverse The Clock" (generic), "Premium Quality" (invisible), "Natural Solution" (meaningless), "Feel Better Today" (forgettable), "The Power Of Nature" (cliché)
- The headline should make someone CURIOUS, make them SMILE, or make them THINK. If it does none of those, rewrite it.

EDUCATION COPY (below headline):
- 1-2 short lines, lighter weight
- This is where you explain what the product actually does in plain language
- Can be straightforward since the headline/visual does the creative heavy lifting
- Max 15 words total

OPTIONAL BOTTOM PILLS:
- 2-3 small keyword badges (e.g., "HEALTHY AGING | BRAIN SUPPORT")
- Only if they add value. Skip if the ad is cleaner without them.

VISUAL EXECUTION QUALITY:
- PHOTOGRAPHIC REALISM: Must look like a real photograph or a Photoshop composite by a senior designer. NOT digital illustration, NOT 3D render look, NOT AI art
- LIGHTING: Dramatic, directional, with purpose. One key light. Real shadows. Natural falloff. The lighting should ENHANCE the concept.
- COLOR PALETTE: Pulled from the product's brand colors. Cinematic grade. NOT oversaturated. NOT neon. Think commercial photography color science.
- TYPOGRAPHY: Match the font style from the product packaging. Bold, confident, well-kerned. The type should look like a professional typographer set it.
- COMPOSITION: Magazine-quality. Editorial. NOT centered and symmetric unless that's intentional. Use the rule of thirds. Let the concept BREATHE.
- TEXTURE & DETAIL: Every surface has realistic texture. Wood grain, fabric weave, metal patina, glass refraction. NO waxy smooth AI surfaces.
- DEPTH: Realistic depth of field. Product sharp, some background elements soft. NOT everything in perfect focus.

PRODUCT INTEGRATION:
- Product must be SHARP, well-lit, label ACCURATELY reproduced from the attached image
- Product sits naturally in the scene — on a surface, held by someone, integrated into the concept
- Product takes up 15-30% of canvas
- The brand name on the product must be readable

TEXT CONTRAST: White on dark, dark on light. Always. Text shadow on complex backgrounds. Squint test.
FULL BLEED: No borders, no frames, no card edges. Edge to edge.
SAFE ZONES: ${safeZone} padding for text.
OUTPUT: EXACTLY ${canvasSize} pixels.

FINAL CHECK — Before outputting, ask yourself:
1. Would a creative director at a $100M DTC brand approve this concept?
2. Would someone screenshot this ad and send it to a friend?
3. Is there a SPECIFIC IDEA here, or is it just "product + aesthetic background"?
4. Does the headline have PERSONALITY or is it generic marketing speak?
5. Would this concept work ONLY for this specific product, or could it apply to anything? (If anything → too generic, redo it)
If any answer is no, START OVER with a different concept.`;
}
