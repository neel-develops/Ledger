/**
 * Preparing a photo to send.
 *
 * A phone camera produces 4–8 MB images; serverless request bodies stop at
 * 4.5 MB, and base64 adds a third on top. So photos are drawn onto a canvas at
 * a sensible size and re-encoded as JPEG on the device. A receipt stays
 * perfectly legible at 1600 px on the long side, and lands around 200–500 KB.
 *
 * Re-encoding also drops EXIF — including the GPS location a phone camera
 * quietly writes into every photo.
 */

export interface PreparedImage {
  /** Base64 without the data: prefix, ready for the API. */
  data: string;
  mediaType: 'image/jpeg';
  /** For showing a preview locally. */
  dataUrl: string;
  byteSize: number;
}

export class ImageError extends Error {}

export async function prepareImage(file: File, maxEdge = 1600, quality = 0.82): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new ImageError('That is not a photo.');

  let bitmap: ImageBitmap;
  try {
    // Honours the camera's orientation flag, so portrait receipts stay upright.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageError(
      file.type === 'image/heic' || file.type === 'image/heif'
        ? 'This phone saved the photo as HEIC, which the browser cannot read. Try a screenshot of it instead.'
        : 'That photo could not be opened.',
    );
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new ImageError('That photo could not be processed.');

  // A white backing, so transparent PNG screenshots do not turn black as JPEG.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const byteSize = Math.floor((data.length * 3) / 4);

  if (byteSize > 3 * 1024 * 1024) throw new ImageError('That photo is still too large after shrinking it.');

  return { data, mediaType: 'image/jpeg', dataUrl, byteSize };
}
