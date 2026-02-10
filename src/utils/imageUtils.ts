/**
 * Convert an image URL (including blob URLs and imported assets) to Base64
 */
export async function imageUrlToBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert a File object to Base64
 */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export interface ProductPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompositingData {
  enabled: boolean;
  canvasWidth: number;
  canvasHeight: number;
  productPosition: ProductPosition;
}

/**
 * Composite the original product image onto the AI-generated scene
 * using the Canvas API. Returns a base64 data URL of the final image.
 */
export async function compositeImages(
  sceneImageUrl: string,
  productImageUrl: string,
  compositing: CompositingData
): Promise<string> {
  const { canvasWidth, canvasHeight, productPosition } = compositing;

  // Load both images
  const [sceneImg, productImg] = await Promise.all([
    loadImage(sceneImageUrl),
    loadImage(productImageUrl),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d')!;

  // Fill with solid white first to eliminate any transparency
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Draw the AI-generated scene (background)
  ctx.drawImage(sceneImg, 0, 0, canvasWidth, canvasHeight);

  // Calculate aspect-preserving size, BOTTOM-ANCHORED so product sits on surface
  const { x, y, width, height } = productPosition;
  const imgAspect = productImg.naturalWidth / productImg.naturalHeight;
  const boxAspect = width / height;

  let drawW: number, drawH: number, drawX: number, drawY: number;

  if (imgAspect > boxAspect) {
    // Image is wider than box – fit to width, anchor bottom
    drawW = width;
    drawH = width / imgAspect;
    drawX = x;
    drawY = y + height - drawH; // bottom-anchor
  } else {
    // Image is taller than box – fit to height, center horizontally, anchor bottom
    drawH = height;
    drawW = height * imgAspect;
    drawX = x + (width - drawW) / 2;
    drawY = y + height - drawH; // bottom-anchor (same as y when fit to height)
  }

  // Draw realistic studio paper shadow — product sitting on seamless paper backdrop
  
  // 1. Large soft ambient shadow (simulates diffused studio light)
  const ambientGradient = ctx.createRadialGradient(
    drawX + drawW / 2, drawY + drawH, 0,
    drawX + drawW / 2, drawY + drawH, drawW * 0.7
  );
  ambientGradient.addColorStop(0, 'rgba(0, 0, 0, 0.10)');
  ambientGradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.05)');
  ambientGradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.02)');
  ambientGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = ambientGradient;
  ctx.beginPath();
  ctx.ellipse(drawX + drawW / 2, drawY + drawH + 4, drawW * 0.65, drawH * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  // 2. Medium contact shadow (key light from upper-left creates directional shadow)
  const contactGradient = ctx.createRadialGradient(
    drawX + drawW / 2 + drawW * 0.03, drawY + drawH, 0,
    drawX + drawW / 2 + drawW * 0.03, drawY + drawH, drawW * 0.38
  );
  contactGradient.addColorStop(0, 'rgba(0, 0, 0, 0.18)');
  contactGradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.08)');
  contactGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = contactGradient;
  ctx.beginPath();
  // Slightly offset right to match key light from upper-left
  ctx.ellipse(drawX + drawW / 2 + drawW * 0.03, drawY + drawH + 2, drawW * 0.38, drawH * 0.025, 0, 0, Math.PI * 2);
  ctx.fill();

  // 3. Tight core shadow directly at the product base (darkest, sharpest)
  const coreGradient = ctx.createRadialGradient(
    drawX + drawW / 2, drawY + drawH, 0,
    drawX + drawW / 2, drawY + drawH, drawW * 0.22
  );
  coreGradient.addColorStop(0, 'rgba(0, 0, 0, 0.28)');
  coreGradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.10)');
  coreGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = coreGradient;
  ctx.beginPath();
  ctx.ellipse(drawX + drawW / 2, drawY + drawH + 1, drawW * 0.22, drawH * 0.012, 0, 0, Math.PI * 2);
  ctx.fill();

  // Draw the original product image on top
  ctx.drawImage(productImg, drawX, drawY, drawW, drawH);

  // Export as JPEG to guarantee no transparency in output
  return canvas.toDataURL('image/jpeg', 0.95);
}

/**
 * Strip transparency from a base64 image by drawing it onto a white-backed canvas
 * and exporting as JPEG. Works for any image format.
 */
