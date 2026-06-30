use base64::Engine;
use rand::RngCore;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, thiserror::Error)]
enum VeloraError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("app data directory unavailable")]
    AppDataUnavailable,
    #[error("site not found for address: {0}")]
    SiteNotFound(String),
}

impl serde::Serialize for VeloraError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Serialize)]
struct NodeIdentity {
    peer_id: String,
    public_key: String,
}

#[derive(Deserialize)]
struct EnrollRequest {
    api_base_url: String,
    user_id: String,
    device_name: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct DeviceEnrollPayload {
    #[serde(rename = "peerId")]
    peer_id: String,
    #[serde(rename = "publicKey")]
    public_key: String,
    #[serde(rename = "deviceName")]
    device_name: String,
}

#[derive(Serialize, Deserialize)]
struct CachedChunk {
    #[serde(rename = "chunkIndex")]
    chunk_index: i64,
    #[serde(rename = "chunkHash")]
    chunk_hash: String,
    #[serde(rename = "chunkSize")]
    chunk_size: i64,
    #[serde(rename = "localPath")]
    local_path: String,
}

#[derive(Serialize, Deserialize)]
struct CachedReleaseInput {
    address: String,
    version: String,
    #[serde(rename = "releaseId")]
    release_id: Option<String>,
    #[serde(rename = "contentCid")]
    content_cid: String,
    #[serde(rename = "manifestJson")]
    manifest_json: serde_json::Value,
    #[serde(rename = "publisherPublicKey")]
    publisher_public_key: String,
    #[serde(rename = "publisherSignature")]
    publisher_signature: String,
    #[serde(rename = "packagePath")]
    package_path: String,
    #[serde(rename = "packageHash")]
    package_hash: String,
    #[serde(rename = "totalSize")]
    total_size: i64,
    #[serde(rename = "fileCount")]
    file_count: i64,
    status: String,
    chunks: Vec<CachedChunk>,
}

#[derive(Serialize, Deserialize)]
struct SearchDocumentInput {
    address: String,
    category: String,
    slug: String,
    title: String,
    description: String,
    #[serde(rename = "content_cid")]
    content_cid: String,
    #[serde(rename = "release_version")]
    release_version: String,
    availability: i64,
}

#[derive(Deserialize)]
struct LoadSiteRequest {
    address: String,
    #[serde(rename = "sitePath")]
    site_path: Option<String>,
}

#[derive(Serialize)]
struct LoadedSiteDocument {
    address: String,
    title: String,
    html: String,
    source: String,
}

#[tauri::command]
fn init_local_store(app: AppHandle) -> Result<String, VeloraError> {
    let db_path = local_db_path(&app)?;
    let conn = Connection::open(&db_path)?;
    conn.execute_batch(include_str!("../schema/local.sql"))?;
    Ok(db_path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_or_create_node_identity(app: AppHandle) -> Result<NodeIdentity, VeloraError> {
    let db_path = local_db_path(&app)?;
    let conn = Connection::open(db_path)?;
    conn.execute_batch(include_str!("../schema/local.sql"))?;

    let existing = conn.query_row(
        "SELECT peer_id, public_key FROM node_identity WHERE id = 1",
        [],
        |row| {
            Ok(NodeIdentity {
                peer_id: row.get(0)?,
                public_key: row.get(1)?,
            })
        },
    );

    if let Ok(identity) = existing {
        return Ok(identity);
    }

    let mut private_key = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut private_key);
    let public_key = blake3::hash(&private_key).to_hex().to_string();
    let peer_id = format!("velora-{}", &blake3::hash(public_key.as_bytes()).to_hex()[..24]);
    let private_key_sealed = base64::engine::general_purpose::STANDARD.encode(private_key);

    conn.execute(
        "INSERT INTO node_identity (id, peer_id, public_key, private_key_sealed) VALUES (1, ?1, ?2, ?3)",
        params![peer_id, public_key, private_key_sealed],
    )?;

    Ok(NodeIdentity { peer_id, public_key })
}

#[tauri::command]
async fn enroll_device(app: AppHandle, input: EnrollRequest) -> Result<serde_json::Value, VeloraError> {
    let identity = get_or_create_node_identity(app)?;
    let payload = DeviceEnrollPayload {
        peer_id: identity.peer_id,
        public_key: identity.public_key,
        device_name: input.device_name.unwrap_or_else(|| "Velora beta desktop".to_string()),
    };

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/api/v1/devices/enroll", input.api_base_url.trim_end_matches('/')))
        .header("x-user-id", input.user_id)
        .json(&payload)
        .send()
        .await?
        .error_for_status()?;

    Ok(response.json::<serde_json::Value>().await?)
}

#[tauri::command]
fn cache_packaged_release(app: AppHandle, input: CachedReleaseInput) -> Result<serde_json::Value, VeloraError> {
    let db_path = local_db_path(&app)?;
    let conn = Connection::open(db_path)?;
    conn.execute_batch(include_str!("../schema/local.sql"))?;

    conn.execute(
        "INSERT INTO cached_releases (
          address, release_id, version, content_cid, manifest_json, publisher_public_key,
          publisher_signature, package_path, package_hash, total_size, file_count, status, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, CURRENT_TIMESTAMP)
        ON CONFLICT(address, version) DO UPDATE SET
          release_id = excluded.release_id,
          content_cid = excluded.content_cid,
          manifest_json = excluded.manifest_json,
          publisher_public_key = excluded.publisher_public_key,
          publisher_signature = excluded.publisher_signature,
          package_path = excluded.package_path,
          package_hash = excluded.package_hash,
          total_size = excluded.total_size,
          file_count = excluded.file_count,
          status = excluded.status,
          updated_at = CURRENT_TIMESTAMP",
        params![
            input.address,
            input.release_id,
            input.version,
            input.content_cid,
            input.manifest_json.to_string(),
            input.publisher_public_key,
            input.publisher_signature,
            input.package_path,
            input.package_hash,
            input.total_size,
            input.file_count,
            input.status
        ],
    )?;

    for chunk in input.chunks {
        conn.execute(
            "INSERT INTO cached_content_chunks (
              content_cid, chunk_index, chunk_hash, chunk_size, local_path, verified, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(content_cid, chunk_index) DO UPDATE SET
              chunk_hash = excluded.chunk_hash,
              chunk_size = excluded.chunk_size,
              local_path = excluded.local_path,
              verified = 1,
              updated_at = CURRENT_TIMESTAMP",
            params![
                input.content_cid,
                chunk.chunk_index,
                chunk.chunk_hash,
                chunk.chunk_size,
                chunk.local_path
            ],
        )?;
    }

    Ok(json!({ "ok": true, "address": input.address, "version": input.version }))
}

#[tauri::command]
fn cache_search_results(app: AppHandle, results: Vec<SearchDocumentInput>) -> Result<serde_json::Value, VeloraError> {
    let db_path = local_db_path(&app)?;
    let conn = Connection::open(db_path)?;
    conn.execute_batch(include_str!("../schema/local.sql"))?;
    let count = results.len();

    for result in &results {
        let payload = json!({
            "address": result.address,
            "category": result.category,
            "slug": result.slug,
            "title": result.title,
            "description": result.description,
            "contentCid": result.content_cid,
            "releaseVersion": result.release_version,
            "availability": result.availability
        });

        conn.execute(
            "INSERT INTO site_records (
              address, category, slug, title, description, publisher, age_rating, trust_level, payload, signature, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, '', 'EVERYONE', ?6, ?7, 'local-cache', CURRENT_TIMESTAMP)
            ON CONFLICT(address) DO UPDATE SET
              category = excluded.category,
              slug = excluded.slug,
              title = excluded.title,
              description = excluded.description,
              trust_level = excluded.trust_level,
              payload = excluded.payload,
              updated_at = CURRENT_TIMESTAMP",
            params![
                result.address,
                result.category,
                result.slug,
                result.title,
                result.description,
                result.availability,
                payload.to_string()
            ],
        )?;

        conn.execute("DELETE FROM site_fts WHERE address = ?1", params![result.address])?;
        conn.execute(
            "INSERT INTO site_fts (
              address, category, slug, title, description, keywords, publisher, language, tags, age_rating, trust_level
            ) VALUES (?1, ?2, ?3, ?4, ?5, '', '', '', '', 'EVERYONE', ?6)",
            params![
                result.address,
                result.category,
                result.slug,
                result.title,
                result.description,
                result.availability
            ],
        )?;
    }

    Ok(json!({ "ok": true, "count": count }))
}

