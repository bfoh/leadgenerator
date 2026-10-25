import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { BrowserAssetStorage, MemoryAssetStorage, SupabaseAssetStorage } from '@/lib/data/asset-storage';
import { StoreError } from '@/lib/data/store';

// The storage port: private bucket calls in cloud mode (upload, download, signed URL, delete), and a
// browser adapter that never leaves the machine. The fake client records exactly what is asked of it.

const encoder = new TextEncoder();
const PATH = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/logo.png';

interface Call {
  action: string;
  bucket: string;
  path?: string;
  options?: unknown;
  expires?: number;
}

function fakeSupabase(options: { failUpload?: boolean; failDownload?: boolean; failSign?: boolean; failRemove?: boolean } = {}) {
  const calls: Call[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, bytes: Uint8Array, opts: unknown) {
            calls.push({ action: 'upload', bucket, path, options: opts });
            return { error: options.failUpload ? { message: 'quota exceeded' } : null };
          },
          async download(path: string) {
            calls.push({ action: 'download', bucket, path });
            return options.failDownload ? { data: null, error: { message: 'not found' } } : { data: new Blob([encoder.encode('png-bytes')], { type: 'image/png' }), error: null };
          },
          async remove(paths: string[]) {
            calls.push({ action: 'remove', bucket, path: paths.join(',') });
            return { error: options.failRemove ? { message: 'denied' } : null };
          },
          async createSignedUrl(path: string, expires: number) {
            calls.push({ action: 'sign', bucket, path, expires });
            return options.failSign ? { data: null, error: { message: 'denied' } } : { data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/${path}?token=t` }, error: null };
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe('the private bucket adapter', () => {
  it('uploads into studio-assets without overwriting and with the detected content type', async () => {
    const { client, calls } = fakeSupabase();
    await new SupabaseAssetStorage(client).put(PATH, encoder.encode('png'), 'image/png');
    expect(calls).toEqual([{ action: 'upload', bucket: 'studio-assets', path: PATH, options: { contentType: 'image/png', upsert: false, cacheControl: '3600' } }]);
  });

  it('reads bytes back, and asks for a short-lived signed URL for a preview', async () => {
    const { client, calls } = fakeSupabase();
    const storage = new SupabaseAssetStorage(client);
    const file = await storage.get(PATH);
    expect(new TextDecoder().decode(file!.bytes)).toBe('png-bytes');
    expect(file?.contentType).toBe('image/png');
    const url = await storage.signedUrl(PATH, 60);
    expect(url).toMatch(/^https:\/\/example\.supabase\.co\/storage\/v1\/object\/sign\//);
    expect(calls.find((call) => call.action === 'sign')).toMatchObject({ bucket: 'studio-assets', path: PATH, expires: 60 });
  });

  it('removes objects and treats an empty list as a no-op', async () => {
    const { client, calls } = fakeSupabase();
    const storage = new SupabaseAssetStorage(client);
    await storage.remove([]);
    expect(calls).toEqual([]);
    await storage.remove([PATH]);
    expect(calls).toEqual([{ action: 'remove', bucket: 'studio-assets', path: PATH }]);
  });

  it('turns storage failures into messages a person can act on', async () => {
    const storage = new SupabaseAssetStorage(fakeSupabase({ failUpload: true, failRemove: true, failDownload: true, failSign: true }).client);
    await expect(storage.put(PATH, encoder.encode('x'), 'image/png')).rejects.toThrow(StoreError);
    await expect(storage.put(PATH, encoder.encode('x'), 'image/png')).rejects.toThrow(/could not be stored: quota exceeded/);
    await expect(storage.remove([PATH])).rejects.toThrow(/could not be deleted/);
    expect(await storage.get(PATH)).toBeNull();
    expect(await storage.signedUrl(PATH)).toBeNull();
  });
});

describe('demo storage', () => {
  it('keeps a private copy and never shares the caller’s buffer', async () => {
    const storage = new MemoryAssetStorage();
    const bytes = encoder.encode('original');
    await storage.put(PATH, bytes, 'image/png');
    bytes[0] = 0;
    const stored = await storage.get(PATH);
    expect(new TextDecoder().decode(stored!.bytes)).toBe('original');
    expect(await storage.count()).toBe(1);
    await storage.remove([PATH]);
    expect(await storage.get(PATH)).toBeNull();
    expect(await storage.signedUrl()).toBeNull();
  });

  it('falls back to memory when this environment has no IndexedDB, and says so', async () => {
    const storage = new BrowserAssetStorage();
    await storage.put(PATH, encoder.encode('local'), 'image/png');
    expect(storage.fellBack()).toBe(true);
    const file = await storage.get(PATH);
    expect(new TextDecoder().decode(file!.bytes)).toBe('local');
    expect(file?.contentType).toBe('image/png');
    await storage.remove([PATH]);
    expect(await storage.get(PATH)).toBeNull();
  });
});
