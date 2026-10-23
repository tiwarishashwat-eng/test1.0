import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '../../shared/validation.js';

/** Reads and validates an image file in the browser (the server validates again). */
export function readImageFile(file: File): Promise<{ dataUri: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      reject(new Error('Please choose a JPEG, PNG, or WebP image.'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error('The photo must be 5MB or smaller.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUri: reader.result as string, mimeType: file.type });
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}
