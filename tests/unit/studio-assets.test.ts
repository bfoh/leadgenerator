import { describe, expect, it } from 'vitest';
import {
  ASSET_KINDS,
  assetApprovalProblems,
  assetDownloadName,
  assetExportProblems,
  assetStoragePath,
  assetUsableInPrototype,
  brandKitProblems,
  checkAssetUpload,
  detectAssetFile,
  emptyBrandKitContent,
  formatBytes,
  parseBrandKitContent,
  studioAssetProblems,
  type StudioAsset,
  type StudioAssetInsert,
} from '@/lib/domain/studio-assets';
import { createZip, crc32 } from '@/lib/domain/zip';

// The vault's rules, exercised without a browser or a database: what a file actually is, what a
// person may do with it, and what may travel in an approved pack. Every fixture is synthetic.

const encoder = new TextEncoder();

function png(width = 1200, height = 800): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpeg(width = 1600, height = 900): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff], 0);
  return bytes;
}

function gif(width = 600, height = 400): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set(encoder.encode('GIF89a'), 0);
  bytes[6] = width & 0xff;
  bytes[7] = width >> 8;
  bytes[8] = height & 0xff;
  bytes[9] = height >> 8;
  return bytes;
}

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';
const SHA = 'a'.repeat(64);

function asset(overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id: ASSET,
    organizationId: ORG,
    projectId: PROJECT,
    fileName: 'logo.png',
    kind: 'logo',
    status: 'candidate',
    mimeType: 'image/png',
    bytes: 1024,
    width: 1200,
    height: 800,
    checksumSha256: SHA,
    storagePath: `${ORG}/${PROJECT}/${ASSET}/logo.png`,
    origin: 'client_supplied',
    ownerName: 'Nsroma Atelier',
    supplier: 'Ama Mensah',
    sourceUrl: null,
    licenceName: null,
    licenceReference: null,
    licenceExpiresOn: null,
    attributionRequired: false,
    attributionText: null,
    permissionEvidence: 'Email from the owner, 21 Oct 2026: these are our own photographs.',
    inspectPermission: 'granted',
    storePermission: 'granted',
    prototypePermission: 'granted',
    exportPermission: 'granted',
    publishPermission: 'denied',
    note: '',
    reviewNote: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectedReason: null,
    revokedBy: null,
    revokedAt: null,
    revokedReason: null,
    supersedesId: null,
    createdBy: 'demo-user',
    createdAt: '2026-10-25T09:00:00.000Z',
    updatedAt: '2026-10-25T09:00:00.000Z',
    ...overrides,
  };
}

function insert(overrides: Partial<StudioAssetInsert> = {}): StudioAssetInsert {
  const base = asset();
  return {
    projectId: base.projectId,
    fileName: base.fileName,
    kind: base.kind,
    mimeType: base.mimeType,
    bytes: base.bytes,
    width: base.width,
    height: base.height,
    checksumSha256: base.checksumSha256,
    storagePath: base.storagePath,
    origin: base.origin,
    ownerName: base.ownerName,
    permissionEvidence: base.permissionEvidence,
    inspectPermission: base.inspectPermission,
    storePermission: base.storePermission,
    prototypePermission: base.prototypePermission,
    exportPermission: base.exportPermission,
    publishPermission: base.publishPermission,
    ...overrides,
  };
}

