#!/usr/bin/env node
/**
 * Packs a built Chrome MV3 extension zip (.output/*.zip) into a signed CRX3 (.crx) package.
 *
 * Key resolution order:
 * 1. CLI argument: `node scripts/pack-crx.mjs --key path/to/key.pem`
 * 2. Environment variable `CRX_PRIVATE_KEY` (raw PEM or base64-encoded PEM)
 * 3. Local `private-key.pem` or `.crx-key.pem` in project root (if present)
 * 4. Ephemeral 2048-bit RSA key (generated on the fly if no key is configured)
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function encodeVarint(num) {
  const bytes = [];
  let n = num >>> 0;
  while (n >= 0x80) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return Buffer.from(bytes);
}

export function encodeLengthDelimited(fieldNumber, data) {
  const tag = encodeVarint((fieldNumber << 3) | 2);
  const len = encodeVarint(data.length);
  return Buffer.concat([tag, len, data]);
}

export function computeCrxId(publicKeySpkiDer) {
  return createHash("sha256").update(publicKeySpkiDer).digest().subarray(0, 16);
}

export function formatExtensionId(crxIdBytes) {
  let out = "";
  for (const byte of crxIdBytes) {
    out += String.fromCharCode(97 + ((byte >> 4) & 0x0f));
    out += String.fromCharCode(97 + (byte & 0x0f));
  }
  return out;
}

/**
 * Creates a CRX3 buffer from a ZIP buffer and a PEM private key string (or KeyObject).
 */
export function buildCrx3Buffer(zipBuffer, privateKeyInput) {
  const privKey = typeof privateKeyInput === "string" || Buffer.isBuffer(privateKeyInput)
    ? createPrivateKey(privateKeyInput)
    : privateKeyInput;
  const pubKeyDer = createPublicKey(privKey).export({ type: "spki", format: "der" });

  const crxId = computeCrxId(pubKeyDer);
  // SignedData proto: field 1 (crx_id, bytes)
  const signedHeaderData = encodeLengthDelimited(1, crxId);

  const prefix = Buffer.from("CRX3 SignedData\x00", "utf8");
  const signedLen = Buffer.alloc(4);
  signedLen.writeUInt32LE(signedHeaderData.length, 0);

  const toSign = Buffer.concat([prefix, signedLen, signedHeaderData, zipBuffer]);
  const signature = sign("sha256", toSign, privKey);

  // AsymmetricKeyProof proto: field 1 (public_key), field 2 (signature)
  const rsaProof = Buffer.concat([
    encodeLengthDelimited(1, pubKeyDer),
    encodeLengthDelimited(2, signature),
  ]);

  // CrxFileHeader proto: field 2 (sha256_with_rsa), field 10000 (signed_header_data)
  const header = Buffer.concat([
    encodeLengthDelimited(2, rsaProof),
    encodeLengthDelimited(10000, signedHeaderData),
  ]);

  const magic = Buffer.from("Cr24", "utf8");
  const version = Buffer.alloc(4);
  version.writeUInt32LE(3, 0);
  const headerLen = Buffer.alloc(4);
  headerLen.writeUInt32LE(header.length, 0);

  return {
    crxBuffer: Buffer.concat([magic, version, headerLen, header, zipBuffer]),
    extensionId: formatExtensionId(crxId),
    publicKeyDer: pubKeyDer,
  };
}

function resolvePrivateKey(args) {
  const keyArgIdx = args.indexOf("--key");
  if (keyArgIdx !== -1 && args[keyArgIdx + 1]) {
    const keyPath = resolve(args[keyArgIdx + 1]);
    return { key: readFileSync(keyPath, "utf8"), source: keyPath };
  }

  const envKey = process.env.CRX_PRIVATE_KEY?.trim();
  if (envKey) {
    const pem = envKey.includes("-----BEGIN")
      ? envKey
      : Buffer.from(envKey, "base64").toString("utf8");
    return { key: pem, source: "env:CRX_PRIVATE_KEY" };
  }

  for (const candidate of ["private-key.pem", ".crx-key.pem"]) {
    const p = join(ROOT, candidate);
    if (existsSync(p)) {
      return { key: readFileSync(p, "utf8"), source: candidate };
    }
  }

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { key: privateKey, source: "ephemeral (generated RSA-2048)" };
}

function findLatestZip(outDir) {
  if (!existsSync(outDir)) return null;
  const zips = readdirSync(outDir)
    .filter((f) => f.endsWith(".zip") && f.includes("chrome"))
    .sort();
  if (!zips.length) {
    const anyZips = readdirSync(outDir).filter((f) => f.endsWith(".zip")).sort();
    return anyZips.length ? join(outDir, anyZips[anyZips.length - 1]) : null;
  }
  return join(outDir, zips[zips.length - 1]);
}

function main() {
  const args = process.argv.slice(2);
  const outDir = resolve(ROOT, ".output");
  const zipArg = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--key" && args[i - 1] !== "--out");
  const zipPath = zipArg ? resolve(zipArg) : findLatestZip(outDir);

  if (!zipPath || !existsSync(zipPath)) {
    console.error("✗ No .zip archive found in .output/. Run `npm run zip` first.");
    process.exit(1);
  }

  const outArgIdx = args.indexOf("--out");
  const crxPath = outArgIdx !== -1 && args[outArgIdx + 1]
    ? resolve(args[outArgIdx + 1])
    : zipPath.replace(/\.zip$/i, ".crx");

  const { key, source } = resolvePrivateKey(args);
  const zipBuffer = readFileSync(zipPath);
  const { crxBuffer, extensionId } = buildCrx3Buffer(zipBuffer, key);

  writeFileSync(crxPath, crxBuffer);
  console.log(`✓ Packed CRX3: ${crxPath} (${(crxBuffer.length / 1024).toFixed(1)} kB)`);
  console.log(`  Extension ID: ${extensionId}`);
  console.log(`  Signing key : ${source}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
