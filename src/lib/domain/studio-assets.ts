// Business Asset Vault: the files a concept may use, and the permission to use them.
//
// The Studio separates five things people routinely confuse: looking at a file, keeping a copy,
// placing it in a private prototype, exporting it in a pack, and publishing it on the live site.
// Each is its own permission, so an image that may inform the design is never silently published.
//
// Remote material (a Google Maps photo, an Instagram post, a competitor's photograph) is not an
// asset. It is recorded in a separate reference ledger as an address and a note, and it is never
// fetched, stored or rendered. The only way bytes enter the vault is an upload from someone who is
// entitled to supply the file.

import type { Tone } from './constants';
import { restrictedResourceUrl } from './business-resources';

export const STORAGE_BUCKET = 'studio-assets';
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 12_000;
export const MAX_IMAGE_PIXELS = 40_000_000;

export const ASSET_KINDS = [
  'logo',
  'brand_mark',
  'product_photo',
  'venue_photo',
  'licensed_image',
  'illustration',
  'brand_document',
  'video',
  'typography_reference',
  'other',
] as const;
export type StudioAssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_STATUSES = ['candidate', 'approved', 'rejected', 'revoked', 'superseded'] as const;
export type StudioAssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_ORIGINS = ['our_work', 'client_supplied', 'licensed', 'commissioned', 'third_party'] as const;
export type StudioAssetOrigin = (typeof ASSET_ORIGINS)[number];

export const PERMISSION_STATES = ['unknown', 'granted', 'denied', 'not_required'] as const;
export type AssetPermissionState = (typeof PERMISSION_STATES)[number];

export const ASSET_EVENT_ACTIONS = ['uploaded', 'annotated', 'approved', 'rejected', 'revoked', 'replaced'] as const;
export type StudioAssetEventAction = (typeof ASSET_EVENT_ACTIONS)[number];

export const REFERENCE_STATUSES = ['recorded', 'declined'] as const;
export type StudioAssetReferenceStatus = (typeof REFERENCE_STATUSES)[number];

export const REFERENCE_SOURCES = ['client_statement', 'public_page', 'social_profile', 'platform_listing'] as const;
export type StudioAssetReferenceSource = (typeof REFERENCE_SOURCES)[number];

/** A file class decides which kinds of asset a MIME type can become. */
export type AssetFileClass = 'image' | 'document' | 'video' | 'font';

export interface AssetMimeType {
  mimeType: string;
  extension: string;
  fileClass: AssetFileClass;
  label: string;
}

/** The allowlist, mirrored by migration 013's bucket and check constraints. */
export const ASSET_MIME_TYPES: readonly AssetMimeType[] = [
  { mimeType: 'image/png', extension: 'png', fileClass: 'image', label: 'PNG image' },
  { mimeType: 'image/jpeg', extension: 'jpg', fileClass: 'image', label: 'JPEG image' },
  { mimeType: 'image/webp', extension: 'webp', fileClass: 'image', label: 'WebP image' },
  { mimeType: 'image/gif', extension: 'gif', fileClass: 'image', label: 'GIF image' },
  { mimeType: 'application/pdf', extension: 'pdf', fileClass: 'document', label: 'PDF document' },
  { mimeType: 'text/plain', extension: 'txt', fileClass: 'document', label: 'Plain text' },
  { mimeType: 'video/mp4', extension: 'mp4', fileClass: 'video', label: 'MP4 video' },
  { mimeType: 'font/woff', extension: 'woff', fileClass: 'font', label: 'WOFF font' },
  { mimeType: 'font/woff2', extension: 'woff2', fileClass: 'font', label: 'WOFF2 font' },
  { mimeType: 'font/ttf', extension: 'ttf', fileClass: 'font', label: 'TrueType font' },
  { mimeType: 'font/otf', extension: 'otf', fileClass: 'font', label: 'OpenType font' },
] as const;

export const ALLOWED_MIME_TYPES = ASSET_MIME_TYPES.map((t) => t.mimeType);

export const ASSET_KIND_META: Record<StudioAssetKind, { label: string; tone: Tone; description: string; fileClasses: AssetFileClass[] }> = {
  logo: { label: 'Logo', tone: 'accent', description: 'The business’s primary logo.', fileClasses: ['image'] },
  brand_mark: { label: 'Brand mark', tone: 'accent', description: 'A monogram, icon or secondary lockup.', fileClasses: ['image'] },
  product_photo: { label: 'Product photography', tone: 'neutral', description: 'The goods the business sells.', fileClasses: ['image'] },
  venue_photo: { label: 'Venue photography', tone: 'neutral', description: 'The place customers visit.', fileClasses: ['image'] },
  licensed_image: { label: 'Licensed image', tone: 'info', description: 'A photograph or artwork licensed for this use.', fileClasses: ['image'] },
  illustration: { label: 'Original illustration', tone: 'info', description: 'Artwork made for this concept.', fileClasses: ['image'] },
  brand_document: { label: 'Brand document', tone: 'neutral', description: 'Guidelines, a licence or a written brief.', fileClasses: ['document'] },
  video: { label: 'Approved video', tone: 'neutral', description: 'Footage the business is entitled to publish.', fileClasses: ['video'] },
  typography_reference: { label: 'Typography reference', tone: 'neutral', description: 'A font file with its web licence recorded.', fileClasses: ['font'] },
  other: { label: 'Other', tone: 'neutral', description: 'Anything relevant that does not fit another kind.', fileClasses: ['image', 'document', 'video', 'font'] },
};

