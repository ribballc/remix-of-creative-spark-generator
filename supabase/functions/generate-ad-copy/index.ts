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
    const reviewCountRaw = (productData.reviewCount || '0').replace(/[^0-9]/g, '');
    const reviewCountNum = parseInt(reviewCountRaw);
    const formattedReviewCount = reviewCountNum.toLocaleString('en-US');
    const hasValidReviews = reviewCountNum > 0;
    const hasEnoughReviews = reviewCountNum >= 500;
    
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

META ADS COMPLIANCE RULES (MANDATORY — every piece of copy must follow these):
- NEVER claim to cure, treat, prevent, or diagnose any disease or medical condition
- NEVER use "clinically proven" unless the specific product has clinical trials
- NEVER use "guaranteed results" or "instant relief"
- NEVER imply the viewer has a health condition using second-person language like "your anxiety", "your depression", "your disease"
  - INSTEAD: Use inclusive/general framing: "feeling sluggish?" (not "your fatigue"), "want more energy?" (not "fix your exhaustion")
- NEVER generate negative self-perception: no body-shaming, no "you look old", no "your skin is damaged"
  - INSTEAD: Use aspiration: "Feel 10 years younger" → ALLOWED. "You look old" → BANNED.
- SAFE language patterns:
  - "Supports [function]" ✓ / "May help with [general wellness]" ✓ / "Formulated for [benefit]" ✓
  - "Cures [condition]" ✗ BANNED / "Treats [disease]" ✗ BANNED / "Proven to fix [problem]" ✗ BANNED
- For comparison ads: Compare to CATEGORIES ("quick-fix detoxes", "cheap supplements"), never to specific named competitor brands

Generate exactly 10 ad copy variations following these frameworks:

**6 Features and Benefits Grid ads (type: "features_benefits"):**
Each must include:
- headline_primary: 2-5 words that STOP THE SCROLL. Use one of these proven hook frameworks:
  * PROVOCATIVE QUESTION: "Your Gut Is Broken?" / "Still Swallowing Pills?" / "Tired Of Feeling Tired?"
  * BOLD CLAIM: "Detox Done Different" / "Your New Morning Ritual" / "The Last Supplement You'll Buy"
  * PATTERN INTERRUPT: "Wait... It Actually Works" / "Not Another Green Powder" / "Okay But This One Slaps"
  * ENEMY FRAMING: "Pills Are Dead" / "Goodbye Chemical Skincare" / "What Big Pharma Won't Tell You"
  - STRICT: 2-5 words maximum. Must be punchy, clever, and make someone curious.
  - BAD EXAMPLES (too generic, invisible on Meta): "Premium Quality", "Natural Solution", "Clean Formula", "Clinically Proven"
  - GOOD EXAMPLES (scroll-stopping): "Your Liver Called", "Detox Done Right", "Not Your Mom's Vitamins", "Skin So Good It's Suspicious"
- subheadline_primary: 4-8 words, a qualifying statement that adds credibility or intrigue BELOW the headline
  - This is the "oh wait, tell me more" line
  - GOOD: "Ancient herbs, modern capsules" / "Zero crash, pure focus, all day" / "What 10,000 women already know"
  - BAD: "With 500mg per serving" / "Premium blend of ingredients" (too clinical, no personality)
- feature_benefits: Array of EXACTLY 4 callouts, each with:
  - text: 2-4 words describing feature+benefit (e.g., "Clean Caffeine", "No Crash Energy")
  - meaning_keywords: comma-separated keywords for icon selection (e.g., "energy, caffeine, natural")
  - priority_rank: 1-4 (1 is highest priority)
- compliance_safe_version: A rewritten version of headline_primary that uses only Meta-safe language (e.g., "supports", "may help"). Include this for every features_benefits ad.

**2 Comparison-focused ads (type: "comparison"):**
- headline: A bold, opinionated "Us vs Them" headline that picks a SPECIFIC fight. Not generic. Name the enemy category.
  - GOOD: "Us vs 'Quick Fix' Detoxes" / "This vs Your Medicine Cabinet" / "Real Food vs Lab Food"
  - BAD: "Us vs The Competition" / "Our Product vs Others" (too vague, zero personality)
