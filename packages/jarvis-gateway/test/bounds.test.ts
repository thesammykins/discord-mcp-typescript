import { describe, expect, it, vi } from 'vitest';
import { gateway } from '../worker/index.js';
import { limitedText } from '../worker/runtime.js';
import { env, fixtureFetch, parent, rpc } from './fixtures.js';

describe('deadline and byte boundaries', () => {
  it('cancels a stalled body reader promptly and reports unknown coverage', async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const result = limitedText(body, 65536, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', retriable: false });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('does not wait for a nonsettling cancellation promise after exceeding the byte limit', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(33));
      },
      cancel,
    });
    await expect(limitedText(body, 32)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects an oversized streaming input before contacting Discord', async () => {
    const fetcher = vi.fn();
    const request = new Request('https://gateway.example/mcp', {
      method: 'POST',
      body: 'x'.repeat(65537),
    });
    const result = await gateway(request, env, fetcher);
    expect(result.status).toBe(413);
    expect(await result.json()).toMatchObject({ error: { message: 'PAYLOAD_TOO_LARGE' } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('applies request cancellation during body consumption', async () => {
    const fetcher = vi.fn();
    const controller = new AbortController();
    const cancel = vi.fn();
    const request = new Request('https://gateway.example/mcp', {
      method: 'POST',
      body: new ReadableStream({ cancel }),
      signal: controller.signal,
      duplex: 'half',
    } as RequestInit);
    const result = gateway(request, env, fetcher);
    controller.abort();
    const response = await result;
    expect(response.status).toBe(408);
    expect(await response.json()).toMatchObject({ error: { message: 'REQUEST_TIMEOUT' } });
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects oversized upstream reads without advancing a cursor', async () => {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(String(input)).pathname.endsWith('/messages')
        ? new Response('x'.repeat(2_000_001))
        : fixtureFetch(input, init);
    const result = await (
      await gateway(rpc('discord_messages_read', { channel_id: parent }), env, fetcher)
    ).json();
    expect(result.result).toMatchObject({
      isError: true,
      structuredContent: { code: 'PAYLOAD_TOO_LARGE', retriable: false },
    });
    expect(result.result.structuredContent.next_after).toBeUndefined();
  });
  it('acknowledges legacy initialized notification with202', async () => {
    const result = await gateway(
      new Request('https://gateway.example/mcp', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      }),
      {},
    );
    expect(result.status).toBe(202);
    expect(await result.text()).toBe('');
  });
});
