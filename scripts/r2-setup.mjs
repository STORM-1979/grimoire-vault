/**
 * One-shot R2 bootstrap:
 *  1. Verify credentials by listing the bucket
 *  2. Apply CORS policy required for browser-direct uploads
 *  3. Round-trip a small test object (PUT, GET, DELETE)
 *
 * Run:
 *   node scripts/r2-setup.mjs
 */
import {
  S3Client,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

const ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.CLOUDFLARE_R2_BUCKET;
const ENDPOINT = process.env.CLOUDFLARE_R2_ENDPOINT;

if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY || !BUCKET || !ENDPOINT) {
  console.error("Missing CLOUDFLARE_R2_* env vars");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: ENDPOINT,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
});

async function step(name, fn) {
  process.stdout.write(`→ ${name}… `);
  try {
    const result = await fn();
    console.log("ok");
    return result;
  } catch (e) {
    console.log("FAIL");
    console.error(`   ${e?.name ?? "Error"}: ${e?.message ?? e}`);
    process.exit(1);
  }
}

// 1. credential check
await step("verify credentials (list bucket)", async () => {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 }));
  return `objects in bucket: ${res.KeyCount ?? 0}`;
});

// 2. apply CORS
const corsRules = [
  {
    AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
    AllowedOrigins: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://*.vercel.app",
    ],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  },
];
await step("apply CORS policy", async () => {
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: { CORSRules: corsRules },
    })
  );
});
await step("read CORS back", async () => {
  const res = await s3.send(new GetBucketCorsCommand({ Bucket: BUCKET }));
  console.log();
  console.log(JSON.stringify(res.CORSRules, null, 2));
  return "ok";
});

// 3. round-trip
const TEST_KEY = `_ops/health/${Date.now()}.txt`;
const TEST_BODY = `grimoire-vault r2 health check ${new Date().toISOString()}`;

await step("PUT test object", async () => {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: TEST_KEY,
      Body: TEST_BODY,
      ContentType: "text/plain",
      Metadata: { source: "r2-setup-script" },
    })
  );
  return TEST_KEY;
});

await step("GET test object + checksum", async () => {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: TEST_KEY }));
  const got = await res.Body.transformToString();
  const same = got === TEST_BODY;
  const sumA = createHash("sha256").update(TEST_BODY).digest("hex").slice(0, 12);
  const sumB = createHash("sha256").update(got).digest("hex").slice(0, 12);
  if (!same) throw new Error(`mismatch: ${sumA} != ${sumB}`);
  return `sha256 prefix=${sumA} (${got.length} bytes)`;
});

await step("DELETE test object", async () => {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: TEST_KEY }));
});

console.log();
console.log("R2 ready.");
console.log(`Bucket: ${BUCKET} @ ${ENDPOINT}`);
