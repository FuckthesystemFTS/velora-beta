import { randomUUID, createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import pg from "pg";

const { Pool } = pg;
const root = resolve(process.env.VELORA_SEARCH_PACKS_PATH ?? "oceano/velora-search-packs");
const databaseUrl = process.env.DATABASE_URL;
const maxPerPack = Number(process.env.VELORA_SEARCH_PACK_MAX_ENTRIES ?? 2500);

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function normalizeEntries(raw, manifest) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .slice(0, Number.isFinite(maxPerPack) && maxPerPack > 0 ? maxPerPack : 2500)
    .map((entry) => ({
      address: String(entry.address),
      slug: String(entry.slug),
      title: String(entry.title),
      description: String(entry.description),
      keywords: JSON.stringify(entry.keywords ?? []),
      languages: "it",
      headings: JSON.stringify(entry.headings ?? [entry.title]),
      searchableText: String(entry.body ?? entry.description),
      publisher: String(entry.publisher ?? `Velora ${manifest.title}`),
      ageRating: String(entry.ageRating ?? "EVERYONE"),
      familySafe: entry.familySafe !== false,
      trustLevel: Number(entry.trustLevel ?? 2),
      availability: Number(entry.availability ?? 98)
    }));
}

const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
const imported = [];

try {
  const catalog = await readJson(join(root, "catalog.json"));
  const ownerId = randomUUID();
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO users (id, username, password_hash)
     VALUES ($1,'velora-search-system',$2)
     ON CONFLICT (username) DO NOTHING`,
    [ownerId, hash("velora-search-system")]
  );
  const owner = await client.query("SELECT id FROM users WHERE username = 'velora-search-system'");
  const effectiveOwnerId = owner.rows[0].id;

  for (const pack of catalog.packs) {
    const dir = join(root, pack.slug);
    const manifest = await readJson(join(dir, "manifest.json"));
    const raw = await readFile(join(dir, "entries.jsonl"), "utf8");
    const info = await stat(join(dir, "entries.jsonl"));
    const entries = normalizeEntries(raw, manifest);
    if (!entries.length) throw new Error(`No entries for ${pack.slug}`);
    const sourceHash = hash(raw);
    const contentCid = `velora:${pack.slug}:${sourceHash.slice(0, 24)}`;
    const version = String(manifest.generatedAt ?? "2026-07-22").slice(0, 10);
    const zoneId = randomUUID();
    const releaseId = randomUUID();

    await client.query(
      `INSERT INTO navigation_zones (id, address, category, slug, owner_user_id, owner_public_key, status, record_payload, platform_signature)
       VALUES ($1,$2,$3,$4,$5,'velora-search-public-key','ACTIVE',$6,$7)
       ON CONFLICT (address) DO UPDATE SET
         category = EXCLUDED.category,
         slug = EXCLUDED.slug,
         status = 'ACTIVE',
         record_payload = EXCLUDED.record_payload,
         updated_at = NOW()`,
      [zoneId, manifest.address, manifest.category, pack.slug, effectiveOwnerId, JSON.stringify({ source: "VELORA_SEARCH_PACK", version, entries: entries.length, sourceHash }), hash(`zone:${manifest.address}:${sourceHash}`)]
    );
    const zone = await client.query("SELECT id FROM navigation_zones WHERE address = $1", [manifest.address]);
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
      [randomUUID(), contentCid, sourceHash, dir, info.size, entries.length]
    );

    await client.query(
      `INSERT INTO site_releases (
         id, zone_id, version, content_cid, manifest_json, manifest_hash, package_hash,
         publisher_public_key, publisher_signature, total_size, file_count, status, published_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,'velora-search-public-key',$8,$9,$10,'ACTIVE',NOW())
       ON CONFLICT (zone_id, version) DO UPDATE SET
         content_cid = EXCLUDED.content_cid,
         manifest_json = EXCLUDED.manifest_json,
         manifest_hash = EXCLUDED.manifest_hash,
         package_hash = EXCLUDED.package_hash,
         total_size = EXCLUDED.total_size,
         file_count = EXCLUDED.file_count,
         status = 'ACTIVE',
         published_at = NOW()`,
      [
        releaseId,
        effectiveZoneId,
        version,
        contentCid,
        JSON.stringify(manifest),
        hash(`manifest:${contentCid}`),
        sourceHash,
        hash(`signature:${contentCid}`),
        info.size,
        entries.length
      ]
    );
    const release = await client.query("SELECT id FROM site_releases WHERE zone_id = $1 AND version = $2", [effectiveZoneId, version]);
    const effectiveReleaseId = release.rows[0].id;

    await client.query("UPDATE navigation_zones SET current_release_id = $1 WHERE id = $2", [effectiveReleaseId, effectiveZoneId]);
    await client.query("DELETE FROM search_documents WHERE zone_id = $1 AND category = $2", [effectiveZoneId, manifest.category]);

    const batchSize = 100;
    for (let offset = 0; offset < entries.length; offset += batchSize) {
      const batch = entries.slice(offset, offset + batchSize);
      const params = [];
      const values = batch.map((entry, index) => {
        const base = index * 19;
        params.push(
          randomUUID(),
          effectiveZoneId,
          effectiveReleaseId,
          entry.address,
          manifest.category,
          entry.slug,
          entry.title,
          entry.description,
          entry.keywords,
          entry.languages,
          entry.headings,
          entry.searchableText,
          entry.publisher,
          entry.ageRating,
          entry.familySafe,
          contentCid,
          version,
          entry.trustLevel,
          entry.availability
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16},$${base + 17},$${base + 18},$${base + 19})`;
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
    imported.push({ address: manifest.address, category: manifest.category, entries: entries.length, contentCid });
  }

  await client.query("COMMIT");
  const totalEntries = imported.reduce((sum, pack) => sum + pack.entries, 0);
  console.log(JSON.stringify({ ok: true, packs: imported.length, totalEntries, imported }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
