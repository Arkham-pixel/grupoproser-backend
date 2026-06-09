import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { storageConfig } from '../config/storage.js';

let _client = null;

function getS3Client() {
  if (_client) return _client;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const endpoint = storageConfig.endpoint();
  const config = {
    region: storageConfig.region(),
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  };
  if (endpoint) {
    config.endpoint = endpoint;
    config.forcePathStyle = storageConfig.forcePathStyle();
  }
  _client = new S3Client(config);
  return _client;
}

export function mapS3ErrorMessage(error) {
  const name = error?.name || '';
  const msg = String(error?.message || '');
  const bucket = getBucketName();
  const region = storageConfig.region();
  const isAccessDenied =
    name === 'AccessDenied' ||
    name === 'Forbidden' ||
    /not authorized to perform/i.test(msg) ||
    /AccessDenied/i.test(msg);

  if (name === 'NoSuchBucket') {
    return `El bucket S3 "${bucket}" no existe en la región ${region}. Créalo en AWS Console (S3 → Create bucket) o corrige AWS_S3_BUCKET / AWS_REGION en .env.`;
  }
  if (isAccessDenied) {
    return `El usuario IAM no tiene permiso s3:PutObject en el bucket "${bucket}". En AWS Console → IAM → arnalddataflow-s3-user → Add permissions, adjunta una política con s3:PutObject, s3:GetObject, s3:DeleteObject y s3:ListBucket sobre ese bucket.`;
  }
  if (name === 'InvalidAccessKeyId' || name === 'SignatureDoesNotMatch') {
    return 'Credenciales AWS inválidas. Revisa AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY en .env.';
  }
  return msg || 'Error al guardar archivo en S3';
}

export function isS3AccessDeniedError(error) {
  const name = error?.name || '';
  const msg = String(error?.message || '');
  return (
    name === 'AccessDenied' ||
    name === 'Forbidden' ||
    /not authorized to perform/i.test(msg)
  );
}

/** Comprueba conexión y existencia del bucket; opcionalmente lo crea. */
export async function ensureBucketReady() {
  const bucket = getBucketName();
  if (!bucket) {
    throw new Error('AWS_S3_BUCKET no está definido');
  }
  const client = getS3Client();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return { ok: true, created: false, bucket };
  } catch (error) {
    const missing =
      error?.name === 'NotFound' ||
      error?.name === 'NoSuchBucket' ||
      error?.$metadata?.httpStatusCode === 404;
    if (!missing) {
      throw error;
    }
    if (!storageConfig.autoCreateBucket()) {
      throw error;
    }
    const input = { Bucket: bucket };
    if (storageConfig.region() !== 'us-east-1') {
      input.CreateBucketConfiguration = { LocationConstraint: storageConfig.region() };
    }
    await client.send(new CreateBucketCommand(input));
    console.log(`☁️ Bucket S3 creado: ${bucket} (${storageConfig.region()})`);
    return { ok: true, created: true, bucket };
  }
}

export function getBucketName() {
  return storageConfig.bucket();
}

/** Metadatos x-amz-meta-* deben ser ASCII; UTF-8 sin codificar rompe la firma SigV4. */
function toS3MetadataValue(value) {
  const s = String(value ?? '').slice(0, 1024);
  if (!s) return '';
  return /^[\x00-\x7F]*$/.test(s) ? s : encodeURIComponent(s);
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
        Object.entries(metadata).map(([k, v]) => [k, toS3MetadataValue(v)])
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
 * Lista y elimina todos los objetos bajo un prefijo (mantenimiento por año/trimestre/mes/día).
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