describe('reading the bytes', () => {
  it('reads PNG, JPEG and GIF types and their dimensions', () => {
    expect(detectAssetFile(png(1200, 800))).toMatchObject({ mimeType: 'image/png', extension: 'png', fileClass: 'image', width: 1200, height: 800 });
    expect(detectAssetFile(jpeg(1600, 900))).toMatchObject({ mimeType: 'image/jpeg', width: 1600, height: 900 });
    expect(detectAssetFile(gif(600, 400))).toMatchObject({ mimeType: 'image/gif', width: 600, height: 400 });
  });

  it('reads documents, video and font formats from their signature', () => {
    expect(detectAssetFile(encoder.encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'))?.mimeType).toBe('application/pdf');
    expect(detectAssetFile(encoder.encode('\u0000\u0000\u0000\u0018ftypisom'))?.mimeType).toBe('video/mp4');
    expect(detectAssetFile(encoder.encode('wOFF0000'))?.mimeType).toBe('font/woff');
    expect(detectAssetFile(encoder.encode('wOF20000'))?.mimeType).toBe('font/woff2');
    expect(detectAssetFile(encoder.encode('OTTO0000'))?.mimeType).toBe('font/otf');
  });

  it('accepts plain text only when it is declared as text and decodes safely', () => {
    expect(detectAssetFile(encoder.encode('Licence agreement\n'), 'text/plain')?.mimeType).toBe('text/plain');
    expect(detectAssetFile(encoder.encode('Licence agreement\n'))).toBeNull();
    expect(detectAssetFile(new Uint8Array([0x74, 0x00, 0x78]), 'text/plain')).toBeNull();
  });

  it('refuses SVG and HTML, which can carry script', () => {
    expect(detectAssetFile(encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml')).toBeNull();
    expect(detectAssetFile(encoder.encode('<!doctype html><script>alert(1)</script>'), 'text/html')).toBeNull();
  });
});

describe('validating an upload', () => {
  it('accepts a valid image and returns the detected file', () => {
    const check = checkAssetUpload({ fileName: 'logo.png', declaredType: 'image/png', bytes: png(1200, 800) });
    expect(check.ok).toBe(true);
    expect(check.file).toMatchObject({ mimeType: 'image/png', width: 1200, height: 800 });
    expect(check.problems).toEqual([]);
  });

  it('refuses a file whose name and contents disagree', () => {
    const check = checkAssetUpload({ fileName: 'logo.png', declaredType: 'image/jpeg', bytes: png() });
    expect(check.ok).toBe(false);
    expect(check.problems[0]).toMatch(/contents are image\/png/);
  });

  it('refuses an empty file, a path in the name and a type that is not allowed', () => {
    expect(checkAssetUpload({ fileName: 'x.png', declaredType: 'image/png', bytes: new Uint8Array() }).problems[0]).toMatch(/empty/);
    expect(checkAssetUpload({ fileName: '../x.png', declaredType: 'image/png', bytes: png() }).problems[0]).toMatch(/path/);
    const svg = checkAssetUpload({ fileName: 'x.svg', declaredType: 'image/svg+xml', bytes: encoder.encode('<svg/>') });
    expect(svg.problems[0]).toMatch(/not accepted/);
  });

  it('refuses an image too large to render and one whose dimensions cannot be read', () => {
    expect(checkAssetUpload({ fileName: 'huge.png', declaredType: 'image/png', bytes: png(13_000, 800) }).problems[0]).toMatch(/13,000/);
    const truncated = png().subarray(0, 20);
    expect(checkAssetUpload({ fileName: 'cut.png', declaredType: 'image/png', bytes: truncated }).problems[0]).toMatch(/dimensions could not be read/);
  });

  it('describes sizes in words a person can use', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('storage paths', () => {
  it('puts the tenant, concept, asset and a safe file name in the path', () => {
    expect(assetStoragePath(ORG, PROJECT, ASSET, 'Nsroma Logo Final.PNG', 'png')).toBe(`${ORG}/${PROJECT}/${ASSET}/nsroma-logo-final.png`);
    expect(assetStoragePath('demo-org', PROJECT, ASSET, 'Ünïcode name?!.jpg', 'jpg')).toBe(`demo-org/${PROJECT}/${ASSET}/n-code-name.jpg`);
  });

  it('refuses a path that belongs to another organization or tries to escape', () => {
    expect(studioAssetProblems(insert(), ORG)).toEqual([]);
    expect(studioAssetProblems(insert(), '44444444-4444-4444-8444-444444444444')[0]).toMatch(/another organization/);
    expect(studioAssetProblems(insert({ storagePath: `${ORG}/${PROJECT}/${ASSET}/../secret.png` }))[0]).toMatch(/file path/);
  });

  it('names downloads from the asset, not from anything the uploader typed', () => {
    expect(assetDownloadName({ fileName: 'Logo Final!!.PNG', mimeType: 'image/png' })).toBe('Logo-Final.png');
  });
});


describe('the record itself', () => {
  it('accepts a complete candidate', () => {
    expect(studioAssetProblems(insert())).toEqual([]);
  });

  it('needs permission evidence, and a licence when the file is licensed', () => {
    expect(studioAssetProblems(insert({ permissionEvidence: 'ok' }))[0]).toMatch(/evidence/);
    expect(studioAssetProblems(insert({ origin: 'licensed' }))[0]).toMatch(/names the licence/);
    expect(studioAssetProblems(insert({ origin: 'licensed', licenceName: 'Getty licence' }))).toEqual([]);
  });

  it('never lets a file we may not keep be cleared for use', () => {
    const problems = studioAssetProblems(insert({ storePermission: 'denied', publishPermission: 'granted' }));
    expect(problems.join(' ')).toMatch(/may not keep/);
  });

  it('needs attribution wording when attribution is required, and a supported file type', () => {
    expect(studioAssetProblems(insert({ attributionRequired: true }))[0]).toMatch(/attribution/);
    expect(studioAssetProblems(insert({ mimeType: 'image/svg+xml' as never }))[0]).toMatch(/not accepted/);
  });
});

describe('approval, export and use', () => {
  it('approves a candidate only with the permission evidence recorded', () => {
    expect(assetApprovalProblems(asset())).toEqual([]);
    expect(assetApprovalProblems(asset({ permissionEvidence: 'short' }))[0]).toMatch(/evidence/);
    expect(assetApprovalProblems(asset({ storePermission: 'unknown' }))[0]).toMatch(/permission to keep/);
    expect(assetApprovalProblems(asset({ status: 'approved' }))[0]).toMatch(/candidate/);
  });

  it('refuses an expired licence at approval time', () => {
    const problems = assetApprovalProblems(asset({ licenceExpiresOn: '2026-01-01' }), '2026-10-25');
    expect(problems[0]).toMatch(/expired on 2026-01-01/);
  });

  it('exports only approved, unexpired files with export permission', () => {
    const approved = asset({ status: 'approved', approvedAt: '2026-10-25T09:00:00.000Z' });
    expect(assetExportProblems(approved, '2026-10-25')).toEqual([]);
    expect(assetExportProblems({ ...approved, status: 'candidate' }, '2026-10-25')[0]).toMatch(/Only an approved/);
    expect(assetExportProblems({ ...approved, exportPermission: 'unknown' }, '2026-10-25')[0]).toMatch(/Export permission/);
    expect(assetExportProblems({ ...approved, licenceExpiresOn: '2026-01-01' }, '2026-10-25')[0]).toMatch(/expired/);
    expect(assetExportProblems({ ...approved, status: 'superseded' }, '2026-10-25')[0]).toMatch(/replaced/);
    expect(assetExportProblems({ ...approved, attributionRequired: true, attributionText: null }, '2026-10-25')[0]).toMatch(/attribution/);
  });

  it('clears a prototype only when the asset is approved, unexpired and permitted', () => {
    const approved = asset({ status: 'approved', approvedAt: '2026-10-25T09:00:00.000Z' });
    expect(assetUsableInPrototype(approved, '2026-10-25')).toBe(true);
    expect(assetUsableInPrototype({ ...approved, prototypePermission: 'denied' }, '2026-10-25')).toBe(false);
    expect(assetUsableInPrototype({ ...approved, licenceExpiresOn: '2026-01-01' }, '2026-10-25')).toBe(false);
  });

  it('knows every kind and keeps a video from pretending to be an image', () => {
    expect(ASSET_KINDS).toContain('logo');
    expect(studioAssetProblems(insert({ kind: 'video' })).join(' ')).toMatch(/Approved video cannot be a PNG image/);
  });
});


describe('the Brand Kit', () => {
  const logo = asset({ status: 'approved', approvedAt: '2026-10-25T09:00:00.000Z', kind: 'logo' });
  const photo = asset({ id: '55555555-5555-4555-8555-555555555555', status: 'approved', approvedAt: '2026-10-25T09:00:00.000Z', kind: 'product_photo', fileName: 'gown.png' });

  function kit(overrides: Partial<ReturnType<typeof emptyBrandKitContent>> = {}) {
    return {
      ...emptyBrandKitContent(),
      logoAssetIds: [logo.id],
      palette: [
        { name: 'Ink', hex: '#1B2A41', role: 'Text' },
        { name: 'Kente red', hex: '#7A1F3D', role: 'Accent' },
      ],
      typography: [{ role: 'Display', family: 'Fraunces', weights: '400–700', licence: 'SIL Open Font License 1.1', assetId: null }],
      personality: ['Quietly confident', 'Exacting', 'Warm'],
      visualDirection: 'Editorial and unhurried: warm off-white, one deep red, photography given room to breathe and type doing the talking.',
      toneOfVoice: { summary: 'Plain, precise and proud of the craft. Short sentences; no exclamation marks.', do: [], dont: [] },
      ...overrides,
    };
  }

  it('accepts a complete kit that names approved files', () => {
    expect(brandKitProblems(kit({ photographyAssetIds: [photo.id] }), [logo, photo], { forApproval: true })).toEqual([]);
  });

  it('refuses a file that is not approved, the wrong kind, or from another concept', () => {
    const candidate = asset({ status: 'candidate' });
    expect(brandKitProblems(kit(), [candidate], { forApproval: true }).join(' ')).toMatch(/not approved/);
    expect(brandKitProblems(kit({ photographyAssetIds: [logo.id] }), [logo], { forApproval: true }).join(' ')).toMatch(/not photography/);
    expect(brandKitProblems(kit({ logoAssetIds: ['99999999-9999-4999-8999-999999999999'] }), [logo], { forApproval: true }).join(' ')).toMatch(/not in this concept/);
  });

  it('checks hex values, roles and the licence before approval', () => {
    const badHex = kit({ palette: [{ name: 'Ink', hex: 'blue', role: 'Text' }] });
    expect(brandKitProblems(badHex, [logo], { forApproval: true }).join(' ')).toMatch(/hex value/);
    const noLicence = kit({ typography: [{ role: 'Display', family: 'Fraunces', weights: '', licence: '', assetId: null }] });
    expect(brandKitProblems(noLicence, [logo], { forApproval: true }).join(' ')).toMatch(/web licence/);
  });

  it('lets a draft be incomplete but not an approved kit', () => {
    const draft = emptyBrandKitContent();
    expect(brandKitProblems(draft, [])).toEqual([]);
    expect(brandKitProblems(draft, [], { forApproval: true }).length).toBeGreaterThan(3);
  });

  it('reads stored JSON without trusting it', () => {
    const parsed = parseBrandKitContent({
      palette: [{ name: ' Ink ', hex: '#102030', role: 'Text' }, { hex: 'nope' }],
      personality: ['Warm', 42, 'Warm'],
      logoAssetIds: ['not-an-id', logo.id],
    });
    expect(parsed.palette).toEqual([{ name: 'Ink', hex: '#102030', role: 'Text' }]);
    expect(parsed.personality).toEqual(['Warm']);
    expect(parsed.logoAssetIds).toEqual([logo.id]);
    expect(parseBrandKitContent(null)).toEqual(emptyBrandKitContent());
  });
});

describe('the ZIP writer', () => {
  const readZip = (zip: Uint8Array) => {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let eocd = -1;
    for (let i = zip.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('No end-of-central-directory record');
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const entries: { name: string; data: Uint8Array; crc: number }[] = [];
    for (let i = 0; i < count; i++) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Bad central directory entry');
      const crc = view.getUint32(offset + 16, true);
      const size = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const local = view.getUint32(offset + 42, true);
      const name = new TextDecoder().decode(zip.subarray(offset + 46, offset + 46 + nameLength));
      const localNameLength = view.getUint16(local + 26, true);
      const localExtraLength = view.getUint16(local + 28, true);
      const start = local + 30 + localNameLength + localExtraLength;
      entries.push({ name, data: zip.subarray(start, start + size), crc });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  };

  it('computes the standard CRC-32 for a known string', () => {
    expect(crc32(encoder.encode('hello'))).toBe(0x3610a686);
  });

  it('writes readable entries with their bytes and checksums', () => {
    const zip = createZip([
      { name: 'manifest.json', data: encoder.encode('{"format":"dof-asset-pack/1"}') },
      { name: 'assets/001-logo.png', data: png(10, 10) },
    ], new Date('2026-10-25T09:00:00.000Z'));
    const entries = readZip(zip);
    expect(entries.map((entry) => entry.name)).toEqual(['manifest.json', 'assets/001-logo.png']);
    expect(new TextDecoder().decode(entries[0].data)).toBe('{"format":"dof-asset-pack/1"}');
    expect(entries[1].data).toEqual(png(10, 10));
    expect(entries.every((entry) => entry.crc === crc32(entry.data))).toBe(true);
  });

  it('refuses duplicate or unsafe entry names', () => {
    const data = encoder.encode('x');
    expect(() => createZip([{ name: 'a.txt', data }, { name: 'a.txt', data }])).toThrow(/already contains/);
    expect(() => createZip([{ name: '../a.txt', data }])).toThrow(/safe relative path/);
    expect(() => createZip([{ name: '/a.txt', data }])).toThrow(/safe relative path/);
  });
});