export const ASSET_STATUS_META: Record<StudioAssetStatus, { label: string; tone: Tone; description: string }> = {
  candidate: { label: 'Candidate', tone: 'warning', description: 'Waiting for a person to approve or reject it. Cannot be used in a design.' },
  approved: { label: 'Approved', tone: 'success', description: 'Approved for the uses its permissions name.' },
  rejected: { label: 'Rejected', tone: 'danger', description: 'Not usable. The reason is kept in the history.' },
  revoked: { label: 'Permission revoked', tone: 'danger', description: 'Permission was withdrawn. Anything using it must be replaced.' },
  superseded: { label: 'Replaced', tone: 'neutral', description: 'Kept as history; a newer file takes its place.' },
};

export const ORIGIN_META: Record<StudioAssetOrigin, { label: string; tone: Tone; description: string }> = {
  our_work: { label: 'Our work', tone: 'success', description: 'Made by us for this concept.' },
  client_supplied: { label: 'Supplied by the business', tone: 'info', description: 'The business gave us the file.' },
  licensed: { label: 'Licensed', tone: 'info', description: 'We hold a licence; record its name, reference and expiry.' },
  commissioned: { label: 'Commissioned', tone: 'success', description: 'Commissioned for this work, with rights recorded.' },
  third_party: { label: 'Third party', tone: 'warning', description: 'Someone else’s property. Needs explicit permission for every use.' },
};

export const PERMISSION_META: Record<AssetPermissionState, { label: string; tone: Tone; description: string }> = {
  unknown: { label: 'Not recorded', tone: 'warning', description: 'Nobody has confirmed this yet.' },
  granted: { label: 'Granted', tone: 'success', description: 'Permission is on record.' },
  denied: { label: 'Denied', tone: 'danger', description: 'Permission was refused or withdrawn.' },
  not_required: { label: 'Not required', tone: 'neutral', description: 'Our own or fully commissioned work, where we hold the rights.' },
};

export const PERMISSION_USES = [
  { key: 'inspectPermission', label: 'Inspect', question: 'May we open and study the file?' },
  { key: 'storePermission', label: 'Store', question: 'May we keep a copy in the vault?' },
  { key: 'prototypePermission', label: 'Private prototype', question: 'May it appear in an unapproved design?' },
  { key: 'exportPermission', label: 'Export', question: 'May it leave the Studio in an approved pack?' },
  { key: 'publishPermission', label: 'Publish', question: 'May it appear on the live site?' },
] as const;

export const REFERENCE_SOURCE_META: Record<StudioAssetReferenceSource, { label: string; description: string }> = {
  client_statement: { label: 'The business pointed us to it', description: 'A link or file the client mentioned. Still needs permission before use.' },
  public_page: { label: 'A public web page', description: 'Found on the open web. Recorded as a reference only.' },
  social_profile: { label: 'A social profile', description: 'Instagram, Facebook or similar. Platform terms usually forbid reuse.' },
  platform_listing: { label: 'A platform listing', description: 'Maps, a directory or a marketplace. The imagery is not ours to download.' },
};

export const REFERENCE_STATUS_META: Record<StudioAssetReferenceStatus, { label: string; tone: Tone }> = {
  recorded: { label: 'Reference only', tone: 'warning' },
  declined: { label: 'Declined', tone: 'neutral' },
};


// ── Records ─────────────────────────────────────────────────────────────────────────────────────

