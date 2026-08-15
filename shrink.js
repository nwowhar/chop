// ============================================================
// Shrink screenshots before they go anywhere.
//
// An iPhone screenshot is ~1200x2600 and 1.5 MB. Base64 adds a
// third on top, so two of them is over 4 MB going up to Gemini,
// and the token count scales with pixels.
//
// 1100px on the long edge keeps caption text comfortably legible
// while cutting the file to roughly a tenth. Everything
// downstream gets faster: the upload, the function's download,
// the base64, and the model call itself.
// ============================================================

const MAX_EDGE = 1100;
const QUALITY = 0.82;

export async function shrink(file) {
  // Small files and non-images pass straight through
  if (!file.type.startsWith('image/') || file.size < 200_000) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

    if (scale === 1) { bitmap.close(); return file; }

    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise((res) =>
      canvas.toBlob(res, 'image/jpeg', QUALITY));

    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
      type: 'image/jpeg',
    });
  } catch {
    // Any failure here is not worth blocking the import over
    return file;
  }
}
