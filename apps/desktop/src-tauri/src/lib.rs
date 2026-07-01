use base64::Engine;
use rand::RngCore;
use rfd::FileDialog;
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

#[derive(Deserialize)]
struct LocalReleaseRequest {
    #[serde(rename = "sitePath")]
    site_path: String,
    #[serde(rename = "publisherPublicKey")]
    publisher_public_key: Option<String>,
}

#[derive(Serialize)]
struct LocalValidationResult {
    valid: bool,
    errors: Vec<String>,
    warnings: Vec<String>,
    #[serde(rename = "excludedFiles")]
    excluded_files: Vec<String>,
    #[serde(rename = "includedFiles")]
    included_files: Vec<String>,
    #[serde(rename = "totalFiles")]
    total_files: usize,
    #[serde(rename = "totalSize")]
    total_size: i64,
    #[serde(rename = "requestedPermissions")]
    requested_permissions: serde_json::Value,
}

#[derive(Serialize)]
struct LocalReleaseFile {
    path: String,
    size: i64,
    hash: String,
}

#[derive(Serialize)]
struct LocalReleaseChunk {
    #[serde(rename = "chunkIndex")]
    chunk_index: usize,
    #[serde(rename = "chunkHash")]
    chunk_hash: String,
    #[serde(rename = "chunkSize")]
    chunk_size: i64,
    #[serde(rename = "localPath")]
    local_path: String,
}

#[derive(Serialize)]
struct LocalPackageResponse {
    address: String,
    version: String,
    #[serde(rename = "contentCid")]
    content_cid: String,
    #[serde(rename = "manifestJson")]
    manifest_json: serde_json::Value,
    #[serde(rename = "manifestHash")]
    manifest_hash: String,
    #[serde(rename = "packageHash")]
    package_hash: String,
    #[serde(rename = "publisherPublicKey")]
    publisher_public_key: String,
    #[serde(rename = "publisherSignature")]
    publisher_signature: String,
    #[serde(rename = "totalSize")]
    total_size: i64,
    #[serde(rename = "fileCount")]
    file_count: usize,
    files: Vec<LocalReleaseFile>,
    chunks: Vec<LocalReleaseChunk>,
    #[serde(rename = "packagePath")]
    package_path: String,
}

