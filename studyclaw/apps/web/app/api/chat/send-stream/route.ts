import { NextRequest } from 'next/server';

export const runtime = 'edge';

const EC2_API = 'http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:4000';

export async function POST(req: NextRequest) {
  const body = await req.json();

  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return new Response('{"error":"unauthorized"}', {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const ec2Res = await fetch(`${EC2_API}/api/chat/send-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!ec2Res.body) {
      return new Response('{"error":"upstream_error"}', {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader = ec2Res.body!.getReader();
        const encoder = new TextEncoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              break;
            }
            controller.enqueue(value);
          }
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      status: ec2Res.status,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    return new Response('{"error":"fetch_failed"}', {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
