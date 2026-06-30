import { lstat, readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import ignore from "ignore";
import { blake3 } from "hash-wasm";
import { veloraManifestSchema, veloraValidationResultSchema, type VeloraManifest } from "./velora-site.js";

const blockedExtensions = new Set([
  ".exe",
  ".dll",
  ".bat",
  ".cmd",
  ".ps1",
  ".com",
  ".scr",
  ".msi",
  ".sys",
  ".so",
  ".dylib"
]);

const defaultIgnoreEntries = [
  ".git",
  ".github",
  "node_modules",
  "src",
  "tests",
  "coverage",
  ".env",
  ".env.*",
  "*.log",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "target"
];

export interface PackagedVeloraSite {
  contentCid: string;
  manifestHash: string;
  packageHash: string;
  packagePath: string;
  packageBytes: Uint8Array;
  filesJson: {
    files: Array<{ path: string; size: number; hash: string }>;
    totalFiles: number;
    totalSize: number;
  };
  manifest: VeloraManifest;
}

export async function loadVeloraManifest(siteRoot: string) {
  const manifestPath = join(siteRoot, "velora.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return veloraManifestSchema.parse(manifest);
}

export async function validateVeloraSite(siteRoot: string, options?: { maxSiteSizeMb?: number; maxSiteFileCount?: number }) {
  const manifest = await loadVeloraManifest(siteRoot);
  const ignoreRules = await buildIgnoreRules(siteRoot);
  const walk = await enumerateFiles(siteRoot, siteRoot, ignoreRules);
  const errors: string[] = [];
  const warnings: string[] = [];
  const includedFiles = walk.included;
  const excludedFiles = walk.excluded;
  let totalSize = 0;

  for (const symbolicLinkPath of walk.symbolicLinks) {
    errors.push(`Symbolic links are not allowed in Velora packages: ${symbolicLinkPath}`);
  }
  for (const excludedPath of excludedFiles) {
    const ext = extname(excludedPath).toLowerCase();
    if (excludedPath.startsWith(".env") || excludedPath.includes("/.env") || excludedPath.includes("\\.env")) {
      errors.push(`Sensitive environment file detected: ${excludedPath}`);
    }
    if (blockedExtensions.has(ext)) {
      errors.push(`Blocked executable extension detected: ${excludedPath}`);
    }
  }

  if (!includedFiles.includes(manifest.entryFile)) {
    errors.push(`Entry file "${manifest.entryFile}" is not included in the package.`);
  }

  for (const relativePath of includedFiles) {
    const absolutePath = join(siteRoot, relativePath);
    const info = await stat(absolutePath);
    totalSize += info.size;

    const ext = extname(relativePath).toLowerCase();
    if (blockedExtensions.has(ext)) {
      errors.push(`Blocked executable extension detected: ${relativePath}`);
    }

    if (relativePath.startsWith(".env") || relativePath.includes(`${sep}.env`)) {
      errors.push(`Sensitive environment file detected: ${relativePath}`);
    }

    if (/(private key|BEGIN [A-Z ]*PRIVATE KEY|api[_-]?key|token=)/i.test(await readTextSample(absolutePath))) {
      errors.push(`Potential secret material detected: ${relativePath}`);
    }

    const fileText = await maybeReadText(absolutePath);
    if (fileText) {
      if (/javascript:/i.test(fileText)) {
        errors.push(`Blocked javascript: URL in ${relativePath}`);
      }
      if (/file:\/\//i.test(fileText)) {
        errors.push(`Blocked file:// URL in ${relativePath}`);
      }
      if (/https?:\/\/(?:localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(fileText)) {
        errors.push(`Blocked localhost/private network reference in ${relativePath}`);
      }
      for (const origin of extractExternalOrigins(fileText)) {
        if (isLocalOrPrivateOrigin(origin)) {
          continue;
        }
        if (!manifest.permissions.externalNetwork) {
          errors.push(`External origin ${origin} is not allowed without externalNetwork permission: ${relativePath}`);
          continue;
        }
        if (!manifest.allowedExternalOrigins.includes(origin)) {
          errors.push(`External origin ${origin} is not declared in allowedExternalOrigins: ${relativePath}`);
        }
      }
    }
  }

  const maxSiteSizeMb = options?.maxSiteSizeMb ?? 250;
  const maxSiteFileCount = options?.maxSiteFileCount ?? 5000;
  if (includedFiles.length > maxSiteFileCount) {
    errors.push(`Too many files: ${includedFiles.length} > ${maxSiteFileCount}`);
  }
  if (totalSize > maxSiteSizeMb * 1024 * 1024) {
    errors.push(`Site package too large: ${totalSize} bytes > ${maxSiteSizeMb} MB`);
  }
  if (manifest.permissions.externalNetwork && manifest.allowedExternalOrigins.length === 0) {
    warnings.push("externalNetwork permission is enabled without allowedExternalOrigins entries.");
  }

  return veloraValidationResultSchema.parse({
    valid: errors.length === 0,
    errors,
    warnings,
    excludedFiles,
    includedFiles,
    totalFiles: includedFiles.length,
    totalSize,
    requestedPermissions: manifest.permissions
  });
}

export async function packageVeloraSite(siteRoot: string, outputFile: string) {
  const validation = await validateVeloraSite(siteRoot);
  if (!validation.valid) {
    throw new Error(`Velora site validation failed: ${validation.errors.join("; ")}`);
  }

  const manifest = await loadVeloraManifest(siteRoot);
  const fileEntries: Record<string, Uint8Array> = {};
  const filesJson = {
    files: [] as Array<{ path: string; size: number; hash: string }>,
    totalFiles: validation.totalFiles,
    totalSize: validation.totalSize
  };

  for (const relativePath of [...validation.includedFiles].sort()) {
    const absolutePath = join(siteRoot, relativePath);
    const bytes = new Uint8Array(await readFile(absolutePath));
    const normalized = normalizeToPosix(relativePath);
    fileEntries[`content/${normalized}`] = bytes;
    filesJson.files.push({
      path: normalized,
      size: bytes.byteLength,
      hash: `blake3:${await blake3(bytes)}`
    });
  }

  const manifestJson = canonicalJson(manifest);
  const filesJsonText = canonicalJson(filesJson);
  const buildInfo = canonicalJson({
    builtAt: "1970-01-01T00:00:00.000Z",
    generator: "velora-packager",
    format: "vsite"
  });
  const manifestHash = `blake3:${await blake3(manifestJson)}`;

  fileEntries["manifest.json"] = strToU8(manifestJson);
  fileEntries["files.json"] = strToU8(filesJsonText);
  fileEntries["metadata/build-info.json"] = strToU8(buildInfo);
  fileEntries["signature.json"] = strToU8(
    canonicalJson({
      signatureVersion: 1,
      zoneId: manifest.address,
      address: manifest.address,
      contentCid: "",
      manifestHash,
      packageHash: "",
      releaseVersion: manifest.version,
      publisherPublicKey: "",
      createdAt: "1970-01-01T00:00:00.000Z",
      nonce: ""
    })
  );

  const zipped = zipSync(fileEntries, { level: 9 });
  const packageHash = `blake3:${await blake3(zipped)}`;
  const contentCid = `blake3:${await blake3(`${manifest.address}:${packageHash}`)}`;

  fileEntries["signature.json"] = strToU8(
    canonicalJson({
      signatureVersion: 1,
      zoneId: manifest.address,
      address: manifest.address,
      contentCid,
      manifestHash,
      packageHash,
      releaseVersion: manifest.version,
      publisherPublicKey: "",
      createdAt: "1970-01-01T00:00:00.000Z",
      nonce: "",
      signature: ""
    })
  );

  const finalZip = zipSync(fileEntries, { level: 9 });
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, finalZip);

  return {
    contentCid,
    manifestHash,
    packageHash: `blake3:${await blake3(finalZip)}`,
    packagePath: outputFile,
    packageBytes: finalZip,
    filesJson,
    manifest
  } satisfies PackagedVeloraSite;
}

export async function inspectVsite(packagePath: string) {
  const zipped = unzipSync(new Uint8Array(await readFile(packagePath)));
  const manifest = veloraManifestSchema.parse(JSON.parse(strFromU8(zipped["manifest.json"])));
  const filesJson = JSON.parse(strFromU8(zipped["files.json"]));
  const signatureJson = JSON.parse(strFromU8(zipped["signature.json"]));
  return {
    manifest,
    filesJson,
    signatureJson
  };
}

async function buildIgnoreRules(siteRoot: string) {
  const engine = ignore();
  engine.add(defaultIgnoreEntries);
  const ignorePath = join(siteRoot, ".veloraignore");
  try {
    engine.add(await readFile(ignorePath, "utf8"));
  } catch {
    engine.add("");
  }
  return engine;
}

async function enumerateFiles(root: string, current: string, rules: ReturnType<typeof ignore>) {
  const entries = await readdir(current, { withFileTypes: true });
  const included: string[] = [];
  const excluded: string[] = [];
  const symbolicLinks: string[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolutePath = join(current, entry.name);
    const relativePath = normalizeToPosix(relative(root, absolutePath));
    if (!relativePath) {
      continue;
    }
    if (rules.ignores(relativePath)) {
      excluded.push(relativePath);
      continue;
    }
    const absoluteRoot = resolve(root);
    const resolvedAbsolutePath = resolve(absolutePath);
    if (resolvedAbsolutePath !== absolutePath || !resolvedAbsolutePath.startsWith(absoluteRoot)) {
      excluded.push(relativePath);
      continue;
    }
    if (relativePath.includes("..") || resolve(root, relativePath) !== absolutePath) {
      excluded.push(relativePath);
      continue;
    }
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink()) {
      symbolicLinks.push(relativePath);
      excluded.push(relativePath);
      continue;
    }
    if (entry.isDirectory()) {
      const nested = await enumerateFiles(root, absolutePath, rules);
      included.push(...nested.included);
      excluded.push(...nested.excluded);
      symbolicLinks.push(...nested.symbolicLinks);
      continue;
    }
    included.push(relativePath);
  }

  return { included, excluded, symbolicLinks };
}

function normalizeToPosix(value: string) {
  return normalize(value).replace(/\\/g, "/");
}

function canonicalJson(value: unknown) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortJson(child)])
    );
  }
  return value;
}

async function readTextSample(filePath: string) {
  const text = await maybeReadText(filePath);
  return text.slice(0, 4096);
}

async function maybeReadText(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function extractExternalOrigins(fileText: string) {
  const origins = new Set<string>();
  for (const match of fileText.matchAll(/https?:\/\/[^\s"'`)<]+/gi)) {
    try {
      origins.add(new URL(match[0]).origin);
    } catch {
      // ignore malformed urls already caught elsewhere
    }
  }
  return [...origins];
}

function isLocalOrPrivateOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return /^(localhost|127\.0\.0\.1)$/i.test(url.hostname)
      || /^10\./.test(url.hostname)
      || /^192\.168\./.test(url.hostname)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname);
  } catch {
    return false;
  }
}
