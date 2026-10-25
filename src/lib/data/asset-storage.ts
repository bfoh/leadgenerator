// Where an approved file actually lives. Cloud mode uses a private Supabase Storage bucket; demo mode
// keeps bytes in the browser (IndexedDB, with a memory fallback) so nothing leaves the machine.
//
// The interface is deliberately small: the vault stores a private path, reads bytes back for an
// approved export, asks for a short-lived preview URL, and deletes. It never accepts a remote address,
// so there is no code path that downloads a third party's file.

import type { SupabaseClient } from '@supabase/supabase-js';
import { STORAGE_BUCKET } from '@/lib/domain/studio-assets';
import { StoreError } from './store';

export interface StoredAssetFile {
  bytes: Uint8Array;
  contentType: string;
}

export interface AssetStorage {
  readonly mode: 'demo' | 'cloud';
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<StoredAssetFile | null>;
  remove(paths: readonly string[]): Promise<void>;
  /** A URL the browser may use for a preview. In demo mode this is a local object URL. */
  signedUrl(path: string, expiresInSeconds?: number): Promise<string | null>;
}

/** Used by tests and as the fallback when a browser blocks IndexedDB. */
export class MemoryAssetStorage implements AssetStorage {
  readonly mode = 'demo' as const;
  private readonly files = new Map<string, StoredAssetFile>();

  async put(path: string, bytes: Uint8Array, contentType: string) {
    this.files.set(path, { bytes: new Uint8Array(bytes), contentType });
  }
  async get(path: string) {
    const file = this.files.get(path);
    return file ? { bytes: new Uint8Array(file.bytes), contentType: file.contentType } : null;
  }
  async remove(paths: readonly string[]) {
    for (const path of paths) this.files.delete(path);
  }
  async signedUrl() {
    return null;
  }
  /** Test helper: how many files are held. */
  count() {
    return this.files.size;
  }
}

interface IndexedFile {
  path: string;
  bytes: ArrayBuffer;
  contentType: string;
}

const DB_NAME = 'dof-studio-assets';
const DB_STORE = 'files';

/** Demo-mode storage: private to this browser, never uploaded anywhere. */
export class BrowserAssetStorage implements AssetStorage {
  readonly mode = 'demo' as const;
  private readonly fallback = new MemoryAssetStorage();
  private readonly urls = new Map<string, string>();
  private readonly fellBackPaths: string[] = [];
  private db: Promise<IDBDatabase | null> | null = null;

  private open(): Promise<IDBDatabase | null> {
    this.db ??= new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, 1);
      } catch {
        return resolve(null);
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'path' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return this.db;
  }

  private async run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<{ ok: boolean; value?: T }> {
    const db = await this.open();
    if (!db) return { ok: false };
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, mode);
        const request = work(tx.objectStore(DB_STORE));
        request.onsuccess = () => resolve({ ok: true, value: request.result });
        request.onerror = () => resolve({ ok: false });
        tx.onabort = () => resolve({ ok: false });
      } catch {
        resolve({ ok: false });
      }
    });
  }

  async put(path: string, bytes: Uint8Array, contentType: string) {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const saved = await this.run('readwrite', (store) => store.put({ path, bytes: buffer, contentType } satisfies IndexedFile));
    if (!saved.ok) {
      // A full or blocked database must not lose the file silently; the memory copy keeps the session
      // working, and the vault says the file is local to this browser.
      this.fellBackPaths.push(path);
      await this.fallback.put(path, bytes, contentType);
    }
    this.revoke(path);
  }

  async get(path: string): Promise<StoredAssetFile | null> {
    const found = await this.run<IndexedFile | undefined>('readonly', (store) => store.get(path));
    if (found.ok && found.value) return { bytes: new Uint8Array(found.value.bytes), contentType: found.value.contentType };
    return this.fallback.get(path);
  }

  async remove(paths: readonly string[]) {
    for (const path of paths) {
      this.revoke(path);
      await this.run('readwrite', (store) => store.delete(path));
      await this.fallback.remove([path]);
    }
  }

  async signedUrl(path: string): Promise<string | null> {
    const cached = this.urls.get(path);
    if (cached) return cached;
    const file = await this.get(path);
    if (!file || typeof URL.createObjectURL !== 'function') return null;
    const url = URL.createObjectURL(new Blob([file.bytes.slice().buffer], { type: file.contentType }));
    this.urls.set(path, url);
    return url;
  }

  private revoke(path: string) {
    const url = this.urls.get(path);
    if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    this.urls.delete(path);
  }

  /** Whether any file had to fall back to memory (browser storage full or blocked). */
  fellBack(): boolean {
    return this.fellBackPaths.length > 0;
  }
}

/** Cloud-mode storage: the private bucket, reached with the signed-in user's session and RLS. */
export class SupabaseAssetStorage implements AssetStorage {
  readonly mode = 'cloud' as const;

  constructor(private readonly sb: SupabaseClient) {}

  async put(path: string, bytes: Uint8Array, contentType: string) {
    const { error } = await this.sb.storage.from(STORAGE_BUCKET).upload(path, bytes, { contentType, upsert: false, cacheControl: '3600' });
    if (error) throw new StoreError(`The file could not be stored: ${error.message}`, 'unavailable');
  }

  async get(path: string): Promise<StoredAssetFile | null> {
    const { data, error } = await this.sb.storage.from(STORAGE_BUCKET).download(path);
    if (error || !data) return null;
    return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || 'application/octet-stream' };
  }

  async remove(paths: readonly string[]) {
    if (!paths.length) return;
    const { error } = await this.sb.storage.from(STORAGE_BUCKET).remove([...paths]);
    if (error) throw new StoreError(`The stored file could not be deleted: ${error.message}`, 'unavailable');
  }

  async signedUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
    const { data, error } = await this.sb.storage.from(STORAGE_BUCKET).createSignedUrl(path, expiresInSeconds);
    if (error || !data) return null;
    return data.signedUrl;
  }
}

