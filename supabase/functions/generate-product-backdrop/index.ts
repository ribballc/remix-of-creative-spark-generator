import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LOVABLE_AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

/**
 * Calculate relative luminance of a hex color (0 = black, 1 = white)
 */
function getLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Lighten or darken a hex color by a factor.
 * factor > 1 = lighten toward white, factor < 1 = darken toward black.
 */
function adjustColor(hex: string, targetShade: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  
  // Map shade to a blend factor: 200 → very light, 400 → medium
  // shade 200 = blend 75% toward white, shade 400 = blend 45% toward white
  let blendToWhite: number;
  if (targetShade <= 200) {
    blendToWhite = 0.78; // very light
  } else if (targetShade <= 300) {
    blendToWhite = 0.6;
  } else if (targetShade <= 400) {
    blendToWhite = 0.42;
  } else {
    blendToWhite = 0.25;
  }

  const nr = Math.round(r + (255 - r) * blendToWhite);
  const ng = Math.round(g + (255 - g) * blendToWhite);
  const nb = Math.round(b + (255 - b) * blendToWhite);
  
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { productBackgroundColor, mainProductColor } = await req.json();

    if (!productBackgroundColor) {
      return new Response(
        JSON.stringify({ success: false, error: 'Product background color is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Determine if product is dark or light based on its main color
    const colorToCheck = mainProductColor || productBackgroundColor;
    const luminance = getLuminance(colorToCheck);
    const isDark = luminance < 0.5;

    // Dark product → light backdrop (shade 200), Light product → darker backdrop (shade 400)
    const targetShade = isDark ? 200 : 400;
    const backdropColor = adjustColor(productBackgroundColor, targetShade);

    console.log(`Product color: ${colorToCheck}, luminance: ${luminance.toFixed(2)}, isDark: ${isDark}`);
    console.log(`Backdrop: shade ${targetShade}, color: ${backdropColor}`);

    // Generate empty studio backdrop
    const response = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image',
        messages: [
          {
            role: 'user',
            content: `Generate a photorealistic EMPTY studio product photography backdrop. Requirements:

- Seamless paper backdrop that curves from vertical wall to horizontal surface
- The paper color is exactly ${backdropColor} (a smooth, matte, uniform tone)
- Professional studio lighting: soft key light from upper-left, subtle fill light from the right, gentle rim light from behind
- The lighting creates a natural gradient on the paper — slightly brighter on the surface where a product would sit, subtle shadow in the curve
- NO product, NO objects, NO text — just the empty backdrop ready for a product to be placed on it
- The surface should look smooth and clean with a slight sheen from the studio lights
- Square format (1:1 aspect ratio), 1024x1024
- Photorealistic quality, like a real studio photograph`
          }
        ],
        modalities: ['image', 'text']
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('AI backdrop generation error:', response.status, errText);

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'AI credits exhausted. Please add credits.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`AI backdrop generation error: ${response.status}`);
    }

    const data = await response.json();
    const backdropImage = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!backdropImage) {
      throw new Error('No backdrop image returned from AI');
    }

    console.log('Studio backdrop generated successfully');

    return new Response(
      JSON.stringify({
        success: true,
        backdropBase64: backdropImage,
        backdropColor,
        targetShade,
        isDark
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating backdrop:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