export interface StudioAsset {
  id: string;
  organizationId: string;
  projectId: string;
  fileName: string;
  kind: StudioAssetKind;
  status: StudioAssetStatus;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  checksumSha256: string;
  storagePath: string;
  origin: StudioAssetOrigin;
  ownerName: string;
  supplier: string | null;
  sourceUrl: string | null;
  licenceName: string | null;
  licenceReference: string | null;
  licenceExpiresOn: string | null;
  attributionRequired: boolean;
  attributionText: string | null;
  permissionEvidence: string;
  inspectPermission: AssetPermissionState;
  storePermission: AssetPermissionState;
  prototypePermission: AssetPermissionState;
  exportPermission: AssetPermissionState;
  publishPermission: AssetPermissionState;
  note: string;
  reviewNote: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  supersedesId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudioAssetInsert {
  /** Set by the service so the private path and the row share one identifier. */
  id?: string;
  projectId: string;
  fileName: string;
  kind: StudioAssetKind;
  status?: StudioAssetStatus;
  mimeType: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  checksumSha256: string;
  storagePath: string;
  origin: StudioAssetOrigin;
  ownerName: string;
  supplier?: string | null;
  sourceUrl?: string | null;
  licenceName?: string | null;
  licenceReference?: string | null;
  licenceExpiresOn?: string | null;
  attributionRequired?: boolean;
  attributionText?: string | null;
  permissionEvidence: string;
  inspectPermission: AssetPermissionState;
  storePermission: AssetPermissionState;
  prototypePermission: AssetPermissionState;
  exportPermission: AssetPermissionState;
  publishPermission: AssetPermissionState;
  note?: string;
  supersedesId?: string | null;
}

export type StudioAssetPatch = Partial<
  Pick<
    StudioAsset,
    | 'kind'
    | 'status'
    | 'note'
    | 'reviewNote'
    | 'origin'
    | 'ownerName'
    | 'supplier'
    | 'sourceUrl'
    | 'licenceName'
    | 'licenceReference'
    | 'licenceExpiresOn'
    | 'attributionRequired'
    | 'attributionText'
    | 'permissionEvidence'
    | 'inspectPermission'
    | 'storePermission'
    | 'prototypePermission'
    | 'exportPermission'
    | 'publishPermission'
    | 'approvedBy'
    | 'approvedAt'
    | 'rejectedBy'
    | 'rejectedAt'
    | 'rejectedReason'
    | 'revokedBy'
    | 'revokedAt'
    | 'revokedReason'
    | 'supersedesId'
  >
>;

export interface StudioAssetEvent {
  id: string;
  organizationId: string;
  projectId: string;
  assetId: string;
  action: StudioAssetEventAction;
  note: string | null;
  actorId: string | null;
  createdAt: string;
}

export type StudioAssetEventInsert = Omit<StudioAssetEvent, 'id' | 'organizationId' | 'actorId' | 'createdAt'>;

export interface StudioAssetReference {
  id: string;
  organizationId: string;
  projectId: string;
  address: string;
  label: string;
  source: StudioAssetReferenceSource;
  note: string | null;
  status: StudioAssetReferenceStatus;
  recordedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StudioAssetReferenceInsert = Omit<StudioAssetReference, 'id' | 'organizationId' | 'recordedBy' | 'createdAt' | 'updatedAt'>;

// ── Brand Kit ───────────────────────────────────────────────────────────────────────────────────

export interface BrandKitPaletteEntry {
  name: string;
  hex: string;
  role: string;
}

export interface BrandKitTypeEntry {
  role: string;
  family: string;
  weights: string;
  licence: string;
  assetId: string | null;
}

export interface BrandKitToneOfVoice {
  summary: string;
  do: string[];
  dont: string[];
}

export interface BrandKitContent {
  logoAssetIds: string[];
  palette: BrandKitPaletteEntry[];
  typography: BrandKitTypeEntry[];
  photographyAssetIds: string[];
  personality: string[];
  visualDirection: string;
  toneOfVoice: BrandKitToneOfVoice;
}

export interface StudioBrandKit {
  id: string;
  organizationId: string;
  projectId: string;
  createdBy: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface StudioBrandKitVersion {
  id: string;
  organizationId: string;
  projectId: string;
  kitId: string;
  version: number;
  content: BrandKitContent;
  note: string;
  createdBy: string | null;
  createdAt: string;
}

export interface StudioBrandKitApproval {
  id: string;
  organizationId: string;
  projectId: string;
  kitId: string;
  versionId: string;
  note: string;
  approvedBy: string | null;
  approvedAt: string;
}

export type StudioBrandKitVersionInsert = Omit<StudioBrandKitVersion, 'id' | 'organizationId' | 'createdBy' | 'createdAt'>;
export type StudioBrandKitApprovalInsert = Omit<StudioBrandKitApproval, 'id' | 'organizationId' | 'approvedBy' | 'approvedAt'>;

// ── What the bytes actually are ─────────────────────────────────────────────────────────────────
// A declared MIME type is a claim; the first bytes are evidence. A file whose contents do not match
// its name is refused, and SVG or HTML can never enter the vault because they can carry script.

export interface DetectedAssetFile {
  mimeType: string;
  extension: string;
  fileClass: AssetFileClass;
  width: number | null;
  height: number | null;
}

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  Array.from(bytes.subarray(start, start + length))
    .map((b) => String.fromCharCode(b))
    .join('');

const startsWith = (bytes: Uint8Array, signature: number[], start = 0) =>
  signature.length <= bytes.length - start && signature.every((value, index) => bytes[start + index] === value);

function pngSize(bytes: Uint8Array) {
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegSize(bytes: Uint8Array) {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) return { width: (bytes[i + 7] << 8) | bytes[i + 8], height: (bytes[i + 5] << 8) | bytes[i + 6] };
    i += 2 + length;
  }
  return null;
}

function gifSize(bytes: Uint8Array) {
  if (bytes.length < 10) return null;
  return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
}

function webpSize(bytes: Uint8Array) {
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
      height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
    };
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    return {
      width: 1 + ((bytes[22] | (bytes[23] << 8)) & 0x3fff),
      height: 1 + (((bytes[23] >> 6) | (bytes[24] << 2) | (bytes[25] << 10)) & 0x3fff),
    };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30 && startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) {
    return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
  }
  return null;
}