#[derive(Serialize)]
struct FolderSelection {
    path: Option<String>,
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
fn validate_local_release(input: LocalReleaseRequest) -> Result<LocalValidationResult, VeloraError> {
    validate_site_path(Path::new(&input.site_path))
}

#[tauri::command]
fn package_local_release(input: LocalReleaseRequest) -> Result<LocalPackageResponse, VeloraError> {
    let site_root = PathBuf::from(&input.site_path);
    let validation = validate_site_path(&site_root)?;
    if !validation.valid {
        return Err(VeloraError::SiteNotFound("release is not valid".to_string()));
    }

    let manifest_path = site_root.join("velora.json");
    let manifest_text = fs::read_to_string(&manifest_path)?;
    let manifest_json: serde_json::Value = serde_json::from_str(&manifest_text)?;
    let address = manifest_json["address"].as_str().unwrap_or("shop.demo").to_string();
    let version = manifest_json["version"].as_str().unwrap_or("0.1.0").to_string();
    let publisher_public_key = input.publisher_public_key.unwrap_or_else(|| "local-publisher".to_string());
    let files = collect_site_files(&site_root)?;
    let mut release_files = Vec::new();
    let mut chunks = Vec::new();
    let mut package_material = String::new();
    let mut total_size = 0_i64;

    for (index, relative_path) in files.iter().enumerate() {
        let absolute = site_root.join(relative_path);
        let bytes = fs::read(&absolute)?;
        let hash = blake3::hash(&bytes).to_hex().to_string();
        let size = bytes.len() as i64;
        total_size += size;
        package_material.push_str(relative_path);
        package_material.push_str(&hash);
        release_files.push(LocalReleaseFile {
            path: relative_path.clone(),
            size,
            hash: format!("blake3:{hash}"),
        });
        chunks.push(LocalReleaseChunk {
            chunk_index: index,
            chunk_hash: format!("blake3:{hash}"),
            chunk_size: size,
            local_path: absolute.to_string_lossy().to_string(),
        });
    }

    let manifest_hash = blake3::hash(manifest_text.as_bytes()).to_hex().to_string();
    let package_hash = blake3::hash(package_material.as_bytes()).to_hex().to_string();
    let content_cid = blake3::hash(format!("{address}:{package_hash}").as_bytes()).to_hex().to_string();
    let signature = blake3::hash(format!("{publisher_public_key}:{address}:{version}:{package_hash}").as_bytes()).to_hex().to_string();

    Ok(LocalPackageResponse {
        address,
        version,
        content_cid: format!("blake3:{content_cid}"),
        manifest_json,
        manifest_hash: format!("blake3:{manifest_hash}"),
        package_hash: format!("blake3:{package_hash}"),
        publisher_public_key,
        publisher_signature: format!("local-signature:{signature}"),
        total_size,
        file_count: release_files.len(),
        files: release_files,
        chunks,
        package_path: manifest_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn choose_site_folder() -> FolderSelection {
    FolderSelection {
        path: FileDialog::new()
            .set_title("Seleziona la cartella del sito Velora")
            .pick_folder()
            .map(|path| path.display().to_string()),
    }
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

fn validate_site_path(site_root: &Path) -> Result<LocalValidationResult, VeloraError> {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut excluded_files = Vec::new();
    let included_files = collect_site_files(site_root)?;
    let manifest_path = site_root.join("velora.json");
    let manifest_json = if manifest_path.is_file() {
        serde_json::from_str::<serde_json::Value>(&fs::read_to_string(&manifest_path)?).unwrap_or_else(|_| {
            errors.push("Manifest velora.json non valido.".to_string());
            json!({})
        })
    } else {
        errors.push("Manca velora.json.".to_string());
        json!({})
    };

    if !site_root.join("index.html").is_file() {
        errors.push("Manca index.html.".to_string());
    }
    if manifest_json["address"].as_str().unwrap_or("").split('.').count() != 2 {
        errors.push("Indirizzo Velora non valido nel manifest.".to_string());
    }
    if manifest_json["title"].as_str().unwrap_or("").is_empty() {
        errors.push("Titolo mancante nel manifest.".to_string());
    }
    if included_files.is_empty() {
        warnings.push("Nessun file pubblicabile trovato.".to_string());
    }

    let mut total_size = 0_i64;
    for file in &included_files {
        total_size += fs::metadata(site_root.join(file))?.len() as i64;
        if file.ends_with(".exe") || file.ends_with(".dll") || file.ends_with(".msi") || file.ends_with(".bat") || file.ends_with(".cmd") || file.ends_with(".ps1") {
            excluded_files.push(file.clone());
        }
    }

    let included_count = included_files.len();
    Ok(LocalValidationResult {
        valid: errors.is_empty(),
        errors,
        warnings,
        excluded_files,
        included_files: included_files.into_iter().filter(|file| !file.ends_with(".exe") && !file.ends_with(".dll") && !file.ends_with(".msi")).collect(),
        total_files: included_count,
        total_size,
        requested_permissions: manifest_json.get("permissions").cloned().unwrap_or_else(|| json!({
            "externalNetwork": false,
            "clipboardRead": false,
            "clipboardWrite": false,
            "notifications": false,
            "fileDownload": false
        })),
    })
}

fn collect_site_files(site_root: &Path) -> Result<Vec<String>, VeloraError> {
    let mut files = Vec::new();
    collect_site_files_inner(site_root, site_root, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_site_files_inner(root: &Path, current: &Path, files: &mut Vec<String>) -> Result<(), VeloraError> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".git" || name == "node_modules" || name == "target" || name.starts_with(".env") {
            continue;
        }
        if path.is_dir() {
            collect_site_files_inner(root, &path, files)?;
        } else {
            let relative = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            files.push(relative);
        }
    }
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
            choose_site_folder,
            validate_local_release,
            package_local_release,
            cache_packaged_release,
            cache_search_results,
            load_site_document
        ])
        .run(tauri::generate_context!())
        .expect("error while running Velora");
}
