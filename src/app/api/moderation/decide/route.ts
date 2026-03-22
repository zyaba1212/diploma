import { NextResponse } from 'next/server';
import { handleModerationDecision, parseToStatus } from '@/lib/moderation/decideProposal';

type Body = {
  proposalId?: string;
  moderatorPubkey?: string;
  // Frontend may send `status`, architecture uses `decision` wording.
  decision?: string;
  status?: string;
  signature?: string; // optional base58 signature
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const proposalId = typeof body.proposalId === 'string' ? body.proposalId.trim() : '';
  const moderatorPubkey = typeof body.moderatorPubkey === 'string' ? body.moderatorPubkey.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature : undefined;

  const decisionOrStatus = typeof body.decision === 'string' ? body.decision : typeof body.status === 'string' ? body.status : '';
  const toStatus = decisionOrStatus ? parseToStatus(decisionOrStatus) : null;

  if (!proposalId) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!moderatorPubkey) return NextResponse.json({ error: 'moderatorPubkey is required' }, { status: 400 });
  if (!decisionOrStatus) return NextResponse.json({ error: 'decision is required' }, { status: 400 });
  if (!toStatus) return NextResponse.json({ error: 'invalid decision' }, { status: 400 });

  return handleModerationDecision(req, { proposalId, moderatorPubkey, toStatus, signature });
}

