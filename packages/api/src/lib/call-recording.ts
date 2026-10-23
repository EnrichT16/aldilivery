/**
 * Recording staff calls (ruling 77, Anthony, 23 October 2026).
 *
 * LiveKit Egress records the room's sound alone (an audio-only room composite) straight into
 * S3-compatible storage, such as DigitalOcean Spaces. Only the owner and the people he lets
 * authorise can play a recording, through a link signed for a few minutes; the retention sweep
 * deletes each one after `companyContact.callRecordingDays` (90).
 *
 * Everything the server needs is behind `CallRecorder`, so the routes and the tests never touch
 * LiveKit or the storage directly. Signing a link and deleting a file use the storage's own
 * signature (AWS Signature Version 4), written out here in full rather than taken from a large
 * library holding the storage's keys. The secret is never logged and never leaves this server.
 *
 * Without LiveKit or any of the five RECORDING_S3_* settings there is no recorder: calls still
 * work, and the log says "not recorded: recording storage not set up".
 */

import { createHash, createHmac } from 'node:crypto';

import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload } from 'livekit-server-sdk';

import type { Env } from '../env.js';

export interface CallRecorder {
  /** Starts recording the room's sound into `key`. */
  start(input: { roomName: string; key: string }): Promise<{ egressId: string }>;
  /** Stops it, if it is still going (it stops by itself when the room closes). */
  stop(egressId: string): Promise<void>;
  /** A link that plays the recording for `seconds`, then stops working. */
  playbackUrl(key: string, seconds: number): string;
  /** Deletes the recording from storage. */
  remove(key: string): Promise<void>;
}

export interface RecordingStorage {
  /** `https://lon1.digitaloceanspaces.com`; a bare host is given https. */
  endpoint: string;
  bucket: string;
  accessKey: string;
  secret: string;
  region: string;
}

/** The storage settings, when all five are real; otherwise nothing. */
export function recordingStorageFrom(
  env: Pick<
    Env,
    | 'recordingS3Endpoint'
    | 'recordingS3Bucket'
    | 'recordingS3Key'
    | 'recordingS3Secret'
    | 'recordingS3Region'
  >,
): RecordingStorage | null {
  const {
    recordingS3Endpoint: endpoint,
    recordingS3Bucket: bucket,
    recordingS3Key: accessKey,
    recordingS3Secret: secret,
    recordingS3Region: region,
  } = env;
  if (!endpoint || !bucket || !accessKey || !secret || !region) return null;
  return {
    endpoint: /^https?:\/\//.test(endpoint) ? endpoint.replace(/\/+$/, '') : `https://${endpoint}`,
    bucket,
    accessKey,
    secret,
    region,
  };
}

/* ------------------------------------------------------------------ the storage's signature */

/** RFC 3986 encoding, as the signature needs: everything but letters, digits and -._~. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

/**
 * A pre-signed address (AWS Signature Version 4, query string form) for one request to one
 * object: `method` on `https://{host}{path}`, good for `expiresSeconds` from `at`.
 */
export function presignedUrl(input: {
  method: 'GET' | 'DELETE';
  protocol?: 'https:' | 'http:';
  host: string;
  /** Starts with a slash; each part is encoded here. */
  path: string;
  region: string;
  accessKey: string;
  secret: string;
  expiresSeconds: number;
  at: Date;
}): string {
  const amzDate = input.at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(input.expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encode(name)}=${encode(query[name] ?? '')}`)
    .join('&');
  const canonicalPath = input.path
    .split('/')
    .map((part) => encode(part))
    .join('/');
  const canonicalRequest = [
    input.method,
    canonicalPath,
    canonicalQuery,
    `host:${input.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secret}`, day), input.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return `${input.protocol ?? 'https:'}//${input.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** The address of one recording in path style: `https://{endpoint}/{bucket}/{key}`. */
function storageUrl(
  storage: RecordingStorage,
  method: 'GET' | 'DELETE',
  key: string,
  seconds: number,
  at: Date,
): string {
  const endpoint = new URL(storage.endpoint);
  return presignedUrl({
    method,
    protocol: endpoint.protocol === 'http:' ? 'http:' : 'https:',
    host: endpoint.host,
    path: `/${storage.bucket}/${key}`,
    region: storage.region,
    accessKey: storage.accessKey,
    secret: storage.secret,
    expiresSeconds: seconds,
    at,
  });
}

/* ------------------------------------------------------------------ LiveKit Egress */

export function livekitRecorder(
  livekit: { url: string; apiKey: string; apiSecret: string },
  storage: RecordingStorage,
  options: { fetchImpl?: typeof fetch; now?: () => Date } = {},
): CallRecorder {
  const host = livekit.url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  const egress = new EgressClient(host, livekit.apiKey, livekit.apiSecret);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    async start({ roomName, key }) {
      const output = new EncodedFileOutput({
        fileType: EncodedFileType.OGG,
        filepath: key,
        output: {
          case: 's3',
          value: new S3Upload({
            accessKey: storage.accessKey,
            secret: storage.secret,
            region: storage.region,
            endpoint: storage.endpoint,
            bucket: storage.bucket,
            forcePathStyle: true,
          }),
        },
      });
      const info = await egress.startRoomCompositeEgress(roomName, output, { audioOnly: true });
      return { egressId: info.egressId };
    },

    async stop(egressId) {
      await egress.stopEgress(egressId);
    },

    playbackUrl(key, seconds) {
      return storageUrl(storage, 'GET', key, seconds, now());
    },

    async remove(key) {
      const response = await fetchImpl(storageUrl(storage, 'DELETE', key, 300, now()), {
        method: 'DELETE',
      });
      // Already gone counts as deleted.
      if (!response.ok && response.status !== 404) {
        throw new Error(`The recording could not be deleted (status ${response.status}).`);
      }
    },
  };
}
