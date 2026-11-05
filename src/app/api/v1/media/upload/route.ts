import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { errMessage } from '@/lib/errors';

/**
 * Issues client-upload tokens so browsers upload media straight to Blob (functions cap
 * request bodies at 4.5 MB, far below typical video sizes).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // Token generation is the authenticated step; Blob's completion callback is not user-signed.
        const user = await requireUser(req, new DbRepo());
        if (!pathname.startsWith(`uploads/${user.id}/`)) throw new Error('Invalid upload path.');
        return {
          allowedContentTypes: ['video/*', 'audio/*', 'image/*'],
          maximumSizeInBytes: 1024 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Upload failed' }, { status: 400 });
  }
}
