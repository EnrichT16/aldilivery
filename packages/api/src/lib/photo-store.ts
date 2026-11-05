/**
 * Where product photos live (ruling 96, 5 November 2026): S3-compatible object storage
 * (DigitalOcean Spaces), or the database until Yvette has set it up.
 *
 * Everything the server needs is behind `PhotoStore`, so the routes, the services and the tests
 * never touch the storage directly. The Spaces store uses the AWS S3 client, version 3, pointed
 * at the Spaces endpoint; a CDN address, when given, is where photos are served from, and
 * otherwise the API serves them itself. Without the six SPACES_* settings the database store is
 * used, and `scripts/move-photos-to-spaces.mjs` moves the files over once they are set. The
 * secret is never logged and never leaves this server.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import type { Repository } from '../data/repository.js';
import type { Env } from '../env.js';

export interface StoredPhoto {
  bytes: Uint8Array;
  contentType: string;
}

export interface PhotoStore {
  /** "spaces" or "db": written on each photo's row, so a move between the two is honest. */
  readonly kind: 'spaces' | 'db';
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredPhoto | null>;
  remove(key: string): Promise<void>;
  /** Where a browser may fetch the file straight from storage, or null to serve it through the API. */
  publicUrl(key: string): string | null;
}

export interface SpacesSettings {
  key: string;
  secret: string;
  bucket: string;
  region: string;
  /** `https://lon1.digitaloceanspaces.com`; a bare host is given https. */
  endpoint: string;
  /** `https://my-space.lon1.cdn.digitaloceanspaces.com`, or null to serve through the API. */
  cdnUrl: string | null;
}

/** The Spaces settings, when the five that matter are real; otherwise nothing. */
export function spacesSettingsFrom(
  env: Pick<
    Env,
    | 'spacesKey'
    | 'spacesSecret'
    | 'spacesBucket'
    | 'spacesRegion'
    | 'spacesEndpoint'
    | 'spacesCdnUrl'
  >,
): SpacesSettings | null {
  const { spacesKey, spacesSecret, spacesBucket, spacesRegion, spacesEndpoint } = env;
  if (!spacesKey || !spacesSecret || !spacesBucket || !spacesRegion || !spacesEndpoint) {
    return null;
  }
  return {
    key: spacesKey,
    secret: spacesSecret,
    bucket: spacesBucket,
    region: spacesRegion,
    endpoint: /^https?:\/\//.test(spacesEndpoint) ? spacesEndpoint : `https://${spacesEndpoint}`,
    cdnUrl: env.spacesCdnUrl ? env.spacesCdnUrl.replace(/\/+$/, '') : null,
  };
}

/** The few S3 calls used, so a test can stand the client in without the network. */
export interface S3Like {
  send(command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand): Promise<unknown>;
}

async function bytesOf(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  const streamish = body as { transformToByteArray?: () => Promise<Uint8Array> } | null;
  if (streamish?.transformToByteArray) return streamish.transformToByteArray();
  if (body && typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  return new Uint8Array();
}

/** Product photos in DigitalOcean Spaces (or any S3-compatible storage). */
export function spacesPhotoStore(settings: SpacesSettings, client?: S3Like): PhotoStore {
  const s3: S3Like =
    client ??
    new S3Client({
      region: settings.region,
      endpoint: settings.endpoint,
      forcePathStyle: false,
      credentials: { accessKeyId: settings.key, secretAccessKey: settings.secret },
    });
  return {
    kind: 'spaces',
    async put(key, bytes, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: settings.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          // Photos are public things on a public page; a year's caching, since a key never changes.
          ACL: 'public-read',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    },
    async get(key) {
      try {
        const result = (await s3.send(
          new GetObjectCommand({ Bucket: settings.bucket, Key: key }),
        )) as { Body?: unknown; ContentType?: string };
        if (!result.Body) return null;
        return {
          bytes: await bytesOf(result.Body),
          contentType: result.ContentType ?? 'application/octet-stream',
        };
      } catch (failure) {
        if ((failure as { name?: string }).name === 'NoSuchKey') return null;
        throw failure;
      }
    },
    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
    },
    publicUrl(key) {
      if (settings.cdnUrl) return `${settings.cdnUrl}/${key}`;
      // Without a CDN, Spaces' own public address for the file.
      const host = settings.endpoint.replace(/^https?:\/\//, '');
      return `https://${settings.bucket}.${host}/${key}`;
    },
  };
}

/** Product photos in the database, until object storage is set up. Served through the API. */
export function databasePhotoStore(repository: Pick<Repository, 'storedFiles'>): PhotoStore {
  return {
    kind: 'db',
    async put(key, bytes, contentType) {
      await repository.storedFiles.put({ key, contentType, data: bytes });
    },
    async get(key) {
      const found = await repository.storedFiles.get(key);
      return found ? { bytes: found.data, contentType: found.contentType } : null;
    },
    async remove(key) {
      await repository.storedFiles.remove(key);
    },
    publicUrl() {
      return null;
    },
  };
}
