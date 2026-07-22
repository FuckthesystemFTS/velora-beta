import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import pg from "pg";

const { Pool } = pg;
const root = resolve(process.env.VELORA_PUBLISHED_SITES_PATH ?? "published-sites");
const databaseUrl = process.env.DATABASE_URL;

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

async function siteSize(dir) {
  const files = await readdir(dir, { withFileTypes: true });
  let size = 0;
  let count = 0;
  for (const file of files) {
    if (!file.isFile()) continue;
    const info = await stat(join(dir, file.name));
    size += info.size;
    count += 1;
  }
  return { size, count };
}

const catalog = await readJson(join(root, "velora-category-sites.json"));
const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
const imported = [];

try {
  const ownerId = randomUUID();
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO users (id, username, password_hash)
     VALUES ($1,'velora-category-sites-system',$2)
     ON CONFLICT (username) DO NOTHING`,
    [ownerId, hash("velora-category-sites-system")]
  );
  const owner = await client.query("SELECT id FROM users WHERE username = 'velora-category-sites-system'");
  const effectiveOwnerId = owner.rows[0].id;

  for (const site of catalog.sites) {
    const dir = join(root, site.address);
    const manifest = await readJson(join(dir, "velora.json"));
    const html = await readFile(join(dir, "index.html"), "utf8");
    const info = await siteSize(dir);
    const sourceHash = hash(`${JSON.stringify(manifest)}\n${html}`);
    const contentCid = `velora:zone:${site.address}:${sourceHash.slice(0, 18)}`;
    const version = manifest.version ?? "1.0.0";
    const zoneId = randomUUID();
    const releaseId = randomUUID();

    await client.query(
      `INSERT INTO navigation_zones (id, address, category, slug, owner_user_id, owner_public_key, status, record_payload, platform_signature)
       VALUES ($1,$2,$3,$4,$5,'velora-category-public-key','ACTIVE',$6,$7)
       ON CONFLICT (address) DO UPDATE SET
         category = EXCLUDED.category,
         slug = EXCLUDED.slug,
         status = 'ACTIVE',
         record_payload = EXCLUDED.record_payload,
         updated_at = NOW()`,
      [zoneId, manifest.address, manifest.category, manifest.address.split(".").slice(1).join("-"), effectiveOwnerId, JSON.stringify({ source: "VELORA_CATEGORY_SITE", version, title: manifest.title, sourceHash }), hash(`zone:${manifest.address}:${sourceHash}`)]
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
      [randomUUID(), contentCid, sourceHash, dir, info.size, info.count]
    );

    await client.query(
      `INSERT INTO site_releases (
         id, zone_id, version, content_cid, manifest_json, manifest_hash, package_hash,
         publisher_public_key, publisher_signature, total_size, file_count, status, published_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,'velora-category-public-key',$8,$9,$10,'ACTIVE',NOW())
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
        info.count
      ]
    );
    const release = await client.query("SELECT id FROM site_releases WHERE zone_id = $1 AND version = $2", [effectiveZoneId, version]);
    const effectiveReleaseId = release.rows[0].id;

    await client.query("UPDATE navigation_zones SET current_release_id = $1 WHERE id = $2", [effectiveReleaseId, effectiveZoneId]);
    await client.query("DELETE FROM search_documents WHERE address = $1", [manifest.address]);
    await client.query(
      `INSERT INTO search_documents (
        id, zone_id, release_id, address, category, slug, title, description, keywords,
        languages, headings, searchable_text, publisher, age_rating, family_safe,
        content_cid, release_version, trust_level, availability
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Velora', $13, $14, $15, $16, 3, 100)`,
      [
        randomUUID(),
        effectiveZoneId,
        effectiveReleaseId,
        manifest.address,
        manifest.category,
        manifest.address.split(".").slice(1).join("-"),
        manifest.title,
        manifest.description,
        JSON.stringify(manifest.keywords ?? []),
        JSON.stringify(manifest.languages ?? ["it"]),
        JSON.stringify([manifest.title, manifest.category]),
        `${manifest.title}\n${manifest.description}\n${html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 6000)}`,
        manifest.ageRating ?? "EVERYONE",
        manifest.familySafe !== false,
        contentCid,
        version
      ]
    );
    imported.push({ address: manifest.address, category: manifest.category, title: manifest.title });
  }

  await client.query("COMMIT");
  console.log(JSON.stringify({ ok: true, totalSites: imported.length, imported }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