#[tauri::command]
fn load_site_document(app: AppHandle, input: LoadSiteRequest) -> Result<LoadedSiteDocument, VeloraError> {
    let address = input.address.trim().to_lowercase();
    let site_root = resolve_site_root(&app, &address, input.site_path.as_deref())?;
    let index_path = site_root.join("index.html");
    let mut html = fs::read_to_string(&index_path)?;
    html = inline_demo_asset(&html, &site_root, "style.css", "style")?;
    html = inline_demo_asset(&html, &site_root, "app.js", "script")?;
    let title = extract_title(&html).unwrap_or_else(|| address.clone());

    cache_history_visit(&app, &address, &title)?;

    Ok(LoadedSiteDocument {
        address,
        title,
        html,
        source: site_root.to_string_lossy().to_string(),
    })
}

fn resolve_site_root(app: &AppHandle, address: &str, requested_path: Option<&str>) -> Result<PathBuf, VeloraError> {
    if let Some(path) = requested_path {
        let root = PathBuf::from(path);
        if root.join("index.html").is_file() {
            return Ok(root);
        }
    }

    let db_path = local_db_path(app)?;
    if db_path.exists() {
        let conn = Connection::open(db_path)?;
        conn.execute_batch(include_str!("../schema/local.sql"))?;
        let cached_path: Result<String, rusqlite::Error> = conn.query_row(
            "SELECT package_path FROM cached_releases WHERE address = ?1 ORDER BY updated_at DESC LIMIT 1",
            params![address],
            |row| row.get(0),
        );

        if let Ok(package_path) = cached_path {
            if let Some(parent) = Path::new(&package_path).parent() {
                if parent.join("index.html").is_file() {
                    return Ok(parent.to_path_buf());
                }
            }
        }
    }

    if address == "shop.demo" {
        let workspace_demo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .map(|root| root.join("examples").join("velora-demo-site"));

        if let Some(root) = workspace_demo {
            if root.join("index.html").is_file() {
                return Ok(root);
            }
        }
    }

    Err(VeloraError::SiteNotFound(address.to_string()))
}

