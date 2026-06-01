import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { storageConfig } from '../config/storage.js';

let _client = null;

function getS3Client() {
  if (_client) return _client;
  _client = new S3Client({
    region: storageConfig.region(),
  });
  return _client;
}

export function getBucketName() {
  return storageConfig.bucket();
}

export async function putObject({ key, body, contentType, metadata = {} }) {
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
      Metadata: Object.fromEntries(
        Object.entries(metadata).map(([k, v]) => [k, String(v ?? '').slice(0, 1024)])
      ),
    })
  );
  return { bucket: getBucketName(), key };
}

export async function getObjectStream(key) {
  const client = getS3Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    })
  );
  return response;
}

export async function deleteObject(key) {
  const client = getS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    })
  );
}

/**
 * Lista y elimina todos los objetos bajo un prefijo (mantenimiento por año/semestre/cliente).
 */
export async function deleteObjectsByPrefix(prefix, { dryRun = false, maxKeys = 1000 } = {}) {
  const client = getS3Client();
  const bucket = getBucketName();
  let continuationToken;
  let deleted = 0;
  let listed = 0;
  const keys = [];

  do {
    const listResp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: maxKeys,
      })
    );
    const contents = listResp.Contents || [];
    listed += contents.length;
    for (const obj of contents) {
      if (obj.Key) keys.push({ Key: obj.Key });
    }
    continuationToken = listResp.IsTruncated ? listResp.NextContinuationToken : undefined;
  } while (continuationToken);

  if (dryRun) {
    return { dryRun: true, listed, deleted: 0, prefix, sampleKeys: keys.slice(0, 10).map((k) => k.Key) };
  }

  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    if (!batch.length) continue;
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch, Quiet: true },
      })
    );
    deleted += batch.length;
  }

  return { dryRun: false, listed, deleted, prefix };
}

export async function getSignedDownloadUrl(key, expiresIn) {
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });
  return getSignedUrl(client, command, {
    expiresIn: expiresIn ?? storageConfig.signedUrlExpiresSeconds(),
  });
}

export function getPublicObjectUrl(key) {
  const base = storageConfig.publicBaseUrl();
  if (!base) return null;
  const encodedKey = key.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `${base}/${encodedKey}`;
}
