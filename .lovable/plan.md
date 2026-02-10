

## Fix: Stop Reference Images from Causing White Box Artifacts

### Root Cause

The edge function (line 111-116) sends reference images to the AI for ALL templates. These reference images contain a product. Despite prompt instructions saying "leave product zone empty," the AI sees the product in the reference and attempts to replicate it -- producing white boxes and artifacts.

The Coconut Cult review template worked because it explicitly skips reference images. All other templates still send them.

### Solution

1. **Stop sending reference images to the AI** -- remove lines 111-116 entirely. The prompt text alone provides sufficient layout guidance. This matches the proven Coconut Cult pattern.

2. **Rewrite all template prompts** using the user's strict LAYOUT AUTHORITY framework with the mandatory render order:
   - Remove background first
   - Composite product onto studio seamless paper backdrop
   - Text and icons placed on top (never affecting product scale/position)

### Changes

#### File: `supabase/functions/generate-creative/index.ts`

**1. Remove reference image from AI input (lines 111-116)**

Delete the block that pushes `referenceImageUrl` into `messageContent`. The AI will receive ONLY the text prompt -- no images at all. This eliminates the source of the white box hallucination.

**2. Replace prompt structure for all templates**

Update `coreRequirements` and all template-specific prompts to use the user's strict framework:

```
LAYOUT AUTHORITY
- The wireframe/prompt is the single source of truth
- Extract bounding boxes from the wireframe description
- No layout reinterpretation allowed

RENDER ORDER (MANDATORY)
1. First, remove the product's original background (done programmatically before this step)
2. Composite the product into a studio seamless paper background with professional lighting
3. Background is a physical surface, not a flat color layer
4. After product is composited and grounded, text and icons go on top
5. Text and icons must never affect product scale or position

BACKGROUND RULES
- Studio seamless paper backdrop with soft, professional lighting
- No texture, no patterns, no lifestyle scenes
- Dark product = lighter 200-level background
- Light product = higher contrast 400-level background

PRODUCT ZONE
- This area must contain ONLY the continuous studio paper backdrop
- SOLID, seamless, no objects, no boxes, no product rendering
- The product will be composited programmatically after generation

ALPHA EDGE AND GROUNDING RULES
- Slightly soften product edges (done programmatically)
- Subtle grounding shadow beneath product (done programmatically)
- Product must never appear floating

TEXT AND ICON RULES
- Headline: Bold, max 2 lines
- Subheadline: Normal weight, max 1 line
- Icons: Small, minimal, centered per layout
- Text contrast: At least 2 contrast levels from background

VALIDATION RULE
- If output deviates from wireframe in scale, spacing, or layout: regenerate
```

This replaces the current `coreRequirements` block and is applied consistently across all template types (comparison, review, benefits, features_benefits).

**3. No changes to frontend compositing**

The `useCreativeGenerator.ts` pipeline and `compositeImages` utility remain unchanged -- they already implement the correct render order (background removal, then programmatic compositing with 3-layer shadows).

### What This Achieves

- AI receives zero images -- only text prompt instructions
- No reference image means no product for the AI to hallucinate
- Prompts use strict, non-negotiable layout authority language
- Matches the exact pattern that worked for the Coconut Cult
- Product fidelity is 100% preserved via programmatic compositing