fn inline_demo_asset(html: &str, site_root: &Path, file_name: &str, kind: &str) -> Result<String, VeloraError> {
    let asset_path = site_root.join(file_name);
    if !asset_path.is_file() {
        return Ok(html.to_string());
    }

    let content = fs::read_to_string(asset_path)?;
    let escaped = content.replace("</script>", "<\\/script>");
    let replaced = match kind {
        "style" => html.replace(
            &format!(r#"<link rel="stylesheet" href="./{}" />"#, file_name),
            &format!("<style>\n{}\n</style>", escaped),
        ),
        "script" => html.replace(
            &format!(r#"<script type="module" src="./{}"></script>"#, file_name),
            &format!("<script type=\"module\">\n{}\n</script>", escaped),
        ),
        _ => html.to_string(),
    };

    Ok(replaced)
}

fn extract_title(html: &str) -> Option<String> {
    let start = html.find("<title>")? + "<title>".len();
    let end = html[start..].find("</title>")? + start;
    Some(html[start..end].trim().to_string())
}

fn cache_history_visit(app: &AppHandle, address: &str, title: &str) -> Result<(), VeloraError> {
    let db_path = local_db_path(app)?;
    let conn = Connection::open(db_path)?;
    conn.execute_batch(include_str!("../schema/local.sql"))?;
    conn.execute(
        "INSERT INTO history (address, title) VALUES (?1, ?2)",
        params![address, title],
    )?;
    Ok(())
}

fn local_db_path(app: &AppHandle) -> Result<PathBuf, VeloraError> {
    let dir = app.path().app_data_dir().map_err(|_| VeloraError::AppDataUnavailable)?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("velora.local.sqlite"))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            init_local_store,
            get_or_create_node_identity,
            enroll_device,
            cache_packaged_release,
            cache_search_results,
            load_site_document
        ])
        .run(tauri::generate_context!())
        .expect("error while running Velora");
}