- NO subheadline needed
- DEDUPLICATION RULE: Every comparison point (both "us" and "them") must be UNIQUE. NEVER repeat the same point or a close paraphrase. Each "ours" point must cover a DIFFERENT benefit. Each "theirs" must highlight a DIFFERENT weakness. Before finalizing, verify no two points say the same thing.
- comparisonPoints with "ours" (4 positive points with ✓) and "theirs" (4 negative points with ✗)
  - Each point must be MAX 4 WORDS. Not sentences. Punchy fragments.
  - ours GOOD: "✓ Ancient botanicals" / "✓ Works in days" / "✓ Zero crash energy" / "✓ Third-party tested"
  - ours BAD: "✓ Activates AMPK for cellular repair" (too long, too clinical, nobody reads this on an ad)
  - theirs GOOD: "✗ Synthetic fillers" / "✗ Wears off fast" / "✗ Untested ingredients" / "✗ Crash by noon"
  - theirs BAD: "✗ Ignoring cognitive and cardiovascular health" (way too long, sounds like a textbook)
  - STRICT: Count the words. If any point exceeds 4 words, shorten it. Brevity = impact.

${hasValidRating && hasValidReviews ? `**2 Review/Social proof style ads (type: "review"):**
- headline: 6-12 words — a BELIEVABLE, SPECIFIC customer testimonial. Must sound like a real person texting their friend, not a marketing department writing copy.
  - Include a SPECIFIC, TANGIBLE result or moment. Vague praise = invisible ad.
  - GOOD: "I stopped craving sugar by week two" / "My husband asked what I'm doing differently" / "Three months in and my bloodwork shocked my doctor"
  - BAD: "Great product would recommend" / "This changed my life" / "Amazing results" (too generic, sounds fake)
  - CRITICAL: Must end at a natural sentence break. Never cut off mid-thought.
- subheadline: Rating line. CRITICAL RULES:
  ${hasEnoughReviews ? `- Show "Rated ${productData.rating}/5 by ${formattedReviewCount}+ customers"` : `- Show ONLY the star rating like "★★★★★ ${productData.rating}/5" — do NOT show review count under 500`}
  - NEVER invent or inflate review counts
- reviewCount: "${productData.reviewCount}"
- rating: "${productData.rating}"` : `**2 Additional Features and Benefits ads:**
- Since no reviews, create 2 more features_benefits type ads instead`}

Respond ONLY with a valid JSON array. Example format:

[
  {
    "headline_primary": "Your Gut Called",
    "subheadline_primary": "Ancient herbs, modern capsules",
    "feature_benefits": [
      { "text": "Clean Caffeine", "meaning_keywords": "energy, caffeine, natural", "priority_rank": 1 },
      { "text": "No Crash", "meaning_keywords": "sustained, smooth, balanced", "priority_rank": 2 },
      { "text": "L-Theanine Blend", "meaning_keywords": "calm, focus, amino", "priority_rank": 3 },
      { "text": "B-Vitamin Support", "meaning_keywords": "metabolism, vitamins, energy", "priority_rank": 4 }
    ],
    "type": "features_benefits"
  },
  {
    "headline": "This vs Your Medicine Cabinet",
    "type": "comparison",
    "comparisonPoints": {
      "ours": ["✓ 12 ancient botanicals", "✓ Works in 7 days", "✓ Zero crash energy", "✓ No synthetic fillers"],
      "theirs": ["✗ Synthetic fillers", "✗ Wears off by noon", "✗ Weird aftertaste", "✗ Hidden blends"]
    }
  }${hasValidRating && hasValidReviews ? `,
  {
    "headline": "I stopped craving sugar by week two",
    "subheadline": "${hasEnoughReviews ? `Rated ${productData.rating}/5 by ${productData.reviewCount}+ customers` : `★★★★★ ${productData.rating}/5`}",
    "type": "review",
    "reviewCount": "${productData.reviewCount}",
    "rating": "${productData.rating}"
  }` : ''},
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
          { role: 'system', content: 'You are a world-class DTC performance creative strategist who writes scroll-stopping ad copy for Meta ads. Your copy has generated $100M+ in revenue for brands like AG1, Grüns, Obvi, and RYZE. You write SHORT, PUNCHY, PROVOCATIVE copy that makes people stop scrolling. Your headlines are clever — they use curiosity gaps, provocative questions, bold claims, or pattern interrupts. You NEVER write generic marketing speak like "Premium Quality" or "Natural Solution." You write like a witty friend giving a real recommendation, not a corporation writing ad copy. You also have deep expertise in Meta ads compliance — every headline and piece of copy you write is designed to pass Meta ad review without getting flagged. You never make disease claims, never use "clinically proven" without basis, never create negative self-perception, and always frame health benefits as "supports" or "may help" rather than "cures" or "treats". Always respond with valid JSON only, no markdown formatting.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.95,
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
