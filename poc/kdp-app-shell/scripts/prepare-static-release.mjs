import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const releaseId = String(process.env.KDP_RELEASE_ID || process.env.CF_PAGES_COMMIT_SHA || '');
if (!/^[0-9a-f]{40}$/.test(releaseId)) {
  throw new Error('KDP_RELEASE_ID or CF_PAGES_COMMIT_SHA must be the exact 40-character commit SHA.');
}

const outputRoot = process.env.KDP_STATIC_RELEASE_ROOT
  ? path.resolve(process.env.KDP_STATIC_RELEASE_ROOT)
  : path.join(appRoot, 'static');
const releaseRoot = path.join(outputRoot, 'release', releaseId);
const artifacts = ['app.js', 'app.css'];

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

const built = new Map();
for (const artifact of artifacts) {
  const source = path.join(appRoot, 'dist', artifact);
  if (!(await exists(source))) throw new Error(`Missing built artifact: dist/${artifact}`);
  built.set(artifact, await readFile(source));
}

if (await exists(releaseRoot)) {
  for (const artifact of artifacts) {
    const destination = path.join(releaseRoot, artifact);
    if (!(await exists(destination))) throw new Error(`Immutable release ${releaseId} is incomplete.`);
    const current = await readFile(destination);
    if (!current.equals(built.get(artifact))) throw new Error(`Immutable release ${releaseId} already contains different ${artifact}.`);
  }
  console.log(`Static release already prepared: /release/${releaseId}/`);
} else {
  const releaseParent = path.dirname(releaseRoot);
  const temporaryRoot = path.join(releaseParent, `.${releaseId}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(releaseParent, { recursive: true });
  await mkdir(temporaryRoot);
  try {
    for (const artifact of artifacts) {
      await writeFile(path.join(temporaryRoot, artifact), built.get(artifact), { flag: 'wx' });
    }
    await rename(temporaryRoot, releaseRoot);
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
  console.log(`Static release prepared: /release/${releaseId}/`);
}
