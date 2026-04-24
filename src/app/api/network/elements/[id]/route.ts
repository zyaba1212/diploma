import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Params = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const elementId = typeof id === 'string' ? id.trim() : '';

  if (!elementId) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  try {
    const el = await prisma.networkElement.findUnique({
      where: { id: elementId },
      include: { provider: true },
    });

    if (!el) return NextResponse.json({ error: 'not found' }, { status: 404 });

    return NextResponse.json(
      {
        element: {
          id: el.id,
          scope: el.scope,
          type: el.type,
          providerId: el.providerId,
          name: el.name,
          sourceId: el.sourceId,
          sourceUrl: el.sourceUrl,
          lat: el.lat,
          lng: el.lng,
          altitude: el.altitude,
          metadata: el.metadata,
        },
        provider: el.provider
          ? {
              id: el.provider.id,
              name: el.provider.name,
              scope: el.provider.scope,
              sourceUrl: el.provider.sourceUrl,
            }
          : null,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}