function isPlainText(bytes: Uint8Array) {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

const mime = (type: string): AssetMimeType => ASSET_MIME_TYPES.find((t) => t.mimeType === type)!;

/**
 * Detects the type from the bytes. `declaredType` is used only for plain text, which has no magic
 * number: a text file is accepted only when it is declared as text and decodes as UTF-8.
 */
export function detectAssetFile(bytes: Uint8Array, declaredType = ''): DetectedAssetFile | null {
  const image = (type: string, size: { width: number; height: number } | null): DetectedAssetFile => ({
    ...mime(type),
    width: size?.width || null,
    height: size?.height || null,
  });
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return image('image/png', pngSize(bytes));
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return image('image/jpeg', jpegSize(bytes));
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return image('image/gif', gifSize(bytes));
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === 'WEBP') return image('image/webp', webpSize(bytes));
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { ...mime('application/pdf'), width: null, height: null };
  if (ascii(bytes, 4, 4) === 'ftyp') return { ...mime('video/mp4'), width: null, height: null };
  if (startsWith(bytes, [0x77, 0x4f, 0x46, 0x46])) return { ...mime('font/woff'), width: null, height: null };
  if (startsWith(bytes, [0x77, 0x4f, 0x46, 0x32])) return { ...mime('font/woff2'), width: null, height: null };
  if (startsWith(bytes, [0x00, 0x01, 0x00, 0x00])) return { ...mime('font/ttf'), width: null, height: null };
  if (ascii(bytes, 0, 4) === 'OTTO') return { ...mime('font/otf'), width: null, height: null };
  if (declaredType.split(';')[0].trim().toLowerCase() === 'text/plain' && isPlainText(bytes)) {
    return { ...mime('text/plain'), width: null, height: null };
  }
  return null;
}


export interface UploadCheck {
  ok: boolean;
  file: DetectedAssetFile | null;
  problems: string[];
}

