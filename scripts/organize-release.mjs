#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--private-only') {
      if (values.has(name)) throw new Error(`Duplicate argument: ${name}`);
      values.set(name, true);
      continue;
    }
    if (!['--version', '--date', '--output'].includes(name)) {
      throw new Error(`Unknown argument: ${name}`);
    }
    if (values.has(name)) throw new Error(`Duplicate argument: ${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    values.set(name, value);
    index += 1;
  }
  return values;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function assertSidecar(sourcePath, sourceHash) {
  const sidecarPath = `${sourcePath}.sha256`;
  let sidecar;
  try {
    const info = await lstat(sidecarPath);
    if (!info.isFile()) throw new Error(`SHA-256 sidecar is not a file: ${sidecarPath}`);
    sidecar = await readFile(sidecarPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  const matches = [...sidecar.matchAll(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/gi)];
  if (matches.length !== 1) throw new Error(`Cannot parse a single SHA-256 from sidecar: ${sidecarPath}`);
  const expected = matches[0][0].toLowerCase();
  if (expected !== sourceHash) throw new Error(`Source hash does not match sidecar: ${sidecarPath}`);
}

async function assertFileMagic(path, format) {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (format === 'dmg' && info.size < 512) throw new Error(`DMG is shorter than its 512-byte trailer: ${path}`);
    const magic = Buffer.alloc(4);
    const position = format === 'dmg' ? info.size - 512 : 0;
    const { bytesRead } = await file.read(magic, 0, format === 'dmg' ? 4 : 2, position);
    const expected = format === 'apk' ? 'PK' : format === 'exe' ? 'MZ' : 'koly';
    if (bytesRead < expected.length || magic.subarray(0, expected.length).toString('ascii') !== expected) {
      const label = format === 'apk' ? 'APK ZIP' : format === 'exe' ? 'Windows EXE MZ' : 'DMG koly trailer';
      throw new Error(`${label} magic is missing: ${path}`);
    }
  } finally {
    await file.close();
  }
}

async function ensureCompatibleExistingFile(path, expectedHash, expectedBytes) {
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error(`Destination path is not a regular file: ${path}`);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  const actualHash = await sha256(path);
  if (actualHash !== expectedHash) throw new Error(`Refusing to overwrite a different existing file: ${path}`);
  const info = await lstat(path);
  if (info.size !== expectedBytes) throw new Error(`Existing file size differs despite matching hash: ${path}`);
  return true;
}

function safeRelative(root, path) {
  const value = relative(root, path);
  if (!value || value === '..' || value.startsWith(`..${sep}`)) {
    throw new Error(`Path escaped the project root: ${path}`);
  }
  return value.split(sep).join('/');
}

function makeReadme({ version, versionCode, date, artifacts, privateOnly }) {
  const byPlatform = (name) => artifacts.filter((item) => item.platformLabel === name);
  const lookup = (platform, mode) => byPlatform(platform).find((item) => item.mode === mode);
  const rows = privateOnly
    ? ['Android APK', 'Windows EXE', 'macOS DMG'].map((platform) => {
      const item = lookup(platform, 'private');
      if (!item) throw new Error(`Private artifact is missing for ${platform}`);
      return `| ${platform} | \`${item.filename}\` | ${version} |`;
    })
    : ['Android APK', 'Windows EXE', 'macOS DMG'].map((platform) => {
      const priv = lookup(platform, 'private');
      const pub = lookup(platform, 'public');
      if (!priv || !pub) throw new Error(`Private/public artifact pair is missing for ${platform}`);
      return `| ${platform} | \`${priv.filename}\` | \`${pub.filename}\` | ${version} |`;
    });
  const fileTable = privateOnly
    ? `| 平台 | 自用包（保留个人图源） | 版本 |\n| --- | --- | --- |\n${rows.join('\n')}`
    : `| 平台 | 自用版（保留个人图源） | 公开版（不含个人图源） | 版本 |\n| --- | --- | --- | --- |\n${rows.join('\n')}`;

  return `# 山兔跨平台交付包（${date}）\n\n`
    + (privateOnly
      ? `本目录为 private-only 交付，包含 3 个自用安装包。Android versionCode 为 ${versionCode}；自用包保留已注册的天地图及 39 项个人图源。\n\n`
      : `本文件夹包含 Android、Windows 与 macOS 三个平台的 ${version} 版本。Android versionCode 为 ${versionCode}。三个平台均分别提供自用版与公开版，使用时按目录分类选择。\n\n`)
    + `## 文件一览\n\n${fileTable}\n\n`
    + `## 安装说明\n\n`
    + `- **Android：** 将 APK 传到设备并打开安装。首次安装可能需要允许当前文件管理器安装未知来源应用；覆盖已有应用需保持原包名和签名。\n`
    + `- **Windows：** 运行 EXE。需要 WebView2 Runtime；行业 PNG 导出使用系统 Edge 或 Chrome。\n`
    + `- **macOS：** 打开 DMG，将 \`Shantu.app\` 拖入 Applications，再从 Applications 双击启动。该应用是地图浏览器启动器：地图在浏览器窗口中使用本机服务显示，并非原生地图窗口。启动后保持 Terminal 服务窗口运行，关闭该窗口会停止地图服务。\n\n`
    + `## 配置与验收边界\n\n`
    + (privateOnly
      ? `这 3 个自用包保留用户注册的天地图配置和 39 项图源 seed；请将整个文件夹按私人交付范围保管。Mac DMG 是双芯片本地浏览器地图启动器，当前未签名、未公证。它不包含原生 HarmonyOS 安装包。真实 Mac 触控、GPS、后台能力及 Gatekeeper 提示需要设备单独验收；本次文件哈希与格式检查不代表这些平台验收已通过。\n\n`
      : `自用版保留用户注册的天地图图源配置；公开版不包含个人 Key 或图源 seed。请勿将自用版作为公开分发包。Mac DMG 是双芯片本地浏览器地图启动器，当前未签名、未公证。它不包含原生 HarmonyOS 安装包。真实 Mac 触控、GPS、后台能力及 Gatekeeper 提示需要设备单独验收；本次文件哈希与格式检查不代表这些平台验收已通过。\n\n`)
    + `跨设备前，请使用应用内存档或完整工程导出迁移用户数据。浏览器本机数据不会随安装包自动复制。\n\n`
    + `## 校验\n\n${privateOnly ? '这 3 个 private-only 安装包' : '全部 6 个安装包'}的字节数、SHA-256 和相对路径记录在同目录的 \`SHA256SUMS.txt\` 与 \`manifest.json\`。\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const productSource = await readFile(join(projectRoot, 'config/product.ts'), 'utf8');
  const configuredVersion = productSource.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];
  if (!configuredVersion) throw new Error('APP_VERSION could not be read from config/product.ts');
  const version = args.get('--version') ?? configuredVersion;
  const privateOnly = args.has('--private-only');
  const date = args.get('--date');
  if (!date) throw new Error('--date is required; pass the release date explicitly');
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version)) throw new Error(`Invalid version: ${version}`);
  const dateValue = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(dateValue.getTime()) || dateValue.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid date (expected YYYY-MM-DD): ${date}`);
  }

  const manifestXml = await readFile(join(projectRoot, 'mobile/android/AndroidManifest.xml'), 'utf8');
  const versionName = manifestXml.match(/android:versionName="([^"]+)"/)?.[1];
  const versionCode = Number(manifestXml.match(/android:versionCode="(\d+)"/)?.[1]);
  if (!versionName || !Number.isInteger(versionCode)) throw new Error('Android manifest version metadata is missing');
  if (versionName !== version) throw new Error(`Android manifest version ${versionName} does not match requested version ${version}`);

  const outputRoot = resolve(projectRoot, args.get('--output') ?? `交付包/山兔-${version}-${date}`);
  safeRelative(projectRoot, outputRoot);
  const allDefinitions = [
    { platform: '01-Android-APK', platformLabel: 'Android APK', mode: 'private', modeLabel: '自用版-含个人图源', version,
      source: `APK/Shantu-${version}-private.apk`, filename: `Shantu-${version}-private.apk`, format: 'apk' },
    { platform: '01-Android-APK', platformLabel: 'Android APK', mode: 'public', modeLabel: '公开版-不含个人图源', version,
      source: `APK/Shantu-${version}-public-standalone.apk`, filename: `Shantu-${version}-public-standalone.apk`, format: 'apk' },
    { platform: '02-Windows-EXE', platformLabel: 'Windows EXE', mode: 'private', modeLabel: '自用版-含个人图源', version,
      source: `EXE/Shantu-${version.replace(/-test$/, '')}-windows-x64-private.exe`, filename: `Shantu-${version.replace(/-test$/, '')}-windows-x64-private.exe`, format: 'exe' },
    { platform: '02-Windows-EXE', platformLabel: 'Windows EXE', mode: 'public', modeLabel: '公开版-不含个人图源', version,
      source: `EXE/Shantu-${version.replace(/-test$/, '')}-windows-x64-public.exe`, filename: `Shantu-${version.replace(/-test$/, '')}-windows-x64-public.exe`, format: 'exe' },
    { platform: '03-macOS-DMG', platformLabel: 'macOS DMG', mode: 'private', modeLabel: '自用版-含个人图源', version,
      source: `EXE/Shantu-${version}-macOS-private.dmg`, filename: `Shantu-${version}-macOS-private.dmg`, format: 'dmg' },
    { platform: '03-macOS-DMG', platformLabel: 'macOS DMG', mode: 'public', modeLabel: '公开版-不含个人图源', version,
      source: `EXE/Shantu-${version}-macOS-public.dmg`, filename: `Shantu-${version}-macOS-public.dmg`, format: 'dmg' },
  ];
  const definitions = privateOnly
    ? allDefinitions.filter((item) => item.mode === 'private')
    : allDefinitions;

  // Validate all selected sources before creating the destination or copying anything.
  const artifacts = [];
  for (const definition of definitions) {
    const sourcePath = resolve(projectRoot, definition.source);
    const sourceRelative = safeRelative(projectRoot, sourcePath);
    const sourceStat = await lstat(sourcePath).catch((error) => {
      if (error.code === 'ENOENT') throw new Error(`Required release artifact is missing: ${sourceRelative}`);
      throw error;
    });
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error(`Release artifact is not a regular file: ${sourceRelative}`);
    await assertFileMagic(sourcePath, definition.format);
    const hash = await sha256(sourcePath);
    await assertSidecar(sourcePath, hash);
    artifacts.push({
      ...definition,
      sourcePath,
      sourceRelative,
      filename: definition.filename,
      bytes: sourceStat.size,
      sha256: hash,
      path: privateOnly
        ? `${definition.platform}/${definition.filename}`
        : `${definition.platform}/${definition.modeLabel}/${definition.filename}`,
    });
  }

  const readme = makeReadme({ version, versionCode, date, artifacts, privateOnly });
  const checksumHeader = privateOnly
    ? '# privateOnly=true; artifactCount=3; privateTiandituMapSources=39\n'
    : '';
  const sums = `${checksumHeader}${artifacts.map((item) => `${item.sha256}  ${item.path}`).join('\n')}\n`;
  const manifest = `${JSON.stringify({
    product: '山兔',
    date,
    version,
    androidVersionCode: versionCode,
    privateOnly,
    artifactCount: artifacts.length,
    ...(privateOnly ? { privateTiandituMapSources: 39 } : {}),
    artifacts: artifacts.map(({ platformLabel, mode, version: itemVersion, bytes, sha256: hash, path, filename }) => ({
      platform: platformLabel, mode, version: itemVersion, filename, path, bytes, sha256: hash,
    })),
  }, null, 2)}\n`;
  const generatedFiles = [
    ['README-交付说明.md', readme],
    ['SHA256SUMS.txt', sums],
    ['manifest.json', manifest],
  ];

  // Refuse conflicting files and directory shapes before writing any package.
  const rootInfo = await lstat(outputRoot).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (rootInfo && !rootInfo.isDirectory()) throw new Error(`Output path is not a directory: ${outputRoot}`);
  let outputCursor = projectRoot;
  for (const segment of relative(projectRoot, outputRoot).split(sep).filter(Boolean)) {
    outputCursor = join(outputCursor, segment);
    const info = await lstat(outputCursor).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) {
      throw new Error(`Output directory path is occupied by a non-plain directory: ${outputCursor}`);
    }
  }
  for (const artifact of artifacts) {
    const target = join(outputRoot, artifact.path);
    const segments = relative(outputRoot, target).split(sep);
    let cursor = outputRoot;
    for (const segment of segments.slice(0, -1)) {
      cursor = join(cursor, segment);
      const info = await lstat(cursor).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error(`Destination directory path is occupied by a non-plain directory: ${cursor}`);
    }
    await ensureCompatibleExistingFile(target, artifact.sha256, artifact.bytes);
  }
  for (const [filename, content] of generatedFiles) {
    const target = join(outputRoot, filename);
    const existingInfo = await lstat(target).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existingInfo && (!existingInfo.isFile() || existingInfo.isSymbolicLink())) {
      throw new Error(`Generated file path is occupied by a non-plain file: ${target}`);
    }
    const existing = await readFile(target).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing && !existing.equals(Buffer.from(content, 'utf8'))) {
      throw new Error(`Refusing to overwrite a different generated file: ${target}`);
    }
  }

  await mkdir(outputRoot, { recursive: true });
  for (const artifact of artifacts) {
    const target = join(outputRoot, artifact.path);
    await mkdir(dirname(target), { recursive: true });
    const exists = await ensureCompatibleExistingFile(target, artifact.sha256, artifact.bytes);
    if (!exists) {
      try {
        await copyFile(artifact.sourcePath, target, fsConstants.COPYFILE_EXCL);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await ensureCompatibleExistingFile(target, artifact.sha256, artifact.bytes);
      }
    }
    const copiedHash = await sha256(target);
    if (copiedHash !== artifact.sha256) throw new Error(`Copied file SHA-256 mismatch: ${target}`);
  }
  for (const [filename, content] of generatedFiles) {
    const target = join(outputRoot, filename);
    try {
      await writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await readFile(target, 'utf8');
      if (existing !== content) throw new Error(`Refusing to overwrite a different generated file: ${target}`);
    }
  }

  console.log(`Release directory prepared: ${outputRoot}`);
  for (const artifact of artifacts) console.log(`${artifact.path}  ${artifact.bytes} bytes  SHA256 ${artifact.sha256}`);
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