export async function stripTransparency(imageUrl: string): Promise<string> {
  const img = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.95);
}

/**
 * Composite a product image centered onto a studio backdrop.
 * The product is placed in the lower-center of the backdrop with studio shadows.
 * Returns a JPEG base64 data URL.
 */
export async function compositeProductOnBackdrop(
  backdropUrl: string,
  productUrl: string
): Promise<string> {
  const [backdrop, product] = await Promise.all([
    loadImage(backdropUrl),
    loadImage(productUrl),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = backdrop.naturalWidth;
  canvas.height = backdrop.naturalHeight;
  const ctx = canvas.getContext('2d')!;

  // Draw backdrop
  ctx.drawImage(backdrop, 0, 0, canvas.width, canvas.height);

  // Size product to ~60% of canvas width, preserving aspect ratio
  const maxW = canvas.width * 0.6;
  const maxH = canvas.height * 0.65;
  const imgAspect = product.naturalWidth / product.naturalHeight;

  let drawW: number, drawH: number;
  if (imgAspect > maxW / maxH) {
    drawW = maxW;
    drawH = maxW / imgAspect;
  } else {
    drawH = maxH;
    drawW = maxH * imgAspect;
  }

  // Center horizontally, position in lower-center (product sits on surface)
  const drawX = (canvas.width - drawW) / 2;
  const drawY = canvas.height * 0.55 - drawH / 2;

  // Ambient shadow
  const ambientGradient = ctx.createRadialGradient(
    drawX + drawW / 2, drawY + drawH, 0,
    drawX + drawW / 2, drawY + drawH, drawW * 0.7
  );
  ambientGradient.addColorStop(0, 'rgba(0, 0, 0, 0.12)');
  ambientGradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.05)');
  ambientGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = ambientGradient;
  ctx.beginPath();
  ctx.ellipse(drawX + drawW / 2, drawY + drawH + 4, drawW * 0.6, drawH * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // Contact shadow
  const contactGradient = ctx.createRadialGradient(
    drawX + drawW / 2, drawY + drawH, 0,
    drawX + drawW / 2, drawY + drawH, drawW * 0.25
  );
  contactGradient.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
  contactGradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.08)');
  contactGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = contactGradient;
  ctx.beginPath();
  ctx.ellipse(drawX + drawW / 2, drawY + drawH + 2, drawW * 0.25, drawH * 0.015, 0, 0, Math.PI * 2);
  ctx.fill();

  // Draw the product
  ctx.drawImage(product, drawX, drawY, drawW, drawH);

  return canvas.toDataURL('image/jpeg', 0.95);
}

/**
 * Chroma-key: convert green-screen (#00FF00) pixels to transparent.
 * Returns a base64 PNG with true alpha transparency.
 */
export async function chromaKeyGreen(imageUrl: string): Promise<string> {
  const img = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (g > 180 && r < 120 && b < 120) {
      data[i + 3] = 0;
    } else if (g > 150 && g > r * 1.4 && g > b * 1.4) {
      const greenness = (g - Math.max(r, b)) / g;
      data[i + 3] = Math.round(255 * (1 - greenness));
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Remove white/near-white background pixels and make them transparent.
 * Returns a base64 PNG with alpha transparency.
 */
export async function removeWhiteBackground(imageUrl: string): Promise<string> {
  const img = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Pure white / near-white pixels → fully transparent
    if (r > 240 && g > 240 && b > 240) {
      data[i + 3] = 0;
    }
    // Semi-white edge pixels → partial transparency for anti-aliasing
    else if (r > 220 && g > 220 && b > 220) {
      const whiteness = (r + g + b) / (255 * 3);
      data[i + 3] = Math.round(255 * (1 - whiteness));
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Resize a base64 image to fit within maxDim (preserving aspect ratio).
 * Returns a JPEG base64 data URL. Useful for shrinking payloads before sending to edge functions.
 */
export async function resizeBase64Image(imageUrl: string, maxDim = 1024, quality = 0.85): Promise<string> {
  const img = await loadImage(imageUrl);
  const { naturalWidth: w, naturalHeight: h } = img;
  if (w <= maxDim && h <= maxDim) return imageUrl; // already small enough

  const scale = Math.min(maxDim / w, maxDim / h);
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, nw, nh);
  return canvas.toDataURL('image/jpeg', quality);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