/** Everything wrong with an upload, before a single byte is stored. */
export function checkAssetUpload(input: { fileName: string; declaredType: string; bytes: Uint8Array }): UploadCheck {
  const problems: string[] = [];
  const { bytes } = input;
  if (!bytes.length) problems.push('The file is empty.');
  if (bytes.length > MAX_ASSET_BYTES) problems.push(`The file is ${formatBytes(bytes.length)}; the limit is ${formatBytes(MAX_ASSET_BYTES)}.`);
  const name = input.fileName.trim();
  if (!name || name.length > 200) problems.push('The file needs a name of 1–200 characters.');
  if (/[\\/\u0000]/.test(name)) problems.push('A file name cannot contain a path.');
  const file = detectAssetFile(bytes, input.declaredType);
  if (!file) {
    problems.push('This file type is not accepted. Upload a PNG, JPEG, WebP, GIF, PDF, plain text, MP4, WOFF, WOFF2, TTF or OTF file.');
  } else {
    const declared = input.declaredType.split(';')[0].trim().toLowerCase().replace('image/jpg', 'image/jpeg');
    if (declared && declared !== 'application/octet-stream' && declared !== file.mimeType) {
      problems.push(`The file is named as ${declared} but its contents are ${file.mimeType}. Rename it or export it again before uploading.`);
    }
    if (file.fileClass === 'image') {
      if (!file.width || !file.height) problems.push('The image dimensions could not be read, so the file cannot be checked safely.');
      else if (Math.max(file.width, file.height) > MAX_IMAGE_EDGE) {
        problems.push(`The image is ${file.width.toLocaleString('en-GB')}×${file.height.toLocaleString('en-GB')}; the longest edge may be ${MAX_IMAGE_EDGE.toLocaleString('en-GB')} px.`);
      } else if (file.width * file.height > MAX_IMAGE_PIXELS) {
        problems.push(`The image is ${file.width.toLocaleString('en-GB')}×${file.height.toLocaleString('en-GB')}, which is too large to render safely.`);
      }
    }
  }
  return { ok: problems.length === 0, file, problems };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A stable, private path: the tenant first, then the concept, then the asset. */
export function assetStoragePath(organizationId: string, projectId: string, assetId: string, fileName: string, extension: string): string {
  const base =
    fileName
      .toLowerCase()
      .replace(/\.[a-z0-9]{1,8}$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'asset';
  return `${organizationId}/${projectId}/${assetId}/${base}.${extension}`;
}

export function assetDownloadName(asset: Pick<StudioAsset, 'fileName' | 'mimeType'>): string {
  const meta = ASSET_MIME_TYPES.find((t) => t.mimeType === asset.mimeType);
  const base = asset.fileName.replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'asset';
  return `${base}.${meta?.extension ?? 'bin'}`;
}



// ── Invariants ─────────────────────────────────────────────────────────────────────────────────
// The same rules migration 013 enforces, so demo mode refuses what cloud mode would refuse rather
// than storing a row the database would reject.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_URL = /^https?:\/\//i;
const SHA256 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Everything wrong with a new asset record, as messages a person can act on. */
export function studioAssetProblems(input: StudioAssetInsert, organizationId?: string): string[] {
  const problems: string[] = [];
  if (input.id && !UUID.test(input.id)) problems.push('The asset identifier is not valid.');
  const name = input.fileName?.trim() ?? '';
  if (name.length < 1 || name.length > 200) problems.push('A file needs a name of 1–200 characters.');
  if (/[\\/\u0000]/.test(name)) problems.push('A file name cannot contain a path.');
  if (!ASSET_KINDS.includes(input.kind)) problems.push('Choose what this asset is.');
  if (!ASSET_STATUSES.includes(input.status ?? 'candidate')) problems.push('Choose a valid asset status.');
  if (!ASSET_ORIGINS.includes(input.origin)) problems.push('Say where this asset came from.');
  if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) problems.push('This file type is not accepted in the asset vault.');
  const mimeMeta = ASSET_MIME_TYPES.find((type) => type.mimeType === input.mimeType);
  if (mimeMeta && ASSET_KIND_META[input.kind] && !ASSET_KIND_META[input.kind].fileClasses.includes(mimeMeta.fileClass)) {
    problems.push(`${ASSET_KIND_META[input.kind].label} cannot be a ${mimeMeta.label}.`);
  }
  if (!Number.isInteger(input.bytes) || input.bytes < 1 || input.bytes > MAX_ASSET_BYTES) problems.push(`A file must be between 1 byte and ${formatBytes(MAX_ASSET_BYTES)}.`);
  if ((input.width == null) !== (input.height == null)) problems.push('An image records both its width and its height.');
  if (input.width != null && (!Number.isInteger(input.width) || input.width < 1 || input.width > MAX_IMAGE_EDGE)) problems.push('The image width is outside the permitted range.');
  if (input.height != null && (!Number.isInteger(input.height) || input.height < 1 || input.height > MAX_IMAGE_EDGE)) problems.push('The image height is outside the permitted range.');
  if (!SHA256.test(input.checksumSha256 ?? '')) problems.push('The file checksum is missing or malformed.');
  const path = input.storagePath ?? '';
  // Demo mode uses a readable organization id; cloud mode's migration additionally requires UUIDs.
  if (!/^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\/[a-z0-9._-]+$/.test(path) || path.includes('..')) {
    problems.push('The file path must be the organization, the concept, the asset and a file name.');
  } else if (organizationId && !path.startsWith(`${organizationId}/`)) {
    problems.push('The file path belongs to another organization.');
  }
  if (input.projectId && !UUID.test(input.projectId)) problems.push('The concept is not valid.');
  const owner = input.ownerName?.trim() ?? '';
  if (owner.length < 2 || owner.length > 200) problems.push('Say who owns or supplied the rights (2–200 characters).');
  if (input.supplier != null && input.supplier.length > 200) problems.push('The supplier name is limited to 200 characters.');
  if (input.sourceUrl && (!HTTP_URL.test(input.sourceUrl) || input.sourceUrl.length > 2000)) problems.push('A source address must be a full http(s) link.');
  if (input.sourceUrl && restrictedResourceUrl(input.sourceUrl)) problems.push('Google and social-platform previews cannot be uploaded as originals. Obtain the authorized original from its owner.');
  if (input.licenceName != null && input.licenceName.length > 200) problems.push('The licence name is limited to 200 characters.');
  if (input.licenceReference != null && input.licenceReference.length > 500) problems.push('The licence reference is limited to 500 characters.');
  if (input.licenceExpiresOn && !DATE.test(input.licenceExpiresOn)) problems.push('A licence expiry date must be written as YYYY-MM-DD.');
  if (input.origin === 'licensed' && !input.licenceName?.trim()) problems.push('A licensed asset names the licence it is used under.');
  if (input.attributionRequired && !input.attributionText?.trim()) problems.push('Say how the attribution must read, or turn the requirement off.');
  if ((input.attributionText?.length ?? 0) > 400) problems.push('Attribution text is limited to 400 characters.');
  const evidence = input.permissionEvidence?.trim() ?? '';
  if (evidence.length < 10 || evidence.length > 1000) problems.push('Record the evidence behind the permission (at least 10 characters): an email reference, agreement or order number.');
  for (const use of PERMISSION_USES) {
    if (!PERMISSION_STATES.includes(input[use.key])) problems.push(`Choose the ${use.label.toLowerCase()} permission.`);
  }
  if (input.storePermission === 'denied' && [input.prototypePermission, input.exportPermission, input.publishPermission].includes('granted')) {
    problems.push('A file we may not keep cannot be cleared for use, export or publication.');
  }
  if ((input.note?.length ?? 0) > 2000) problems.push('A note is limited to 2,000 characters.');
  if (input.supersedesId && !UUID.test(input.supersedesId)) problems.push('The asset this one replaces is not valid.');
  return problems;
}

/** Why this asset cannot be approved yet. Approval is a person's decision, not a rubber stamp. */
export function assetApprovalProblems(
  asset: Pick<
    StudioAsset,
    'status' | 'permissionEvidence' | 'inspectPermission' | 'storePermission' | 'origin' | 'licenceName' | 'licenceExpiresOn' | 'attributionRequired' | 'attributionText'
  >,
  today = todayIso(),
): string[] {
  const problems: string[] = [];
  if (asset.status !== 'candidate') problems.push('Only a candidate can be approved.');
  if (asset.inspectPermission === 'denied') problems.push('Inspection permission is denied, so nobody can confirm what this file is.');
  if (asset.storePermission === 'unknown') problems.push('Record permission to keep a copy of the file before approving it.');
  if (asset.storePermission === 'denied') problems.push('A file we may not keep cannot be approved.');
  if ((asset.permissionEvidence ?? '').trim().length < 10) problems.push('Record the evidence behind the permission before approving it.');
  if (asset.origin === 'licensed' && !asset.licenceName?.trim()) problems.push('Name the licence before approving a licensed asset.');
  if (asset.attributionRequired && !asset.attributionText?.trim()) problems.push('Record how the attribution must read before approving it.');
  if (asset.licenceExpiresOn && asset.licenceExpiresOn < today) problems.push(`The licence expired on ${asset.licenceExpiresOn}. Renew it or replace the asset.`);
  return problems;
}

export function assetExpired(asset: Pick<StudioAsset, 'licenceExpiresOn'>, today = todayIso()): boolean {
  return Boolean(asset.licenceExpiresOn && asset.licenceExpiresOn < today);
}

/** Why this asset may not travel in an approved pack. */
export function assetExportProblems(
  asset: Pick<StudioAsset, 'status' | 'storePermission' | 'exportPermission' | 'licenceExpiresOn' | 'attributionRequired' | 'attributionText'> & Partial<Pick<StudioAsset, 'sourceUrl'>>,
  today = todayIso(),
): string[] {
  const problems: string[] = [];
  if (asset.sourceUrl && restrictedResourceUrl(asset.sourceUrl)) problems.push('Google or social-platform preview content is excluded from exports. Supply an authorized independent original.');
  if (asset.status !== 'approved') problems.push(asset.status === 'superseded' ? 'A replaced file cannot be exported.' : `Only an approved file can be exported; this one is ${ASSET_STATUS_META[asset.status].label.toLowerCase()}.`);
  if (asset.storePermission === 'denied') problems.push('We may not keep a copy, so it cannot be exported.');
  if (!['granted', 'not_required'].includes(asset.exportPermission)) problems.push('Export permission is not recorded for this file.');
  if (assetExpired(asset, today)) problems.push(`The licence expired on ${asset.licenceExpiresOn}.`);
  if (asset.attributionRequired && !asset.attributionText?.trim()) problems.push('The attribution wording is missing.');
  return problems;
}

/** Whether a use is covered by the recorded permission. */
export function assetPermits(
  asset: Pick<StudioAsset, 'inspectPermission' | 'storePermission' | 'prototypePermission' | 'exportPermission' | 'publishPermission'>,
  use: 'inspect' | 'store' | 'prototype' | 'export' | 'publish',
): boolean {
  const value = asset[`${use}Permission` as const];
  return value === 'granted' || value === 'not_required';
}

/** Approved, unexpired and cleared for a private prototype: the only assets a build may use. */
export function assetUsableInPrototype(asset: Pick<StudioAsset, 'status' | 'prototypePermission' | 'licenceExpiresOn'>, today = todayIso()): boolean {
  return asset.status === 'approved' && ['granted', 'not_required'].includes(asset.prototypePermission) && !assetExpired(asset, today);
}

/** The kinds a detected file can legitimately become. */
export function assetKindsForFile(file: DetectedAssetFile): StudioAssetKind[] {
  return ASSET_KINDS.filter((kind) => ASSET_KIND_META[kind].fileClasses.includes(file.fileClass));
}

/** A kind and a file class must be compatible (a PDF is not a logo). */
export function assetKindAcceptsFile(kind: StudioAssetKind, file: DetectedAssetFile): boolean {
  return ASSET_KIND_META[kind]?.fileClasses.includes(file.fileClass) ?? false;
}

/** Everything wrong with a remote reference. The address is never fetched, only recorded. */
export function studioAssetReferenceProblems(input: StudioAssetReferenceInsert): string[] {
  const problems: string[] = [];
  const address = input.address?.trim() ?? '';
  if (!HTTP_URL.test(address) || address.length > 2000) problems.push('A reference needs a full http(s) address.');
  const label = input.label?.trim() ?? '';
  if (label.length < 1 || label.length > 160) problems.push('Say what the reference shows (1–160 characters).');
  if (!REFERENCE_SOURCES.includes(input.source)) problems.push('Say where the reference came from.');
  if (!REFERENCE_STATUSES.includes(input.status)) problems.push('Choose whether the reference is recorded or declined.');
  if ((input.note?.length ?? 0) > 1000) problems.push('A reference note is limited to 1,000 characters.');
  return problems;
}

export function studioAssetEventProblems(input: StudioAssetEventInsert): string[] {
  const problems: string[] = [];
  if (!ASSET_EVENT_ACTIONS.includes(input.action)) problems.push('Choose a valid asset event.');
  if (!UUID.test(input.assetId ?? '')) problems.push('The asset event needs its asset.');
  if ((input.note?.length ?? 0) > 1000) problems.push('An event note is limited to 1,000 characters.');
  return problems;
}


// ── Brand Kit ───────────────────────────────────────────────────────────────────────────────────
// Structured, versioned and renderer-ready. Nothing here is a generic style preset: every palette,
// typeface and photograph is a decision about this business, with the licence that permits it.

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const textList = (value: unknown, max: number, count: number) =>
  Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === 'string').map((v) => v.trim().slice(0, max)).filter(Boolean))].slice(0, count)
    : [];
