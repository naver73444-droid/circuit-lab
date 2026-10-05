import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixedFiles = [
  'README.md',
  'START-HERE.md',
  'index.html',
  'package.json',
  'server.mjs',
  'start-circuit-lab.cmd',
  'styles.css',
  'DESIGN.md',
];

/** Portable relative files only; never interpret Windows drive, ADS or device paths. */
function safeRelativePath(path) {
  if (typeof path !== 'string' || !path || path.length > 600 || /[\\:\x00-\x1f]/.test(path)) throw new Error(`Unsafe source path: ${path}`);
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[ .]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`Unsafe source path: ${path}`);
  return path;
}

async function rejectSymlinkAncestors(target) {
  let current = resolve(target);
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink path is not allowed: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function portablePath(path) {
  return path.split(sep).join('/');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function recursiveFiles(directory) {
  const found = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    if (['__pycache__', 'node_modules', '.git'].includes(entry.name)) continue;
    const absolute = resolve(root, directory, entry.name);
    const path = portablePath(relative(root, absolute));
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed in source payload: ${path}`);
    if (entry.isDirectory()) found.push(...await recursiveFiles(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

async function sourceRecords() {
  // Attached AGENTS/Skill material is provenance, not executable source payload.
  const files = [...fixedFiles, ...await recursiveFiles('src'), ...await recursiveFiles('tests'), ...await recursiveFiles('scripts'), ...await recursiveFiles('docs')]
    .sort((a, b) => a.localeCompare(b, 'en'));
  const records = [];
  for (const path of files) {
    safeRelativePath(path);
    await rejectSymlinkAncestors(resolve(root, path));
    const bytes = await readFile(resolve(root, path));
    records.push({ path, bytes, size: bytes.length, sha256: sha256(bytes) });
  }
  return records;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(records) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const record of records) {
    const name = Buffer.from(record.path, 'utf8');
    const checksum = crc32(record.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12); // 1980-01-01, fixed reproducible metadata
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(record.size, 18);
    local.writeUInt32LE(record.size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, record.bytes);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x0021, 14);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(record.size, 20);
    entry.writeUInt32LE(record.size, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + record.size;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(records.length, 8);
  end.writeUInt16LE(records.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBytes, end]);
}

function manifestText(records) {
  return `path\tbytes\tsha256\n${records.map(({ path, size, sha256: hash }) => `${path}\t${size}\t${hash}`).join('\n')}\n`;
}

function textContainer(records) {
  const header = [
    'CIRCUIT-LAB-SOURCE-COPY v1',
    'container-encoding: UTF-8 without BOM',
    'payload-encoding: base64 (preserves BOM, line endings, and trailing newline byte-for-byte)',
    'record-format: one JSON object per line after ---; fields path, bytes, sha256, encoding, data',
    '---',
  ].join('\n');
  const lines = records.map(({ path, bytes, size, sha256: hash }) => JSON.stringify({
    path,
    bytes: size,
    sha256: hash,
    encoding: 'base64',
    data: bytes.toString('base64'),
  }));
  return Buffer.from(`${header}\n${lines.join('\n')}\n`, 'utf8');
}

async function create(outputArg, baseName = 'Circuit-Lab-CIRCUIT-007-UX') {
  if (!outputArg) throw new Error('Usage: node scripts/export-source.mjs create <output-directory> [base-name]');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(baseName)) throw new Error('Unsafe export base name');
  const output = resolve(outputArg);
  await rejectSymlinkAncestors(output);
  const records = await sourceRecords();
  const zip = makeZip(records);
  const text = textContainer(records);
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, `${baseName}.zip`), zip);
  await writeFile(resolve(output, `${baseName}.txt`), text);
  await writeFile(resolve(output, 'source-manifest.tsv'), manifestText(records), 'utf8');
  const metadata = {
    schema: 1,
    files: records.length,
    payloadBytes: records.reduce((sum, record) => sum + record.size, 0),
    manifestSha256: sha256(Buffer.from(manifestText(records), 'utf8')),
    zip: { file: `${baseName}.zip`, bytes: zip.length, sha256: sha256(zip), method: 'ZIP store', timestamp: '1980-01-01T00:00:00 local DOS time' },
    text: { file: `${baseName}.txt`, bytes: text.length, sha256: sha256(text), encoding: 'UTF-8 without BOM; base64 payload records' },
  };
  await writeFile(resolve(output, 'export-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(metadata));
}

async function restoreText(inputArg, outputArg) {
  if (!inputArg || !outputArg) throw new Error('Usage: node scripts/export-source.mjs restore-txt <input.txt> <empty-output-directory>');
  const inputBytes = await readFile(resolve(inputArg));
  if (inputBytes.length > 50_000_000) throw new Error('Source-copy container exceeds 50 MB');
  const input = inputBytes.toString('utf8').split('\n');
  const divider = input.indexOf('---');
  if (divider < 0 || input[0] !== 'CIRCUIT-LAB-SOURCE-COPY v1') throw new Error('Unsupported source-copy container');
  const output = resolve(outputArg);
  await rejectSymlinkAncestors(output);
  try { if ((await readdir(output)).length) throw new Error('Restore requires a new or empty directory; no existing files are overwritten'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const records = [];
  const names = new Set();
  // Validate every record before writing any file; a corrupt final record cannot partially restore.
  for (const line of input.slice(divider + 1).filter(Boolean)) {
    const record = JSON.parse(line);
    safeRelativePath(record.path);
    const key = record.path.toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate portable path: ${record.path}`);
    names.add(key);
    if (record.encoding !== 'base64' || typeof record.data !== 'string' || !Number.isSafeInteger(record.bytes) || record.bytes < 0) throw new Error(`Invalid payload: ${record.path}`);
    const bytes = Buffer.from(record.data, 'base64');
    if (bytes.toString('base64') !== record.data || bytes.length !== record.bytes || sha256(bytes) !== record.sha256) throw new Error(`Payload mismatch: ${record.path}`);
    records.push({ path: record.path, bytes, size: bytes.length, sha256: record.sha256 });
  }
  if (!records.length || records.length > 5000) throw new Error('Invalid source record count');
  for (const record of records) {
    const destination = resolve(output, record.path);
    await rejectSymlinkAncestors(destination);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, record.bytes, { flag: 'wx' });
  }
  records.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  console.log(JSON.stringify({ restored: records.length, manifestSha256: sha256(Buffer.from(manifestText(records), 'utf8')) }));
}

