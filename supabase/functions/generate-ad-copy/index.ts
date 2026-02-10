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
    const { productData } = await req.json();

    if (!productData) {
      return new Response(
        JSON.stringify({ success: false, error: 'Product data is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    // Only include review info if there are actual reviews
    const hasValidReviews = productData.reviewCount && 
      productData.reviewCount.trim() !== '' && 
      productData.reviewCount !== '0' &&
      parseInt(productData.reviewCount.replace(/[^0-9]/g, '')) > 0;
    
    const hasValidRating = productData.rating && 
      productData.rating.trim() !== '' && 
      productData.rating !== '0' &&
      productData.rating !== '0.00' &&
      parseFloat(productData.rating) > 0;
    
    const reviewInfo = hasValidReviews ? `Review Count: ${productData.reviewCount} reviews` : '';
    const ratingInfo = hasValidRating ? `Rating: ${productData.rating}/5 stars` : '';

    const prompt = `You are generating ad copy for a DTC brand's Meta ads. Based on the following product info, generate scroll-stopping ad copy variations.

Product Title: ${productData.title}
Product Description: ${productData.description}
Features: ${productData.features.join(', ')}
Benefits: ${productData.benefits.join(', ')}
Price: ${productData.price || 'Not specified'}
${reviewInfo}
${ratingInfo}

Generate exactly 10 ad copy variations following these frameworks:

**6 Features and Benefits Grid ads (type: "features_benefits"):**
Each must include:
- headline_primary: 2-4 words that STOP THE SCROLL. Think provocative, curiosity-driven, or bold claims.
  - STRICT: 2, 3, or 4 words maximum. Count carefully.
  - GOOD examples: "Trouble Pooping?", "Ditch The Powder", "Pills Are Dead", "Your Gut Called", "Finally Good Nutrition"
  - BAD examples: "Premium Quality", "Natural Solution", "Clean Formula" — these are invisible on Meta, nobody stops scrolling for them
- subheadline_primary: 8 words MAX, single line, feature qualifier (ingredient, spec, or proof)
  - GOOD: "With 500mg L-Theanine per serving" (6 words)
  - BAD: "Contains clinically studied doses of premium ingredients daily" (too long)
- feature_benefits: Array of EXACTLY 4 callouts, each with:
  - text: 2-4 words describing feature+benefit (e.g., "Clean Caffeine", "No Crash Energy")
  - meaning_keywords: comma-separated keywords for icon selection (e.g., "energy, caffeine, natural")
  - priority_rank: 1-4 (1 is highest priority)

**2 Comparison-focused ads (type: "comparison"):**
- headline: Bold "Us vs Them" style headline — provocative and opinionated
- NO subheadline needed
- comparisonPoints with "ours" (4 positive points with ✓) and "theirs" (4 negative points with ✗)

${hasValidRating && hasValidReviews ? `**2 Review/Social proof style ads (type: "review"):**
- headline: A believable, specific, emotional customer quote (6-12 words). Must sound like a REAL person wrote it — conversational, specific, with a real outcome.
  - GOOD: "I've never had this much energy at 3pm", "My skin literally glows now and my husband noticed", "I stopped craving sugar after week two"
  - BAD: "Great product would recommend", "This supplement changed my life" — too generic
  - CRITICAL: Must end at a natural sentence break. Never cut off mid-thought.
- subheadline: rating callout like "Rated ${productData.rating}/5 by ${productData.reviewCount}+ happy customers"
- reviewCount: "${productData.reviewCount}"
- rating: "${productData.rating}"` : `**2 Additional Features and Benefits ads:**
- Since no reviews, create 2 more features_benefits type ads instead`}

Respond ONLY with a valid JSON array. Example format:

[
  {
    "headline_primary": "Trouble Pooping?",
    "subheadline_primary": "With 500mg L-Theanine per serving",
    "feature_benefits": [
      { "text": "Clean Caffeine", "meaning_keywords": "energy, caffeine, natural", "priority_rank": 1 },
      { "text": "No Crash", "meaning_keywords": "sustained, smooth, balanced", "priority_rank": 2 },
      { "text": "L-Theanine Blend", "meaning_keywords": "calm, focus, amino", "priority_rank": 3 },
      { "text": "B-Vitamin Support", "meaning_keywords": "metabolism, vitamins, energy", "priority_rank": 4 }
    ],
    "type": "features_benefits"
  },
  {
    "headline": "Us vs Generic Supplements",
    "type": "comparison",
    "comparisonPoints": {
      "ours": ["✓ Clean ingredients", "✓ Third-party tested", "✓ Full doses", "✓ No fillers"],
      "theirs": ["✗ Artificial additives", "✗ No testing", "✗ Underdosed", "✗ Hidden fillers"]
    }
  }${hasValidRating && hasValidReviews ? `,
  {
    "headline": "I've never had this much energy at 3pm",
    "subheadline": "Rated ${productData.rating}/5 by ${productData.reviewCount}+ happy customers",
    "type": "review",
    "reviewCount": "${productData.reviewCount}",
    "rating": "${productData.rating}"
  }` : ''}
]`;

    console.log('Generating ad copy for:', productData.title);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are a top-tier DTC performance creative strategist who has scaled brands like Grüns, AG1, Obvi, and Seed to $100M+. You write scroll-stopping ad copy that converts on Meta. Your copy is SHORT, PUNCHY, PROVOCATIVE, and BENEFIT-DRIVEN. You never write generic marketing speak. You write like a human talking to a friend, not a corporation talking to a customer. Always respond with valid JSON only, no markdown formatting.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded. Please try again in a moment.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ success: false, error: 'AI credits exhausted. Please add credits to continue.' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      throw new Error(`AI API error: ${response.status}`);
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || '';
    
    console.log('AI response content length:', content.length);

    let adCopies;
    try {
      let jsonStr = content.replace(/```json?\n?|\n?```/g, '').trim();
      const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (arrayMatch) jsonStr = arrayMatch[0];
      
      adCopies = JSON.parse(jsonStr);
      
      if (!Array.isArray(adCopies)) throw new Error('Response is not an array');

      // Post-process for backward compatibility
      adCopies = adCopies.map((copy: any) => {
        if (copy.type === 'features_benefits') {
          return {
            ...copy,
            headline: copy.headline_primary || copy.headline || 'Premium Quality',
            subheadline: copy.subheadline_primary || copy.subheadline,
            bulletPoints: copy.feature_benefits?.map((fb: any) => fb.text) || []
          };
        }
        return copy;
      });

    } catch (parseError) {
      console.error('Failed to parse AI response:', content.substring(0, 500));
      throw new Error('Failed to parse ad copy response');
    }

    console.log('Generated', adCopies.length, 'ad copies');

    return new Response(
      JSON.stringify({ success: true, adCopies }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error generating ad copy:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
