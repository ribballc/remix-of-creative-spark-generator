import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LOVABLE_AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { productImageBase64 } = await req.json();

    if (!productImageBase64) {
      return new Response(
        JSON.stringify({ success: false, error: 'Product image is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log('Analyzing product image for color extraction...');

    // Step 1: Extract colors using vision model
    const colorResponse = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this product image and extract the dominant colors AND identify the fonts used on the product packaging/label. Return ONLY a JSON object with no markdown formatting, no code blocks, just raw JSON:

{
  "dominantColors": {
    "background": "#hex - the main background/surface color of the product or label",
    "accent": "#hex - the most vibrant/saturated accent color on the product",
    "text": "#hex - the primary text color used on the product label",
    "cta": "#hex - a bold color suitable for call-to-action buttons, from the product"
  },
  "mainProductColor": "#hex - the single most prominent, saturated, non-neutral color",
  "detectedFonts": {
    "heading": ["FontName1", "FontName2"] ,
    "body": ["FontName1", "FontName2"]
  }
}

For detectedFonts: Look at ALL text on the product packaging/label. Identify the font used for the main product name / headline (heading) and the font used for body text / descriptions (body). For each, provide your best 2-3 guesses of the closest well-known font names (e.g. "Montserrat", "Playfair Display", "Roboto", "Futura", "Helvetica Neue", "Georgia"). Base your guesses on the visual characteristics: weight, serif vs sans-serif, letter spacing, x-height, etc.

Extract colors ONLY from the product itself (packaging, label, branding), not from any background. Return actual hex values like #E8907A, not descriptions.`
              },
              {
                type: 'image_url',
                image_url: { url: productImageBase64 }
              }
            ]
          }
        ]
      }),
    });

    if (!colorResponse.ok) {
      const errorText = await colorResponse.text();
      console.error('AI color extraction error:', colorResponse.status, errorText);
      
      if (colorResponse.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (colorResponse.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'AI credits exhausted. Please add credits.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`AI color extraction error: ${colorResponse.status}`);
    }

    const colorData = await colorResponse.json();
    const colorContent = colorData.choices?.[0]?.message?.content || '';
    console.log('Color extraction response:', colorContent);

    const jsonMatch = colorContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse color data from AI response');
    }
    const parsedColors = JSON.parse(jsonMatch[0]);

    return new Response(
      JSON.stringify({ 
        success: true, 
        ...parsedColors
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error analyzing product image:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
