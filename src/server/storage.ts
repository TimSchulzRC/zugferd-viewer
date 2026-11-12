import { DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";

const globals = globalThis as { zugferdS3?: S3Client };

function client() {
  const { S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env();
  return (globals.zugferdS3 ??= new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    // Self-hosted S3 rarely has a DNS name per bucket.
    forcePathStyle: true,
    // The SDK's newer default adds CRC32 checksums to every request, which S3 servers other than AWS often reject.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  }));
}

/** Says in the server log at startup whether the bucket is usable, so a wrong S3 setting shows before the first upload. */
export async function checkBucket() {
  const { S3_BUCKET, S3_ENDPOINT, S3_REGION } = env();
  try {
    await client().send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    console.log(`S3 ready: bucket reachable at ${S3_ENDPOINT} (region ${S3_REGION})`);
  } catch (error) {
    const { name, message, $metadata } = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    console.error(`S3 NOT ready: ${S3_ENDPOINT} (region ${S3_REGION}) answered ${$metadata?.httpStatusCode ?? "no status"} ${name ?? ""} ${message ?? ""}`);
  }
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  await client().send(new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<{ stream: () => ReadableStream<Uint8Array>; bytes: () => Promise<Uint8Array> }> {
  const { Body } = await client().send(new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
  if (!Body) throw new Error(`Object ${key} has no body`);
  // The body can be read once, so the caller picks one of the two.
  return { stream: () => Body.transformToWebStream(), bytes: () => Body.transformToByteArray() };
}

export async function deleteObjects(keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
    await client().send(new DeleteObjectsCommand({ Bucket: env().S3_BUCKET, Delete: { Objects: batch, Quiet: true } }));
  }
}
