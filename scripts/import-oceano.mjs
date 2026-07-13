import { randomUUID, createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const { Pool } = pg;

const sourcePath = resolve(process.env.OCEANO_SOURCE_PATH ?? "oceano/OCEANO_2025-10-28.txt");
const databaseUrl = process.env.DATABASE_URL;
const maxEntries = Number(process.env.OCEANO_MAX_ENTRIES ?? 1200);

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanText(value) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/Ã¨/g, "e")
    .replace(/Ã©/g, "e")
    .replace(/Ã /g, "a")
    .replace(/Ã¹/g, "u")
    .replace(/Ã²/g, "o")
    .replace(/Ã¬/g, "i")
    .replace(/â€™/g, "'")
    .replace(/â€œ|â€|Â«|Â»/g, '"')
    .replace(/â€“|â€”/g, "-")
    .replace(/â€¢/g, "-")
    .replace(/Â/g, "")
    .trim();
}

function parseEntries(raw) {
  const text = cleanText(raw);
  const pattern = /^(\d+)\s+T{8,}\s*$/gm;
  const markers = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    markers.push({ number: Number(match[1]), start: match.index, end: pattern.lastIndex });
  }
  const entries = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const next = markers[index + 1];
    const body = text.slice(marker.end, next?.start ?? text.length).trim();
    if (!body || body.length < 20) {
      continue;
    }
    const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
    const first = lines[0] ?? `Voce ${marker.number}`;
    const title = first.length > 90 ? `Oceano ${marker.number}` : first;
    const description = lines.slice(0, 4).join(" ").replace(/\s+/g, " ").slice(0, 260);
    entries.push({
      number: marker.number,
      address: `oceano.${marker.number}`,
      slug: `voce-${marker.number}`,
      title,
      description,
      body: body.slice(0, 12000)
    });
  }
  return entries;
}

const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();

try {
  const raw = await readFile(sourcePath, "utf8");
  const sourceInfo = await stat(sourcePath);
  const entries = parseEntries(raw).slice(0, Number.isFinite(maxEntries) && maxEntries > 0 ? maxEntries : 1200);
  if (!entries.length) {
    throw new Error("No Oceano entries parsed");
  }

  const sourceHash = hash(raw);
  const contentCid = `velora:oceano:${sourceHash.slice(0, 24)}`;
  const zoneAddress = "oceano.velora";
  const version = "2025-10-28";
  const ownerId = randomUUID();
  const zoneId = randomUUID();
  const releaseId = randomUUID();

  await client.query("BEGIN");
  await client.query(
    `INSERT INTO users (id, username, password_hash)
     VALUES ($1,'velora-oceano-system',$2)
     ON CONFLICT (username) DO NOTHING`,
    [ownerId, hash("velora-oceano-system")]
  );
  const owner = await client.query("SELECT id FROM users WHERE username = 'velora-oceano-system'");
  const effectiveOwnerId = owner.rows[0].id;

  await client.query(
    `INSERT INTO navigation_zones (id, address, category, slug, owner_user_id, owner_public_key, status, record_payload, platform_signature)
     VALUES ($1,$2,'CONOSCENZA','oceano',$3,'velora-oceano-public-key','ACTIVE',$4,$5)
     ON CONFLICT (address) DO UPDATE SET
       category = EXCLUDED.category,
       slug = EXCLUDED.slug,
       status = 'ACTIVE',
       record_payload = EXCLUDED.record_payload,
       updated_at = NOW()
     RETURNING id`,
    [zoneId, zoneAddress, effectiveOwnerId, JSON.stringify({ source: "OCEANO", version, entries: entries.length, sourceHash }), hash(`zone:${zoneAddress}:${sourceHash}`)]
  );
  const zone = await client.query("SELECT id FROM navigation_zones WHERE address = $1", [zoneAddress]);
  const effectiveZoneId = zone.rows[0].id;

  await client.query(
    `INSERT INTO content_objects (id, content_cid, package_hash, local_path, total_size, file_count, pinned)
     VALUES ($1,$2,$3,$4,$5,$6,true)
     ON CONFLICT (content_cid) DO UPDATE SET
       package_hash = EXCLUDED.package_hash,
       local_path = EXCLUDED.local_path,
       total_size = EXCLUDED.total_size,
       file_count = EXCLUDED.file_count,
       pinned = true`,
    [randomUUID(), contentCid, sourceHash, sourcePath, sourceInfo.size, entries.length]
  );

  await client.query(
    `INSERT INTO site_releases (
       id, zone_id, version, content_cid, manifest_json, manifest_hash, package_hash,
       publisher_public_key, publisher_signature, total_size, file_count, status, published_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,'velora-oceano-public-key',$8,$9,$10,'ACTIVE',NOW())
     ON CONFLICT (zone_id, version) DO UPDATE SET
       content_cid = EXCLUDED.content_cid,
       manifest_json = EXCLUDED.manifest_json,
       manifest_hash = EXCLUDED.manifest_hash,
       package_hash = EXCLUDED.package_hash,
       total_size = EXCLUDED.total_size,
       file_count = EXCLUDED.file_count,
       status = 'ACTIVE',
       published_at = NOW()
     RETURNING id`,
    [
      releaseId,
      effectiveZoneId,
      version,
      contentCid,
      JSON.stringify({ address: zoneAddress, title: "Oceano", source: "OCEANO_2025-10-28.txt", entries: entries.length }),
      hash(`manifest:${contentCid}`),
      sourceHash,
      hash(`signature:${contentCid}`),
      sourceInfo.size,
      entries.length
    ]
  );
  const release = await client.query("SELECT id FROM site_releases WHERE zone_id = $1 AND version = $2", [effectiveZoneId, version]);
  const effectiveReleaseId = release.rows[0].id;

  await client.query("UPDATE navigation_zones SET current_release_id = $1 WHERE id = $2", [effectiveReleaseId, effectiveZoneId]);
  await client.query("DELETE FROM search_documents WHERE zone_id = $1 AND category = 'OCEANO'", [effectiveZoneId]);

  const batchSize = 100;
  for (let offset = 0; offset < entries.length; offset += batchSize) {
    const batch = entries.slice(offset, offset + batchSize);
    const params = [];
    const values = batch.map((entry, index) => {
      const base = index * 12;
      params.push(
        randomUUID(),
        effectiveZoneId,
        effectiveReleaseId,
        entry.address,
        entry.slug,
        entry.title,
        entry.description,
        `oceano conoscenza archivio voce-${entry.number}`,
        entry.title,
        entry.body,
        contentCid,
        version
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},'OCEANO',$${base + 5},$${base + 6},$${base + 7},$${base + 8},'it',$${base + 9},$${base + 10},'Velora Oceano','13+',true,$${base + 11},$${base + 12},1,95)`;
    }).join(",");
    await client.query(
      `INSERT INTO search_documents (
        id, zone_id, release_id, address, category, slug, title, description, keywords,
        languages, headings, searchable_text, publisher, age_rating, family_safe,
        content_cid, release_version, trust_level, availability
      )
      VALUES ${values}`,
      params
    );
  }

  await client.query("COMMIT");
  console.log(JSON.stringify({ ok: true, entries: entries.length, contentCid, sourceHash, zone: zoneAddress }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
