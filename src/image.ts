import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface ProcessedImage {
  content: string;      // "[Image: attachments/img-123-abc.jpg]"
  relativePath: string; // "attachments/img-123-abc.jpg"
}

export interface ImageAttachment {
  relativePath: string;
  mediaType: string; // always "image/jpeg" (normalized)
}

/**
 * Resize and normalize buffer to JPEG, save to group attachments dir.
 * Returns null on any error so callers can fall back to a text placeholder.
 */
export async function processImage(
  buffer: Buffer,
  groupDir: string,
  caption: string,
): Promise<ProcessedImage | null> {
  try {
    const attachmentsDir = path.join(groupDir, 'attachments');
    fs.mkdirSync(attachmentsDir, { recursive: true });

    const id = crypto.randomBytes(4).toString('hex');
    const filename = `img-${Date.now()}-${id}.jpg`;
    const filePath = path.join(attachmentsDir, filename);
    const relativePath = `attachments/${filename}`;

    await sharp(buffer)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(filePath);

    const label = caption ? `${relativePath}: ${caption}` : relativePath;
    return { content: `[Image: ${label}]`, relativePath };
  } catch {
    return null;
  }
}

/**
 * Scan message content strings for [Image: attachments/...] references
 * and return unique image attachments to pass to the container.
 */
export function parseImageReferences(
  messages: Array<{ content: string }>,
): ImageAttachment[] {
  const pattern = /\[Image: (attachments\/[^\]]+?)(?::[^\]]*)?\]/g;
  const seen = new Set<string>();
  const results: ImageAttachment[] = [];
  for (const msg of messages) {
    for (const match of msg.content.matchAll(pattern)) {
      const relativePath = match[1];
      if (!seen.has(relativePath)) {
        seen.add(relativePath);
        results.push({ relativePath, mediaType: 'image/jpeg' });
      }
    }
  }
  return results;
}
