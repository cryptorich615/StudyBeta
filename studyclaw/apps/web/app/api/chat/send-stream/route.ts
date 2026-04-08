import { NextRequest } from 'next/server';

export const runtime = 'edge';

const EC2_API = 'http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:4000';

export async function POST(req: NextRequest) {
  const body = await req.json();

  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ec2Res = await fetch(`${EC2_API}/api/chat/send-stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  });

  if (!ec2Res.body) {
    return new Response(JSON.stringify({ error: 'upstream_error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(ec2Res.body, {
    status: ec2Res.status,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
