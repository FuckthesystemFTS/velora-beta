const db = require("../db");

const SENSITIVE_KEY_RE = /(password|pass|secret|token|hash|api_key|apikey|access_token|refresh_token|session|cookie|credential)/i;
const BINARY_KEY_RE = /(^data$|blob|buffer|binary|file_data)/i;
const PREVIEW_LIMIT = 30;

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, "\"\"")}"`;
}

function stringifyValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Buffer.isBuffer(value)) {
    return `[binary ${value.length} bytes]`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function maskValue(key, value) {
  if (BINARY_KEY_RE.test(key)) {
    if (Buffer.isBuffer(value)) {
      return `[binary omitted ${value.length} bytes]`;
    }
    return "[binary omitted]";
  }
  if (SENSITIVE_KEY_RE.test(key)) {
    const text = stringifyValue(value);
    if (!text) {
      return "";
    }
    return text.length <= 8 ? "********" : `${"*".repeat(Math.min(16, text.length - 4))}${text.slice(-4)}`;
  }
  const text = stringifyValue(value);
  return text.length > 1200 ? `${text.slice(0, 1200)} ... [troncato]` : text;
}

function sanitizeRow(row) {
  return Object.entries(row || {}).reduce((acc, [key, value]) => {
    acc[key] = maskValue(key, value);
    return acc;
  }, {});
}

async function listTables() {
  if (db.meta.driver === "pg") {
    const rows = await db.all(
      `SELECT table_name AS name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name ASC`
    );
    return rows.map((row) => row.name);
  }

  const rows = await db.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
  );
  return rows.map((row) => row.name);
}

async function tableCount(tableName) {
  const row = await db.get(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(tableName)}`);
  return Number(row && row.total ? row.total : 0);
}

async function tableRows(tableName, limit = null) {
  const suffix = limit ? ` LIMIT ${Number(limit)}` : "";
  const rows = await db.all(`SELECT * FROM ${quoteIdentifier(tableName)}${suffix}`);
  return rows.map(sanitizeRow);
}

async function getDatabaseSnapshot({ includeRows = true, previewOnly = false } = {}) {
  const tableNames = await listTables();
  const tables = [];
  for (const name of tableNames) {
    const total = await tableCount(name);
    const rows = includeRows ? await tableRows(name, previewOnly ? PREVIEW_LIMIT : null) : [];
    tables.push({
      name,
      total,
      rows,
      previewOnly: previewOnly && total > rows.length,
      columns: rows[0] ? Object.keys(rows[0]) : []
    });
  }

  const users = await db.all(
    `SELECT users.id, users.name, users.email, users.status, users.credits, users.created_at, users.updated_at,
            COUNT(DISTINCT orders.id) AS orders_total,
            COUNT(DISTINCT content_uploads.id) AS uploads_total,
            COUNT(DISTINCT video_jobs.id) AS video_jobs_total
     FROM users
     LEFT JOIN orders ON orders.user_id = users.id
     LEFT JOIN content_uploads ON content_uploads.user_id = users.id
     LEFT JOIN video_jobs ON video_jobs.user_id = users.id
     GROUP BY users.id, users.name, users.email, users.status, users.credits, users.created_at, users.updated_at
     ORDER BY users.created_at DESC`
  );

  return {
    generatedAt: new Date().toISOString(),
    driver: db.meta.driver,
    tableCount: tables.length,
    totalRows: tables.reduce((sum, table) => sum + table.total, 0),
    users: users.map(sanitizeRow),
    tables
  };
}

function pdfEscape(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\r\n\t]/g, " ");
}

function normalizePdfText(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

function wrapText(text, max = 104) {
  const normalized = normalizePdfText(text);
  if (!normalized) {
    return [""];
  }
  const words = normalized.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if ((current ? `${current} ${word}` : word).length > max) {
      if (current) {
        lines.push(current);
      }
      current = word.slice(0, max);
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines.length ? lines : [""];
}

function buildPdfLines(snapshot) {
  const lines = [
    "CreatorSpeaker TV - copia database",
    `Generato: ${snapshot.generatedAt}`,
    `Database: ${snapshot.driver}`,
    `Tabelle: ${snapshot.tableCount}`,
    `Record totali: ${snapshot.totalRows}`,
    "Campi sensibili e dati binari mascherati per sicurezza",
    ""
  ];

  lines.push("Utenti registrati");
  if (!snapshot.users.length) {
    lines.push("Nessun utente registrato");
  }
  for (const user of snapshot.users) {
    lines.push(
      `#${user.id} ${user.name || ""} ${user.email || ""} stato=${user.status || ""} crediti=${user.credits || 0} ordini=${user.orders_total || 0} upload=${user.uploads_total || 0} video=${user.video_jobs_total || 0}`
    );
  }

  for (const table of snapshot.tables) {
    lines.push("");
    lines.push(`Tabella ${table.name} - record ${table.total}`);
    if (!table.rows.length) {
      lines.push("Nessun record");
      continue;
    }
    table.rows.forEach((row, index) => {
      lines.push(`Record ${index + 1}`);
      Object.entries(row).forEach(([key, value]) => {
        lines.push(`${key}: ${value}`);
      });
    });
  }

  return lines.flatMap((line) => wrapText(line));
}

function createPdfBuffer(lines) {
  const pageWidth = 595;
  const pageHeight = 842;
  const marginX = 42;
  const startY = 800;
  const lineHeight = 12;
  const maxLinesPerPage = Math.floor((startY - 42) / lineHeight);
  const pages = [];
  for (let index = 0; index < lines.length; index += maxLinesPerPage) {
    pages.push(lines.slice(index, index + maxLinesPerPage));
  }

  const objects = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageRefs = pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`);

  pages.forEach((pageLines, pageIndex) => {
    const pageObjectId = 3 + pageIndex * 2;
    const contentObjectId = pageObjectId + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentObjectId} 0 R >>`);
    const content = [
      "BT",
      "/F1 9 Tf",
      `${marginX} ${startY} Td`,
      ...pageLines.map((line, index) => `${index === 0 ? "" : `0 -${lineHeight} Td `}(${pdfEscape(line)}) Tj`),
      "ET"
    ].join("\n");
    objects.push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

async function createDatabasePdf() {
  const snapshot = await getDatabaseSnapshot({ includeRows: true, previewOnly: false });
  return createPdfBuffer(buildPdfLines(snapshot));
}

module.exports = {
  getDatabaseSnapshot,
  createDatabasePdf
};
