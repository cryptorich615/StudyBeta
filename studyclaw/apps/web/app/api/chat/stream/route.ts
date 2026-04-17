import { NextRequest, NextResponse } from 'next/server';

const BACKEND_BASE = `http://34.58.17.31.nip.io:4000`;

export async function POST(req: NextRequest) {
  // The frontend's apiFetch sends the JWT in the Authorization header.
  // Read it here and forward it to nip.io.
  const authHeader = req.headers.get('authorization') ?? '';

  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized', message: 'Missing bearer token' }, { status: 401 });
  }

  const token = authHeader.slice('Bearer '.length);

  const body = await req.text();

  let nipioRes: Response;
  try {
    nipioRes = await fetch(`${BACKEND_BASE}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body,
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_error', message: 'Could not reach the backend server' },
      { status: 502 }
    );
  }

  if (!nipioRes.ok && !nipioRes.body) {
    const text = await nipioRes.text().catch(() => '{}');
    return NextResponse.json(
      { error: 'upstream_error', message: text },
      { status: nipioRes.status }
    );
  }

  // Pipe the SSE stream back to the client
  const reader = nipioRes.body!.getReader();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch {
        // upstream closed
      } finally {
        controller.close();
      }
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    status: nipioRes.status,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