const idList = (value: unknown, count: number) =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && UUID.test(v)))].slice(0, count) : [];

export function emptyBrandKitContent(): BrandKitContent {
  return {
    logoAssetIds: [],
    palette: [],
    typography: [],
    photographyAssetIds: [],
    personality: [],
    visualDirection: '',
    toneOfVoice: { summary: '', do: [], dont: [] },
  };
}

/** Reads stored JSON without trusting it; anything malformed is dropped rather than rendered. */
export function parseBrandKitContent(value: unknown): BrandKitContent {
  if (!value || typeof value !== 'object') return emptyBrandKitContent();
  const record = value as Record<string, unknown>;
  const palette = Array.isArray(record.palette)
    ? record.palette
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
        .map((entry) => ({ name: text(entry.name, 60), hex: text(entry.hex, 9), role: text(entry.role, 60) }))
        .filter((entry) => entry.name && entry.hex)
        .slice(0, 12)
    : [];
  const typography = Array.isArray(record.typography)
    ? record.typography
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
        .map((entry) => ({
          role: text(entry.role, 60),
          family: text(entry.family, 100),
          weights: text(entry.weights, 60),
          licence: text(entry.licence, 200),
          assetId: typeof entry.assetId === 'string' && UUID.test(entry.assetId) ? entry.assetId : null,
        }))
        .filter((entry) => entry.family)
        .slice(0, 8)
    : [];
  const tone = record.toneOfVoice && typeof record.toneOfVoice === 'object' ? (record.toneOfVoice as Record<string, unknown>) : {};
  return {
    logoAssetIds: idList(record.logoAssetIds, 12),
    palette,
    typography,
    photographyAssetIds: idList(record.photographyAssetIds, 24),
    personality: textList(record.personality, 40, 12),
    visualDirection: text(record.visualDirection, 2000),
    toneOfVoice: {
      summary: text(tone.summary, 600),
      do: textList(tone.do, 160, 8),
      dont: textList(tone.dont, 160, 8),
    },
  };
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

type BrandKitAsset = Pick<StudioAsset, 'id' | 'projectId' | 'kind' | 'status' | 'prototypePermission' | 'licenceExpiresOn'>;


/**
 * Everything wrong with a Brand Kit version. A draft may be incomplete; an approved version may not.
 * `assets` is the vault of the same concept, so a kit can only name approved files.
 */
export function brandKitProblems(
  content: BrandKitContent,
  assets: readonly BrandKitAsset[],
  options: { forApproval?: boolean; today?: string } = {},
): string[] {
  const problems: string[] = [];
  const today = options.today ?? todayIso();
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  if (content.logoAssetIds.length > 12) problems.push('A kit may name at most 12 logo files.');
  if (content.photographyAssetIds.length > 24) problems.push('A photography collection may hold at most 24 files.');
  if (content.palette.length > 12) problems.push('A palette may hold at most 12 colours.');
  content.palette.forEach((entry, index) => {
    if (!entry.name) problems.push(`Colour ${index + 1} needs a name.`);
    if (!HEX.test(entry.hex)) problems.push(`Colour ${index + 1} (“${entry.name || 'unnamed'}”) needs a hex value such as #1B2A41.`);
    if (!entry.role) problems.push(`Colour ${index + 1} needs a role, for example background or accent.`);
  });
  if (content.typography.length > 8) problems.push('A type system may hold at most 8 families.');
  content.typography.forEach((entry, index) => {
    if (!entry.role) problems.push(`Typeface ${index + 1} needs a role, for example display or body.`);
    if (!entry.family) problems.push(`Typeface ${index + 1} needs a family name.`);
    if (options.forApproval && !entry.licence) problems.push(`Typeface ${index + 1} (${entry.family || 'unnamed'}) needs its web licence recorded before the kit is approved.`);
  });
  if (content.personality.length > 12) problems.push('Personality may hold at most 12 traits.');
  if (content.visualDirection.length > 2000) problems.push('The visual direction is limited to 2,000 characters.');
  if (content.toneOfVoice.summary.length > 600) problems.push('The tone of voice summary is limited to 600 characters.');

  const checkAsset = (id: string, purpose: 'logo' | 'photography') => {
    const asset = byId.get(id);
    const short = id.slice(0, 8);
    if (!asset) {
      problems.push(`The ${purpose} file ${short}… is not in this concept’s vault.`);
      return;
    }
    if (asset.status !== 'approved') problems.push(`${purpose === 'logo' ? 'Logo' : 'Photograph'} ${short}… is not approved.`);
    if (assetExpired(asset, today)) problems.push(`The licence for ${purpose} file ${short}… expired on ${asset.licenceExpiresOn}.`);
    const rightKinds = purpose === 'logo' ? ['logo', 'brand_mark'] : ['product_photo', 'venue_photo', 'licensed_image', 'illustration', 'other'];
    if (!rightKinds.includes(asset.kind)) problems.push(`File ${short}… is a ${ASSET_KIND_META[asset.kind].label.toLowerCase()}, not ${purpose === 'logo' ? 'a logo' : 'photography'}.`);
    if (asset.status === 'approved' && !['granted', 'not_required'].includes(asset.prototypePermission)) {
      problems.push(`File ${short}… is not cleared for use in a private prototype.`);
    }
  };
  content.logoAssetIds.forEach((id) => checkAsset(id, 'logo'));
  content.photographyAssetIds.forEach((id) => checkAsset(id, 'photography'));

  if (options.forApproval) {
    if (content.logoAssetIds.length === 0) problems.push('An approved kit names at least one approved logo.');
    if (content.palette.length < 2) problems.push('An approved kit needs at least two colours.');
    if (content.typography.length < 1) problems.push('An approved kit needs at least one typeface with its licence.');
    if (content.personality.length < 3) problems.push('An approved kit needs at least three personality traits.');
    if (content.visualDirection.length < 80) problems.push('Write at least a short paragraph of visual direction (80 characters) before approving the kit.');
    if (content.toneOfVoice.summary.length < 20) problems.push('Summarise the tone of voice before approving the kit.');
  }
  return problems;
}

export function brandKitSummary(content: BrandKitContent): string {
  const parts = [
    content.logoAssetIds.length ? `${content.logoAssetIds.length} logo${content.logoAssetIds.length === 1 ? '' : 's'}` : null,
    content.palette.length ? `${content.palette.length}-colour palette` : null,
    content.typography.length ? `${content.typography.length} typeface${content.typography.length === 1 ? '' : 's'}` : null,
    content.photographyAssetIds.length ? `${content.photographyAssetIds.length} photograph${content.photographyAssetIds.length === 1 ? '' : 's'}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(', ') : 'No choices recorded yet';
}

/** Every asset id a kit depends on, so a revoked asset can find the kits that used it. */
export function brandKitAssetIds(content: BrandKitContent): string[] {
  return [...new Set([...content.logoAssetIds, ...content.photographyAssetIds, ...content.typography.map((entry) => entry.assetId).filter((id): id is string => Boolean(id))])];
}

/** The approval that currently governs the kit: the latest one recorded. */
export function currentBrandKitApproval(approvals: readonly StudioBrandKitApproval[]): StudioBrandKitApproval | null {
  return [...approvals].sort((a, b) => a.approvedAt.localeCompare(b.approvedAt) || a.id.localeCompare(b.id)).at(-1) ?? null;
}

export function latestBrandKitVersion(versions: readonly StudioBrandKitVersion[]): StudioBrandKitVersion | null {
  return [...versions].sort((a, b) => b.version - a.version)[0] ?? null;
}

