import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME;
const PREFIX = process.env.SYNC_PREFIX || 'sync/';

export async function handler(event) {
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path = event.rawPath || event.path || '';
  const username = path.replace(/^\/sync\//, '').replace(/\.json$/, '');

  if (\!username || username.includes('/') || username.includes('..') || username.length > 64) {
    return respond(200, { error: 'Invalid username' });
  }

  const key = `${PREFIX}${username}.json`;

  if (method === 'GET') {
    return handleGet(key);
  } else if (method === 'PUT') {
    return handlePut(key, event);
  } else {
    return respond(200, { error: 'Method not allowed' });
  }
}

async function handleGet(key) {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await result.Body.transformToString();
    return respond(200, JSON.parse(body));
  } catch (e) {
    if (e.name === 'NoSuchKey') {
      return respond(200, { found: false });
    }
    console.error('GET error:', e);
    return respond(200, { error: 'Internal error' });
  }
}

async function handlePut(key, event) {
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return respond(200, { error: 'Invalid JSON' });
  }

  const { ciphertext, iv, salt, write_hash } = body;
  if (\!ciphertext || \!iv || \!salt || \!write_hash) {
    return respond(200, { error: 'Missing required fields: ciphertext, iv, salt, write_hash' });
  }

  // Check existing write_hash (if record exists, must match)
  try {
    const existing = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const existingData = JSON.parse(await existing.Body.transformToString());
    if (existingData.write_hash && existingData.write_hash \!== write_hash) {
      return respond(200, { error: 'Invalid credentials' });
    }
  } catch (e) {
    if (e.name \!== 'NoSuchKey') {
      console.error('Auth check error:', e);
      return respond(200, { error: 'Internal error' });
    }
    // NoSuchKey = new user, allow creation
  }

  const record = {
    ciphertext,
    iv,
    salt,
    write_hash,
    updated_at: new Date().toISOString()
  };

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: JSON.stringify(record),
    ContentType: 'application/json'
  }));

  return respond(200, { ok: true, updated_at: record.updated_at });
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