async function verify(rootArg, manifestArg) {
  if (!rootArg || !manifestArg) throw new Error('Usage: node scripts/export-source.mjs verify <root-directory> <source-manifest.tsv>');
  const lines = (await readFile(resolve(manifestArg), 'utf8')).trimEnd().split('\n');
  if (lines[0] !== 'path\tbytes\tsha256') throw new Error('Invalid manifest header');
  const seen = new Set();
  const expected = lines.slice(1).map((line) => {
    const [path, size, hash] = line.split('\t');
    safeRelativePath(path);
    if (seen.has(path.toLowerCase()) || !/^\d+$/.test(size) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid or duplicate manifest record');
    seen.add(path.toLowerCase());
    return { path, size: Number(size), sha256: hash };
  });
  const actual = [];
  for (const record of expected) {
    const path = resolve(rootArg, record.path);
    await rejectSymlinkAncestors(path);
    const info = await lstat(path);
    if (!info.isFile()) throw new Error(`Not a file: ${record.path}`);
    const bytes = await readFile(path);
    actual.push({ path: record.path, size: bytes.length, sha256: sha256(bytes) });
  }
  const mismatches = expected.filter((record, index) => JSON.stringify(record) !== JSON.stringify(actual[index]));
  console.log(JSON.stringify({ files: actual.length, scope: 'listed manifest files only', mismatches }));
  if (mismatches.length) process.exitCode = 1;
}

const [command = 'create', ...args] = process.argv.slice(2);
if (command === 'create') await create(...args);
else if (command === 'restore-txt') await restoreText(...args);
else if (command === 'verify') await verify(...args);
else throw new Error(`Unknown command: ${command}`);
