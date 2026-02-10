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
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase credentials not configured');
      return null;
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Convert base64 to blob
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    
    // Generate unique filename
    const filename = `creative_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
    
    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('generated-creatives')
      .upload(filename, binaryData, {
        contentType: 'image/png',
        upsert: false
      });
    
    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return null;
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('generated-creatives')
      .getPublicUrl(filename);
    
    const publicUrl = urlData.publicUrl;
    
    // Save to database
    const { error: dbError } = await supabase
      .from('generated_creatives')
      .insert({
        image_url: publicUrl,
        template_id: templateId,
        product_title: productTitle
      });
    
    if (dbError) {
      console.error('Database insert error:', dbError);
    }
    
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
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Create prompt based on template type
    let imagePrompt = buildPromptForTemplate(template, adCopy, productData, confirmedBrandKit);

    console.log('Generating creative with Lovable AI for template:', template.id);
    console.log('Prompt length:', imagePrompt.length);
    console.log('Has product image:', !!productImageUrl);
    console.log('Has reference image:', !!referenceImageUrl);
    console.log('Typography data:', productData?.typography || 'none');

    // Build messages array — send only the product cutout (transparent PNG) to the AI.
    // NO reference images — those caused white box hallucinations.
    // The AI integrates the product naturally with proper lighting and grounding.
    const messageContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: 'text', text: imagePrompt }
    ];

    // Send the product cutout so the AI can integrate it naturally into the scene
    if (productImageUrl) {
      const productUrl = productImageUrl.startsWith('data:') ? productImageUrl : `data:image/png;base64,${productImageUrl}`;
      messageContent.push({
        type: 'image_url',
        image_url: { url: productUrl }
      });
      console.log('Sending product cutout to AI for natural integration');
    }

    // Call Lovable AI with gemini-3-pro-image-preview
    const response = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-pro-image-preview',
        messages: [
          {
            role: 'user',
            content: messageContent
          }
        ],
        modalities: ['image', 'text']
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lovable AI error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'AI credits exhausted. Please add credits to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`Lovable AI error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Lovable AI response received');
    console.log('Full AI response structure:', JSON.stringify(Object.keys(data.choices?.[0]?.message || {})));

    // Check for errors embedded in the response
    const choiceError = data.choices?.[0]?.error;
    if (choiceError) {
      console.error('AI response contained error:', choiceError);
      
      const rawError = choiceError.metadata?.raw;
      if (rawError && (rawError.includes('429') || rawError.includes('RESOURCE_EXHAUSTED'))) {
        return new Response(
          JSON.stringify({ success: false, error: 'AI rate limit exceeded. Please wait a moment and try again.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: false, error: choiceError.message || 'AI generation failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract image URL from response with fallbacks
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url
      || (Array.isArray(data.choices?.[0]?.message?.content) 
          ? data.choices[0].message.content.find((c: any) => c.type === 'image')?.image_url?.url 
          : null)
      || null;

    if (!imageUrl) {
      console.error('No image in response:', JSON.stringify(data, null, 2));
      return new Response(
        JSON.stringify({ success: false, error: 'No image was generated. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Creative generated successfully');

    // Save to gallery in background
    const productTitle = productData?.title || 'Unknown Product';
    try {
      EdgeRuntime.waitUntil(
        saveCreativeToGallery(imageUrl, template.id, productTitle)
      );
    } catch {
      // Fallback: save without EdgeRuntime if not available
      saveCreativeToGallery(imageUrl, template.id, productTitle).catch(err =>
        console.error('Background save failed:', err)
      );
    }

    // AI now integrates the product directly — no programmatic compositing needed
    const responsePayload: Record<string, unknown> = { success: true, imageUrl };
    
    // Compositing is disabled — the AI generates the complete scene with product integrated
    responsePayload.compositing = { enabled: false };

    return new Response(
      JSON.stringify(responsePayload),
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

interface FeatureBenefitCallout {
  text: string;
  meaning_keywords: string;
  priority_rank: number;
}

interface AdCopyInput {
  headline: string;
  subheadline?: string;
  headline_primary?: string;
  subheadline_primary?: string;
  feature_benefits?: FeatureBenefitCallout[];
  bulletPoints?: string[];
  comparisonPoints?: { ours: string[]; theirs: string[] };
  reviewCount?: string;
  rating?: string;
  compliance_safe_version?: string;
}

interface BrandTypography {
  headingFont: string | null;
  bodyFont: string | null;
  fontSizes?: { h1?: string; h2?: string; body?: string } | null;
  fontStacks?: { heading?: string[]; body?: string[] } | null;
}

interface ConfirmedBrandKitInput {
  colors: { background: string; accent: string; text: string; cta: string };
  typography: { headingFont: string; bodyFont: string; h1Weight: number; h2Weight: number; bodyWeight: number };
  logo: string;
  productImageBase64: string;
}

function buildPromptForTemplate(
  template: { type: string; aspectRatio: string },
  adCopy: AdCopyInput,
  productData?: { typography?: BrandTypography; fonts?: any; title?: string; brandColors?: { primary: string; secondary: string; accent: string } },
  confirmedBrandKit?: ConfirmedBrandKitInput
): string {
  const aspectRatio = template.aspectRatio;
  const isVertical = aspectRatio === '9:16';
  const canvasSize = isVertical ? '1080x1920' : '1080x1080';
  const safeZone = isVertical ? '120px' : '90px';

  // Use confirmedBrandKit if available, fallback to productData
  const backgroundColor = confirmedBrandKit?.colors.background || productData?.brandColors?.primary || '#F5F5F5';
  const textColor = confirmedBrandKit?.colors.text || '#1A1A2E';
  const accentColor = confirmedBrandKit?.colors.accent || productData?.brandColors?.accent || '#4A90D9';
  const ctaColor = confirmedBrandKit?.colors.cta || '#E84855';

  const headingFont = confirmedBrandKit?.typography.headingFont || productData?.typography?.headingFont;
  const bodyFontName = confirmedBrandKit?.typography.bodyFont || productData?.typography?.bodyFont || headingFont;

  // For features_benefits, use the new structure with typography
  if (template.type === 'features_benefits') {
    return buildFeaturesBenefitsPrompt(adCopy, aspectRatio, canvasSize, safeZone, productData, confirmedBrandKit);
  }

  // Existing prompts for other template types
  const bulletPointsText = adCopy.bulletPoints?.join('\n') || '';
  
  // Ensure headline ends at a complete thought
  const words = adCopy.headline.split(' ');
  let truncatedHeadline = words.slice(0, 10).join(' ');
  
  const incompleteEndings = ['and', 'but', 'or', 'the', 'a', 'an', 'to', 'for', 'with', 'in', 'on', 'at', 'of', 'my', 'so', 'that', 'is', 'was'];
  const lastWord = truncatedHeadline.split(' ').pop()?.toLowerCase();
  if (lastWord && incompleteEndings.includes(lastWord)) {
    truncatedHeadline = truncatedHeadline.split(' ').slice(0, -1).join(' ');
  }
  
  // Build typography instructions
  const typographyInstructions = headingFont
    ? `
5. TYPOGRAPHY (MANDATORY — locked brand fonts):
- Headline font: "${headingFont}" (weight: ${confirmedBrandKit?.typography.h1Weight || 700})
- Body/callout font: "${bodyFontName || headingFont}" (weight: ${confirmedBrandKit?.typography.bodyWeight || 400})
- If the exact font name is not recognized, ANALYZE the attached product image and match the closest font style visible on the product packaging/branding. Replicate its weight, letter-spacing, and serif/sans-serif classification.
- ALL text in the creative MUST use these fonts consistently. No substitutions with generic system fonts.
`
    : '';

  // Extract brand background color with fallback
  const bgColorForPrompt = backgroundColor;

  const coreRequirements = `
LAYOUT AUTHORITY
- The prompt is the single source of truth for layout.
- No layout reinterpretation allowed.

RENDER ORDER (MANDATORY)
1. Generate a studio seamless paper background with professional 3-point lighting.
2. Place the attached product image naturally on the studio paper surface.
3. The product must look like a real studio photograph — proper lighting, grounding shadow, natural edges.
4. Place text and icons on top according to the layout below.
5. Text and icons must never affect product scale or position.

BACKGROUND RULES
- Studio seamless paper backdrop with soft, professional lighting.
- Background color: ${bgColorForPrompt} (confirmed brand color).
- If brand color is white (#FFFFFF), use warm off-white/cream (#F8F6F3) for depth.
- The paper sweeps from wall to floor in a smooth, continuous curve.
- 8K resolution quality.

PRODUCT INTEGRATION (CRITICAL)
- The attached image is the product. Place it naturally on the studio paper backdrop.
- The product must sit ON the surface — grounded with a natural contact shadow.
- Match the studio lighting to the product (soft key light from upper-left).
- Preserve the product EXACTLY as provided — do not alter, redraw, or stylize it.
- Do NOT add any other products, objects, or props.

TEXT AND ICON RULES
- Headline: Bold, max 2 lines. Reduce font size to fit. NEVER 3+ lines.
- Subheadline: Normal weight, max 1 line. NEVER wrap.
- Icons: Small (12-16px), minimal, centered per layout.
- Text color: ${textColor}. Must be at least 2 contrast levels from background.
- ALL text and icons must be HORIZONTALLY CENTERED on the canvas.

VALIDATION RULE
- If output deviates from layout in scale, spacing, or arrangement: regenerate.
${typographyInstructions}`;

  switch (template.type) {
    case 'comparison':
      const oursPoints = adCopy.comparisonPoints?.ours?.join('\n') || '✓ Clean ingredients\n✓ Third-party tested';
      const theirsPoints = adCopy.comparisonPoints?.theirs?.join('\n') || '✗ Artificial additives\n✗ No testing';
      
      return `Generate a professional ${aspectRatio} Comparison advertisement (Us vs Them).
${coreRequirements}

LAYOUT:
- Headline at top: "${truncatedHeadline}"
- Split design: LEFT (winning) vs RIGHT (losing)

LEFT SIDE (checkmarks):
${oursPoints}

RIGHT SIDE (X marks):
${theirsPoints}

PRODUCT — LEFT SIDE:
- Place the attached product image on the left/winning side.
- Product must sit naturally on the studio paper surface with grounding shadow.

SAFE ZONES: ${safeZone} padding on all sides. No elements may cross.
OUTPUT: ${canvasSize}`;

    case 'review':
      const reviewCount = adCopy.reviewCount || '25,000';
      const ratingLine = adCopy.subheadline || `Rated ${adCopy.rating || '4.8'}/5 for metabolic support`;
      
      return `Generate a professional ${aspectRatio} Customer Review advertisement.

LAYOUT AUTHORITY
- The prompt is the single source of truth for layout.
- No layout reinterpretation allowed.

RENDER ORDER (MANDATORY)
1. Generate a studio seamless paper background with professional 3-point lighting.
2. Background is a physical surface, not a flat color layer.
3. Place the attached product image naturally on the studio paper surface in the lower 60%.
4. Place text elements on top according to the layout below.

BACKGROUND RULES
- Studio seamless paper backdrop with soft, professional lighting.
- Background color: ${bgColorForPrompt} (confirmed brand color).
- If brand color is white (#FFFFFF), use warm off-white/cream (#F8F6F3) for depth.
- The paper sweeps from wall to floor in a smooth, continuous curve.
- Subtle gradient: slightly darker at top, lighter in middle, gentle shadow at curve.
- 8K resolution quality.
${typographyInstructions}

LAYOUT:

1. STARS AT TOP
   - 5 very small stars in a horizontal row (12-16px tall max)
   - Color: ${textColor}
   - Centered horizontally, positioned in the upper 10% of the canvas

2. PRIMARY REVIEW QUOTE: "${truncatedHeadline}"
   - HERO text - largest element
   - STRICT: EXACTLY 2 LINES MAXIMUM. If the text is too long, REDUCE the font size until it fits on exactly 2 lines. NEVER allow 3 or more lines.
   - Wrap in quotation marks
   - Color: ${textColor}, bold (700)
   - CENTERED horizontally, upper 25-35% of canvas
   - Maximum width: 80% of canvas width (864px on 1080px canvas)

3. RATING LINE: "${ratingLine}"
   - Below quote, smaller size
   - STRICT: EXACTLY 1 LINE. If text is too long, REDUCE font size until it fits on 1 line. NEVER wrap to 2 lines.
   - CENTERED horizontally
   - Color: ${textColor} at 70% opacity, normal weight (400)
   - Maximum width: 70% of canvas width (756px on 1080px canvas)

4. PRODUCT — LOWER CENTER
   - Place the attached product image in the lower 60% of the canvas
   - Product must sit naturally on the studio paper surface with grounding shadow
   - Centered horizontally, proportional to canvas size

TEXT RULES
- ONLY render the quote and rating line above. No other text.

SAFE ZONES: ${safeZone} padding on all sides.
OUTPUT: EXACTLY ${canvasSize} pixels. The image MUST be ${isVertical ? '1080 pixels wide and 1920 pixels tall' : '1080 pixels wide and 1080 pixels tall'}. No other dimensions.`;

    case 'benefits':
      return `Generate a professional ${aspectRatio} Pure Benefits advertisement.
${coreRequirements}

LAYOUT:
- Headline: "${truncatedHeadline}"
- Benefits list with icons (icons match text color)

BENEFITS TO DISPLAY:
${bulletPointsText || '• Bioavailable\n• Clean ingredients\n• Science-backed'}

PRODUCT — CENTER:
- Place the attached product image centered on the studio paper surface.
- Product must sit naturally with grounding shadow.

SAFE ZONES: ${safeZone} padding on all sides.
OUTPUT: ${canvasSize}`;

    default:
      return `Generate a professional ${aspectRatio} advertisement.
${coreRequirements}

Headline: "${truncatedHeadline}"
${bulletPointsText ? `Points: ${bulletPointsText}` : ''}

SAFE ZONES: ${safeZone} padding on all sides.
OUTPUT: ${canvasSize}`;
  }
}

function buildFeaturesBenefitsPrompt(
  adCopy: AdCopyInput,
  aspectRatio: string,
  canvasSize: string,
  safeZone: string,
  productData?: { typography?: BrandTypography; fonts?: any; title?: string; brandColors?: { primary: string; secondary: string; accent: string } },
  confirmedBrandKit?: ConfirmedBrandKitInput
): string {
  // Get headline and subheadline from new or legacy fields
  const headline = adCopy.headline_primary || adCopy.headline || 'Premium Quality';
  const subheadline = adCopy.subheadline_primary || adCopy.subheadline || '';
  
  // Get feature_benefits or convert from bulletPoints
  let featureBenefits: FeatureBenefitCallout[] = adCopy.feature_benefits || [];
  
  if (featureBenefits.length === 0 && adCopy.bulletPoints) {
    featureBenefits = adCopy.bulletPoints.slice(0, 4).map((bp, i) => ({
      text: bp.replace(/^[✓✗]\s*/, ''),
      meaning_keywords: 'general, quality',
      priority_rank: i + 1
    }));
  }
  
  // Sort by priority and take top 4
  const sortedCallouts = [...featureBenefits]
    .sort((a, b) => a.priority_rank - b.priority_rank)
    .slice(0, 4);
  
  // Format callouts for prompt
  const formattedCallouts = sortedCallouts.map((c, i) => 
    `   ${i + 1}. "${c.text}" (icon keywords: ${c.meaning_keywords})`
  ).join('\n');

  // Use compliance safe version if available
  const safeHeadline = adCopy.compliance_safe_version || headline;

  // Use confirmedBrandKit if available
  const bgColor = confirmedBrandKit?.colors.background || productData?.brandColors?.primary || '#F5F5F5';
  const txtColor = confirmedBrandKit?.colors.text || '#1A1A2E';
  const accentCol = confirmedBrandKit?.colors.accent || productData?.brandColors?.accent || '#4A90D9';
  const headFont = confirmedBrandKit?.typography.headingFont || productData?.typography?.headingFont;
  const bodyFnt = confirmedBrandKit?.typography.bodyFont || productData?.typography?.bodyFont || headFont;

  const typographyInstructions = headFont
    ? `
5. TYPOGRAPHY (MANDATORY — locked brand fonts):
- Headline font: "${headFont}" (weight: ${confirmedBrandKit?.typography.h1Weight || 700})
- Body/callout font: "${bodyFnt}" (weight: ${confirmedBrandKit?.typography.bodyWeight || 400})
- If the exact font name is not recognized, ANALYZE the attached product image and match the closest font style visible on the product packaging/branding. Replicate its weight, letter-spacing, and serif/sans-serif classification.
- ALL text in the creative MUST use these fonts consistently. No substitutions with generic system fonts.
`
    : '';

  const coreRequirements = `
LAYOUT AUTHORITY
- The prompt is the single source of truth for layout.
- No layout reinterpretation allowed.

RENDER ORDER (MANDATORY)
1. Generate a studio seamless paper background with professional 3-point lighting.
2. Place the attached product image naturally on the studio paper surface.
3. The product must look like a real studio photograph — proper lighting, grounding shadow, natural edges.
4. Place text, icons, and UI elements on top according to the layout below.
5. Text and icons must never affect product scale or position.

BACKGROUND RULES
- Studio seamless paper backdrop with soft, professional lighting.
- Background color: ${bgColor} (confirmed brand color).
- If brand color is white (#FFFFFF), use warm off-white/cream (#F8F6F3) for depth.
- The paper sweeps from wall to floor in a smooth, continuous curve.
- 8K resolution quality.

PRODUCT INTEGRATION (CRITICAL)
- The attached image is the product. Place it naturally on the studio paper backdrop.
- The product must sit ON the surface — grounded with a natural contact shadow.
- Preserve the product EXACTLY as provided — do not alter, redraw, or stylize it.

TEXT AND ICON RULES
- Headline: Bold, max 2 lines. Reduce font size to fit. NEVER 3+ lines.
- Subheadline: Normal weight, max 1 line. NEVER wrap.
- Icons: Small (12-16px), minimal. Color: ${txtColor}.
- Text color: ${txtColor}. At least 2 contrast levels from background.
- ALL text and icons HORIZONTALLY CENTERED.

VALIDATION RULE
- If output deviates from layout in scale, spacing, or arrangement: regenerate.
${typographyInstructions}`;

  return `Generate a professional ${aspectRatio} Features & Benefits Grid advertisement.
${coreRequirements}

LAYOUT:

1. HEADLINE BANNER AT TOP
   - Text: "${safeHeadline}"
   - Inside rounded rectangle banner with accent background color: ${accentCol}
   - Text color: White or light color for contrast
   - 2-4 words maximum, MAX 2 LINES
   - Horizontally centered, with padding inside banner

2. SUBHEADLINE PILL - OVERLAPPING HEADLINE
   - Text: "${subheadline}"
   - Inside rounded pill with DIFFERENT BACKGROUND than headline
   - CRITICAL: MAX 1 LINE — NEVER wrap
   - Horizontally centered
   - POSITION: Overlap the bottom edge of the headline banner by ~30-40%

3. PRODUCT — CENTER
   - Place the attached product image centered on the studio paper surface.
   - Product must sit naturally with grounding shadow.
   - Leave space for callout arrows to point toward the product.

4. FOUR CALLOUTS AROUND PRODUCT - STAGGERED POSITIONING
   - LEFT SIDE (top to bottom):
     - Callout 1: Upper-left of product
     - Callout 2: Lower-left of product (staggered down)
   - RIGHT SIDE (top to bottom):
     - Callout 3: Upper-right of product
     - Callout 4: Lower-right of product (staggered down)
   
   - Each callout consists of:
      a) ICON: SMALL (12-16px max — TINY, subtle), positioned to LEFT of text
      b) TEXT: 2-4 words, aligned after icon, CENTERED with icon
      c) CURVED ARROW: Arcs from callout TEXT toward product center
   
   - Callouts on left side: text right-aligned, arrows curve right toward product
   - Callouts on right side: text left-aligned, arrows curve left toward product

   Callouts:
${formattedCallouts}

ICON RULES:
- Icons positioned INLINE with callout text (icon then text)
- Use meaning_keywords for icon selection
- Same stroke weight and style for all icons (thin, elegant line icons)
- Icon color matches callout text color
- NO checkmarks, NO decorative icons
- Category-aware: supplements=body icons, skincare=droplet/sparkle, pet=paw/bowl

ARROW STYLE:
- Thin curved arrows (1-2px stroke)
- Arrow color matches text color or slightly lighter
- Arrows arc smoothly toward product center
- Arrowhead at product end (small, subtle)

COLOR EXTRACTION FROM PRODUCT:
- Headline banner: Use accent/vibrant color from product label
- Subheadline pill: Use secondary/muted color from product label
- These two backgrounds MUST be different colors
- Callout text: Use dark text color (charcoal/near-black) on light backgrounds

SAFE ZONES: ${safeZone} padding on all sides. No elements may cross.
OUTPUT: ${canvasSize}`;
}
