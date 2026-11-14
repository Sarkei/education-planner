var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/db.ts
import pg from "pg";
async function initDb() {
  await pool.query(`
    create table if not exists users (
      id serial primary key,
      email text not null unique,
      name text not null,
      password_hash text not null,
      role text not null default 'user',
      token_version integer not null default 0,
      created_at timestamptz not null default now()
    );

    create table if not exists password_resets (
      id serial primary key,
      user_id integer not null references users(id) on delete cascade,
      token_hash text not null,
      expires_at timestamptz not null,
      used_at timestamptz
    );

    create table if not exists nodes (
      id uuid primary key,
      parent_id uuid references nodes(id) on delete set null,
      name text not null,
      kind text not null check (kind in ('folder','file')),
      storage_path text not null,
      mime text,
      size bigint not null default 0,
      version integer not null default 1,
      owner_id integer not null references users(id) on delete cascade,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      trashed_at timestamptz,
      trashed_from uuid,
      position integer not null default 0
    );

    create index if not exists nodes_parent_idx on nodes(parent_id) where trashed_at is null;
    create index if not exists nodes_owner_idx on nodes(owner_id);

    create table if not exists shares (
      id serial primary key,
      node_id uuid not null references nodes(id) on delete cascade,
      user_id integer not null references users(id) on delete cascade,
      permission text not null check (permission in ('view','edit')),
      created_at timestamptz not null default now(),
      unique (node_id, user_id)
    );

    create table if not exists file_versions (
      id serial primary key,
      node_id uuid not null references nodes(id) on delete cascade,
      version integer not null,
      storage_path text not null,
      size bigint not null default 0,
      created_by integer references users(id) on delete set null,
      created_at timestamptz not null default now()
    );

    create table if not exists upload_sessions (
      id uuid primary key,
      user_id integer not null references users(id) on delete cascade,
      parent_id uuid references nodes(id) on delete set null,
      name text not null,
      mime text,
      size bigint not null default 0,
      chunks integer not null default 0,
      created_at timestamptz not null default now()
    );

    create table if not exists node_texts (
      node_id uuid primary key references nodes(id) on delete cascade,
      version integer not null default 0,
      content text not null default '',
      tsv tsvector,
      updated_at timestamptz not null default now()
    );
    create index if not exists node_texts_tsv_idx on node_texts using gin(tsv);

    create table if not exists office_sessions (
      node_id uuid primary key references nodes(id) on delete cascade,
      doc_key text not null,
      updated_at timestamptz not null default now()
    );
    alter table office_sessions add column if not exists last_saved_at timestamptz;
    alter table office_sessions add column if not exists last_status integer;
  `);
}
var pool;
var init_db = __esm({
  "server/db.ts"() {
    "use strict";
    pool = new pg.Pool({
      host: process.env.POSTGRES_HOST || "db",
      port: Number(process.env.POSTGRES_PORT || 5432),
      user: process.env.POSTGRES_USER || "edu",
      password: process.env.POSTGRES_PASSWORD || "edu",
      database: process.env.POSTGRES_DB || "education",
      max: 10
    });
  }
});

// server/guards.ts
var guards_exports = {};
__export(guards_exports, {
  attachUser: () => attachUser,
  canWrite: () => canWrite,
  fail: () => fail,
  loadNode: () => loadNode,
  nodeAccess: () => nodeAccess,
  requireAdmin: () => requireAdmin,
  requireAuth: () => requireAuth,
  signToken: () => signToken
});
import jwt from "jsonwebtoken";
function signToken(user) {
  return jwt.sign({ uid: user.id, tv: user.token_version }, SECRET, { expiresIn: "30d" });
}
function fail(res, status, error, message) {
  res.status(status).json({ error, message });
}
async function attachUser(req, _res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), SECRET);
      const result = await pool.query(
        "SELECT id, name, role, token_version FROM users WHERE id = $1",
        [payload.uid]
      );
      const user = result.rows[0];
      if (user && user.token_version === payload.tv) {
        req.userId = user.id;
        req.userName = user.name;
        req.userRole = user.role;
      }
    } catch {
    }
  }
  next();
}
function requireAuth(req, res, next) {
  if (!req.userId) {
    fail(res, 401, "unauthorized", "Bitte anmelden.");
    return;
  }
  next();
}
function requireAdmin(req, res, next) {
  if (req.userRole !== "admin") {
    fail(res, 403, "forbidden", "Nur f\xFCr Administratoren.");
    return;
  }
  next();
}
async function nodeAccess(nodeId, userId) {
  const result = await pool.query(
    `WITH RECURSIVE chain AS (
        SELECT n.id, n.parent_id, n.owner_id, 0 AS depth FROM nodes n WHERE n.id = $1
        UNION ALL
        SELECT p.id, p.parent_id, p.owner_id, c.depth + 1
          FROM nodes p JOIN chain c ON p.id = c.parent_id
      )
      SELECT c.id, c.owner_id, c.depth, s.permission
        FROM chain c
        LEFT JOIN shares s ON s.node_id = c.id AND s.user_id = $2
       ORDER BY c.depth ASC`,
    [nodeId, userId]
  );
  if (!result.rows.length) return null;
  const first = result.rows[0];
  if (first.owner_id === userId) {
    const node2 = await loadNode(nodeId);
    return node2 ? { node: node2, level: "owner" } : null;
  }
  let level = null;
  for (const row of result.rows) {
    if (row.permission === "edit") {
      level = "edit";
      break;
    }
    if (row.permission === "view" && !level) level = "view";
  }
  if (!level) return null;
  const node = await loadNode(nodeId);
  return node ? { node, level } : null;
}
async function loadNode(nodeId) {
  const result = await pool.query("SELECT * FROM nodes WHERE id = $1", [nodeId]);
  return result.rows[0] ?? null;
}
function canWrite(access) {
  return Boolean(access && (access.level === "owner" || access.level === "edit"));
}
var SECRET;
var init_guards = __esm({
  "server/guards.ts"() {
    "use strict";
    init_db();
    SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
  }
});

// server/index.ts
init_db();
init_guards();
import "dotenv/config";
import express2 from "express";
import fs7 from "node:fs";
import path6 from "node:path";

// server/auth.ts
init_db();
init_guards();
import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
var authRouter = Router();
var credentials = z.object({
  email: z.string().email("Bitte eine g\xFCltige E-Mail angeben."),
  password: z.string().min(8, "Mindestens 8 Zeichen.")
});
var registerSchema = credentials.extend({ name: z.string().min(2, "Bitte einen Namen angeben.") });
authRouter.get("/config", async (_req, res) => {
  const { rows } = await pool.query("SELECT count(*)::text AS count FROM users");
  res.json({ needsSetup: rows[0].count === "0" });
});
authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", parsed.error.issues[0].message);
    return;
  }
  const { email, password, name } = parsed.data;
  const existing = await pool.query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [email]);
  if (existing.rowCount) {
    fail(res, 409, "email-taken", "Diese E-Mail ist schon vergeben.");
    return;
  }
  const count = await pool.query("SELECT count(*)::text AS count FROM users");
  const role = count.rows[0].count === "0" ? "admin" : "user";
  const hash = await bcrypt.hash(password, 10);
  const created = await pool.query(
    "INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role, token_version",
    [email.toLowerCase(), name, hash, role]
  );
  const user = created.rows[0];
  res.status(201).json({
    token: signToken(user),
    user: { id: user.id, email: user.email, name: user.name, role: user.role }
  });
});
authRouter.post("/login", async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", parsed.error.issues[0].message);
    return;
  }
  const { rows } = await pool.query(
    "SELECT id, email, name, role, password_hash, token_version FROM users WHERE lower(email) = lower($1)",
    [parsed.data.email]
  );
  const user = rows[0];
  if (!user || !await bcrypt.compare(parsed.data.password, user.password_hash)) {
    fail(res, 401, "bad-credentials", "E-Mail oder Passwort stimmt nicht.");
    return;
  }
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, name: user.name, role: user.role }
  });
});
var DEMO_EMAIL = process.env.DEMO_EMAIL?.trim() || "demo@example.com";
async function handleDemo(_req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT id, email, name, role, token_version FROM users WHERE lower(email) = lower($1) LIMIT 1",
      [DEMO_EMAIL]
    );
    const user = rows[0];
    if (!user) {
      fail(res, 404, "demo-missing", "Demo ist nicht eingerichtet.");
      return;
    }
    res.json({
      token: signToken(user),
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (e) {
    console.error("[auth/demo]", e);
    fail(res, 500, "demo-failed", "Demo konnte nicht geladen werden.");
  }
}
authRouter.get("/demo", handleDemo);
authRouter.post("/demo", handleDemo);
authRouter.get("/me", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT id, email, name, role, created_at FROM users WHERE id = $1", [req.userId]);
  res.json({ user: rows[0] });
});
authRouter.post("/password", requireAuth, async (req, res) => {
  const schema = z.object({ current: z.string().min(1), next: z.string().min(8, "Mindestens 8 Zeichen.") });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", parsed.error.issues[0].message);
    return;
  }
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.userId]);
  if (!await bcrypt.compare(parsed.data.current, rows[0].password_hash)) {
    fail(res, 400, "bad-password", "Das aktuelle Passwort stimmt nicht.");
    return;
  }
  const hash = await bcrypt.hash(parsed.data.next, 10);
  await pool.query("UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2", [hash, req.userId]);
  res.json({ ok: true, message: "Passwort ge\xE4ndert \u2014 bitte neu anmelden." });
});
authRouter.post("/forgot", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const { rows } = await pool.query("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
  const response = { ok: true, message: "Wenn es das Konto gibt, ist ein Link unterwegs." };
  if (rows.length && process.env.ALLOW_DEV_RESET_LINK === "1") {
    const token = crypto.randomBytes(24).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    await pool.query("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '60 minutes')", [rows[0].id, hash]);
    response.resetToken = token;
  }
  res.json(response);
});
authRouter.post("/reset", async (req, res) => {
  const schema = z.object({ token: z.string().min(10), password: z.string().min(8, "Mindestens 8 Zeichen.") });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", parsed.error.issues[0].message);
    return;
  }
  const hash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const { rows } = await pool.query(
    "SELECT id, user_id FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()",
    [hash]
  );
  if (!rows.length) {
    fail(res, 400, "invalid-token", "Der Link ist ung\xFCltig oder abgelaufen.");
    return;
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await pool.query("UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2", [passwordHash, rows[0].user_id]);
  await pool.query("UPDATE password_resets SET used_at = now() WHERE id = $1", [rows[0].id]);
  res.json({ ok: true });
});
authRouter.get("/users", requireAuth, requireAdmin, async (_req, res) => {
  const { rows } = await pool.query("SELECT id, email, name, role, created_at FROM users ORDER BY name");
  res.json({ users: rows });
});
authRouter.post("/users", requireAuth, requireAdmin, async (req, res) => {
  const schema = credentials.extend({ name: z.string().min(2), role: z.enum(["admin", "user"]).default("user") });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", parsed.error.issues[0].message);
    return;
  }
  const existing = await pool.query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [parsed.data.email]);
  if (existing.rowCount) {
    fail(res, 409, "email-taken", "Diese E-Mail ist schon vergeben.");
    return;
  }
  const hash = await bcrypt.hash(parsed.data.password, 10);
  const { rows } = await pool.query(
    "INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role, created_at",
    [parsed.data.email.toLowerCase(), parsed.data.name, hash, parsed.data.role]
  );
  res.status(201).json({ user: rows[0] });
});
authRouter.delete("/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.userId) {
    fail(res, 400, "self-delete", "Das eigene Konto l\xE4sst sich hier nicht l\xF6schen.");
    return;
  }
  await pool.query("DELETE FROM users WHERE id = $1", [id]);
  res.json({ ok: true });
});

// server/nodes.ts
init_db();
init_guards();
import { Router as Router2 } from "express";
import fs3 from "node:fs";
import path3 from "node:path";
import crypto3 from "node:crypto";
import archiver from "archiver";
import jwt2 from "jsonwebtoken";
import { z as z2 } from "zod";

// server/storage.ts
import fs from "node:fs";
import path from "node:path";
import crypto2 from "node:crypto";
var FILES_ROOT = process.env.FILES_ROOT || "/data/files";
var VERSIONS_ROOT = process.env.VERSIONS_ROOT || "/data/versions";
var TRASH_ROOT = process.env.TRASH_ROOT || "/data/trash";
var TMP_ROOT = process.env.TMP_ROOT || "/data/tmp";
function ensureDirs() {
  for (const dir of [FILES_ROOT, VERSIONS_ROOT, TRASH_ROOT, TMP_ROOT]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
function safeName(raw) {
  const cleaned = String(raw ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  const name = cleaned.slice(0, 180).trim();
  return name || "Unbenannt";
}
function absolute(relative2) {
  const clean = relative2.split("/").filter((part) => part && part !== "." && part !== "..").join("/");
  const full = path.join(FILES_ROOT, clean);
  if (!full.startsWith(FILES_ROOT)) throw new Error("Pfad au\xDFerhalb des Speichers");
  return full;
}
function relative(parentPath, name) {
  return parentPath ? `${parentPath}/${safeName(name)}` : safeName(name);
}
async function writeAtomic(target, data) {
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${crypto2.randomBytes(6).toString("hex")}.tmp`;
  if (Buffer.isBuffer(data)) {
    await fs.promises.writeFile(tmp, data);
  } else {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      data.pipe(out);
      data.on("error", reject);
      out.on("error", reject);
      out.on("finish", () => resolve());
    });
  }
  await fs.promises.rename(tmp, target);
  const stat = await fs.promises.stat(target);
  return stat.size;
}
async function movePath(from, to) {
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.promises.rename(from, to);
  } catch {
    await fs.promises.cp(from, to, { recursive: true });
    await fs.promises.rm(from, { recursive: true, force: true });
  }
}
async function copyPath(from, to) {
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  await fs.promises.cp(from, to, { recursive: true });
}
async function saveVersion(nodeId, absolutePath, version, userId, pool2) {
  if (!fs.existsSync(absolutePath)) return;
  const dir = path.join(VERSIONS_ROOT, nodeId);
  await fs.promises.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${version}-${Date.now()}${path.extname(absolutePath) || ".bin"}`);
  await fs.promises.copyFile(absolutePath, target);
  const stat = await fs.promises.stat(target);
  await pool2.query(
    "INSERT INTO file_versions (node_id, version, storage_path, size, created_by) VALUES ($1,$2,$3,$4,$5)",
    [nodeId, version, path.relative(VERSIONS_ROOT, target), stat.size, userId]
  );
  const keep = await pool2.query(
    `SELECT id FROM file_versions WHERE node_id = $1 ORDER BY created_at DESC OFFSET 20`,
    [nodeId]
  );
  for (const row of keep.rows) {
    await pool2.query("DELETE FROM file_versions WHERE id = $1", [row.id]);
  }
}

// server/templates.ts
import JSZip3 from "jszip";

// server/pptx.ts
import JSZip from "jszip";
async function emptyPptx() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Pr\xE4sentation</dc:title><dc:creator>Education Planner</dc:creator></cp:coreProperties>`
  );
  zip.file(
    "docProps/app.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Education Planner</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>1</Slides></Properties>`
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/></Relationships>`
  );
  zip.file("ppt/presProps.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
  zip.file("ppt/viewProps.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:viewPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
  zip.file("ppt/tableStyles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="title" preserve="1"><p:cSld name="Titelfolie"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Titelplatzhalter"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ctrTitle" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="2387600"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="b"/><a:lstStyle/><a:p><a:endParaRPr lang="de-DE"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Untertitelplatzhalter"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="subTitle" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="4351338"/><a:ext cx="10515600" cy="1651000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="t"/><a:lstStyle/><a:p><a:endParaRPr lang="de-DE"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Titel 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="de-DE"/><a:t>Klicken, um den Titel hinzuzuf\xFCgen</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/theme/theme1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/><a:shade val="98000"/><a:lumMod val="102000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:tint val="98000"/><a:satMod val="130000"/><a:shade val="90000"/><a:lumMod val="103000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/><a:satMod val="120000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// server/odf.ts
import JSZip2 from "jszip";
var META = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"><office:meta><dc:creator>Education Planner</dc:creator><dc:title>Dokument</dc:title></office:meta></office:document-meta>`;
var SETTINGS = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-settings xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" office:version="1.3"><office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item config:name="ViewAreaTop" config:type="long">0</config:config-item><config:config-item config:name="ViewAreaLeft" config:type="long">0</config:config-item></config:config-item-set></office:settings></office:document-settings>`;
function manifest(mime, extra) {
  const entries = extra.map((path7) => `<manifest:file-entry manifest:full-path="${path7}" manifest:media-type="text/xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/>${entries}</manifest:manifest>`;
}
var STYLES_TEXT = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3"><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:orphans="2" fo:widows="2"/><style:text-properties fo:font-size="11pt" fo:language="de" fo:country="DE"/></style:default-style></office:styles><office:automatic-styles/><office:master-styles/></office:document-styles>`;
var CONTENT_TEXT = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.3"><office:body><office:text><text:p/></office:text></office:body></office:document-content>`;
var CONTENT_SHEET = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3"><office:body><office:spreadsheet><table:table table:name="Tabelle1"><table:table-column table:number-columns-repeated="5"/><table:table-row><table:table-cell office:value-type="string"><text:p/></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`;
var CONTENT_SLIDES = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3"><office:automatic-styles/><office:body><office:presentation><draw:page draw:name="Folie 1"><draw:frame draw:name="Titel" svg:x="2cm" svg:y="6cm" svg:width="21cm" svg:height="3cm"><draw:text-box><text:p>Klicken, um den Titel hinzuzuf\xFCgen</text:p></draw:text-box></draw:frame></draw:page></office:presentation></office:body></office:document-content>`;
async function buildOdf(mime, content) {
  const zip = new JSZip2();
  zip.file("mimetype", mime, { compression: "STORE" });
  zip.file("META-INF/manifest.xml", manifest(mime, []));
  zip.file("content.xml", content);
  zip.file("styles.xml", STYLES_TEXT);
  zip.file("meta.xml", META);
  zip.file("settings.xml", SETTINGS);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
var emptyOdt = () => buildOdf("application/vnd.oasis.opendocument.text", CONTENT_TEXT);
var emptyOds = () => buildOdf("application/vnd.oasis.opendocument.spreadsheet", CONTENT_SHEET);
var emptyOdp = () => buildOdf("application/vnd.oasis.opendocument.presentation", CONTENT_SLIDES);

// server/templates.ts
var CONTENT_TYPES_DOCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
var RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
var DOCX_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
async function emptyDocx() {
  const zip = new JSZip3();
  zip.file("[Content_Types].xml", CONTENT_TYPES_DOCX);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", DOCX_DOCUMENT);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
var XLSX_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
var XLSX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
var XLSX_WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tabelle1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
var XLSX_WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
var XLSX_SHEET = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`;
var XLSX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;
async function emptyXlsx() {
  const zip = new JSZip3();
  zip.file("[Content_Types].xml", XLSX_TYPES);
  zip.file("_rels/.rels", XLSX_RELS);
  zip.file("xl/workbook.xml", XLSX_WORKBOOK);
  zip.file("xl/_rels/workbook.xml.rels", XLSX_WORKBOOK_RELS);
  zip.file("xl/worksheets/sheet1.xml", XLSX_SHEET);
  zip.file("xl/styles.xml", XLSX_STYLES);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
async function emptyFileFor(name) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "docx") return emptyDocx();
  if (ext === "xlsx") return emptyXlsx();
  if (ext === "pptx") return emptyPptx();
  if (ext === "odt") return emptyOdt();
  if (ext === "ods") return emptyOds();
  if (ext === "odp") return emptyOdp();
  return Buffer.from("", "utf8");
}
function mimeFor(name) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    docm: "application/vnd.ms-word.document.macroEnabled.12",
    dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
    doc: "application/msword",
    odt: "application/vnd.oasis.opendocument.text",
    rtf: "application/rtf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
    xls: "application/vnd.ms-excel",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ppt: "application/vnd.ms-powerpoint",
    odp: "application/vnd.oasis.opendocument.presentation",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    xml: "application/xml",
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "text/javascript",
    ts: "text/typescript",
    yml: "text/yaml",
    yaml: "text/yaml",
    ini: "text/plain",
    log: "text/plain",
    sh: "text/x-shellscript",
    tex: "text/x-tex",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    avif: "image/avif",
    tif: "image/tiff",
    tiff: "image/tiff",
    heic: "image/heic",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    m4a: "audio/mp4",
    flac: "audio/flac",
    aac: "audio/aac",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    m4v: "video/mp4",
    mkv: "video/x-matroska",
    zip: "application/zip",
    "7z": "application/x-7z-compressed",
    rar: "application/vnd.rar",
    tar: "application/x-tar",
    gz: "application/gzip"
  };
  return map[ext] ?? "application/octet-stream";
}

// server/indexer.ts
init_db();
init_guards();

// server/extract.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { execFile } from "node:child_process";
import JSZip4 from "jszip";
var PLAIN = /* @__PURE__ */ new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".log",
  ".xml",
  ".html",
  ".htm",
  ".tex",
  ".yml",
  ".yaml",
  ".ini",
  ".cfg",
  ".conf",
  ".sh",
  ".bat",
  ".ps1",
  ".css",
  ".js",
  ".ts",
  ".sql",
  ".tsv",
  ".srt",
  ".vtt"
]);
var ZIP_DOC = /* @__PURE__ */ new Set([".docx", ".docm", ".xlsx", ".xlsm", ".pptx", ".odt", ".ods", ".odp"]);
function xmlToText(xml) {
  return xml.replace(/<w:p[^>]*>/g, "\n").replace(/<a:p>/g, "\n").replace(/<text:p[^>]*>/g, "\n").replace(/<w:tab\/>/g, "	").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
async function textFromZip(full, ext) {
  const data = await fs2.promises.readFile(full);
  const zip = await JSZip4.loadAsync(data);
  const parts = [];
  if (ext === ".docx" || ext === ".docm") {
    const doc = zip.file("word/document.xml");
    if (doc) parts.push(xmlToText(await doc.async("string")));
    for (const name of ["word/header1.xml", "word/footer1.xml", "word/footnotes.xml"]) {
      const file = zip.file(name);
      if (file) parts.push(xmlToText(await file.async("string")));
    }
  } else if (ext === ".xlsx" || ext === ".xlsm") {
    const shared = zip.file("xl/sharedStrings.xml");
    if (shared) parts.push(xmlToText(await shared.async("string")));
    const sheets = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    for (const sheet of sheets.slice(0, 20)) {
      const file = zip.file(sheet);
      if (file) parts.push(xmlToText(await file.async("string")));
    }
  } else if (ext === ".pptx") {
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
    for (const slide of slides) {
      const file = zip.file(slide);
      if (file) parts.push(xmlToText(await file.async("string")));
    }
    const notes = Object.keys(zip.files).filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
    for (const note of notes.slice(0, 30)) {
      const file = zip.file(note);
      if (file) parts.push(xmlToText(await file.async("string")));
    }
  } else {
    const content = zip.file("content.xml");
    if (content) parts.push(xmlToText(await content.async("string")));
    const styles = zip.file("styles.xml");
    if (styles) parts.push(xmlToText(await styles.async("string")));
  }
  return parts.filter(Boolean).join("\n").slice(0, 6e5);
}
function pdfToText(full) {
  return new Promise((resolve) => {
    execFile("pdftotext", ["-layout", full, "-"], { maxBuffer: 40 * 1024 * 1024, timeout: 3e4 }, (error, stdout) => {
      if (error) {
        resolve("");
        return;
      }
      resolve(String(stdout).slice(0, 6e5));
    });
  });
}
async function extractText(fullPath, name) {
  const ext = path2.extname(name).toLowerCase();
  try {
    const stat = await fs2.promises.stat(fullPath);
    if (stat.size > 25 * 1024 * 1024) return "";
    if (PLAIN.has(ext)) {
      const raw = await fs2.promises.readFile(fullPath, "utf8");
      return raw.slice(0, 6e5);
    }
    if (ZIP_DOC.has(ext)) return textFromZip(fullPath, ext);
    if (ext === ".pdf") return pdfToText(fullPath);
    if (ext === ".rtf") {
      const raw = await fs2.promises.readFile(fullPath, "utf8");
      return raw.replace(/\\'([0-9a-f]{2})/gi, " ").replace(/\\[a-z]+-?\d* ?/gi, " ").replace(/[{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, 6e5);
    }
  } catch {
    return "";
  }
  return "";
}
function isSearchable(name) {
  const ext = path2.extname(name).toLowerCase();
  return PLAIN.has(ext) || ZIP_DOC.has(ext) || ext === ".pdf" || ext === ".rtf";
}

// server/indexer.ts
async function indexNode(nodeId) {
  const node = await loadNode(nodeId);
  if (!node || node.kind !== "file" || node.trashed_at) return false;
  if (!isSearchable(node.name)) return false;
  const text = await extractText(absolute(node.storage_path), node.name);
  await pool.query(
    `INSERT INTO node_texts (node_id, version, content, tsv, updated_at)
     VALUES ($1,$2,$3, to_tsvector('german', $3), now())
     ON CONFLICT (node_id) DO UPDATE
        SET version = EXCLUDED.version, content = EXCLUDED.content,
            tsv = EXCLUDED.tsv, updated_at = now()`,
    [node.id, node.version, text]
  );
  return true;
}
async function indexMissing(limit = 25) {
  const { rows } = await pool.query(
    `SELECT n.* FROM nodes n
       LEFT JOIN node_texts t ON t.node_id = n.id
      WHERE n.kind = 'file' AND n.trashed_at IS NULL
        AND (t.node_id IS NULL OR t.version < n.version)
      ORDER BY n.updated_at DESC
      LIMIT $1`,
    [limit]
  );
  let done = 0;
  for (const row of rows) {
    if (await indexNode(row.id)) done++;
  }
  return done;
}
async function indexPending() {
  const { rows } = await pool.query(
    `SELECT count(*)::text AS count FROM nodes n
       LEFT JOIN node_texts t ON t.node_id = n.id
      WHERE n.kind = 'file' AND n.trashed_at IS NULL
        AND (t.node_id IS NULL OR t.version < n.version)`
  );
  return Number(rows[0]?.count ?? 0);
}
function startIndexer(intervalMs = 5 * 60 * 1e3) {
  const tick = async () => {
    try {
      const done = await indexMissing(25);
      if (done) console.log(`Index: ${done} Dateien erg\xE4nzt`);
    } catch (error) {
      console.error("Index-Lauf fehlgeschlagen", error);
    }
  };
  void tick();
  setInterval(() => void tick(), intervalMs);
}

// server/nodes.ts
var nodesRouter = Router2();
function toDto(row, userId) {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    kind: row.kind,
    mime: row.mime,
    size: Number(row.size),
    version: row.version,
    ownerId: row.owner_id,
    shared: row.owner_id !== userId,
    permission: row.owner_id === userId ? "owner" : row.permission === "edit" ? "edit" : "view",
    updatedAt: new Date(row.updated_at ?? Date.now()).toISOString(),
    position: row.position ?? 0
  };
}
async function visibleNodes(userId) {
  const { rows } = await pool.query(
    `WITH RECURSIVE shared AS (
        SELECT n.*, s.permission FROM nodes n
          JOIN shares s ON s.node_id = n.id AND s.user_id = $1
         WHERE n.trashed_at IS NULL
      ), down AS (
        SELECT * FROM shared
        UNION ALL
        SELECT n.*, d.permission FROM nodes n JOIN down d ON n.parent_id = d.id WHERE n.trashed_at IS NULL
      )
      SELECT * FROM down
      UNION
      SELECT n.*, 'owner' FROM nodes n WHERE n.owner_id = $1 AND n.trashed_at IS NULL`,
    [userId]
  );
  return rows.map((r) => toDto(r, userId));
}
nodesRouter.get("/tree", requireAuth, async (req, res) => {
  res.json({ nodes: await visibleNodes(req.userId) });
});
nodesRouter.get("/:id", requireAuth, async (req, res) => {
  const access = await nodeAccess(req.params.id, req.userId);
  if (!access) {
    fail(res, 404, "not-found", "Nicht gefunden.");
    return;
  }
  res.json({ node: toDto(access.node, req.userId) });
});
nodesRouter.post("/file", requireAuth, async (req, res) => {
  const schema = z2.object({
    parentId: z2.string().uuid().nullable().optional(),
    name: z2.string().min(1).max(180)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", parsed.error.issues[0].message);
    return;
  }
  const parentId = parsed.data.parentId ?? null;
  let parentPath = null;
  if (parentId) {
    const access = await nodeAccess(parentId, req.userId);
    if (!access || access.node.kind !== "folder" || !canWrite(access)) {
      fail(res, 403, "forbidden", "Keine Schreibrechte in diesem Ordner.");
      return;
    }
    parentPath = access.node.storage_path;
  }
  const raw = parsed.data.name.includes(".") ? parsed.data.name : `${parsed.data.name}.docx`;
  const name = await uniqueName(parentId, raw);
  const storagePath = relative(parentPath, name);
  const content = await emptyFileFor(name);
  const size = await writeAtomic(absolute(storagePath), content);
  const id = crypto3.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO nodes (id, parent_id, name, kind, storage_path, mime, size, owner_id, position)
     VALUES ($1,$2,$3,'file',$4,$5,$6,$7, coalesce((select max(position)+1 from nodes where parent_id is not distinct from $2), 0))
     RETURNING *`,
    [id, parentId, name, storagePath, mimeFor(name), size, req.userId]
  );
  void indexNode(id).catch(() => void 0);
  res.status(201).json({ node: toDto(rows[0], req.userId) });
});
nodesRouter.post("/:id/copy", requireAuth, async (req, res) => {
  const schema = z2.object({ parentId: z2.string().uuid().nullable().optional() });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    fail(res, 400, "invalid-input", parsed.error.issues[0].message);
    return;
  }
  const access = await nodeAccess(req.params.id, req.userId);
  if (!access) {
    fail(res, 404, "not-found", "Nicht gefunden.");
    return;
  }
  const targetParent = parsed.data.parentId === void 0 ? access.node.parent_id : parsed.data.parentId;
  let parentPath = null;
  if (targetParent) {
    const target = await nodeAccess(targetParent, req.userId);
    if (!target || target.node.kind !== "folder" || !canWrite(target)) {
      fail(res, 403, "forbidden", "Keine Schreibrechte im Zielordner.");
      return;
    }
    parentPath = target.node.storage_path;
  }
  try {
    const copyId = await copySubtree(access.node, targetParent, parentPath, req.userId);
    const created = await loadNode(copyId);
    res.status(201).json({ node: created ? toDto(created, req.userId) : null });
  } catch (e) {
    fail(res, 500, "copy-failed", e instanceof Error ? e.message : "Kopieren fehlgeschlagen.");
  }
});
async function copySubtree(node, parentId, parentPath, userId) {
  const name = await uniqueName(parentId, node.name);
  const storagePath = relative(parentPath, name);
  const id = crypto3.randomUUID();
  await copyPath(absolute(node.storage_path), absolute(storagePath));
  await pool.query(
    `INSERT INTO nodes (id, parent_id, name, kind, storage_path, mime, size, owner_id, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, coalesce((select max(position)+1 from nodes where parent_id is not distinct from $2), 0))`,
    [id, parentId, name, node.kind, storagePath, node.mime, node.size, userId]
  );
  if (node.kind === "folder") {
    const { rows: kids } = await pool.query(
      "SELECT * FROM nodes WHERE parent_id = $1 AND trashed_at is null ORDER BY name",
      [node.id]
    );
    for (const kid of kids) {
      await copySubtree(kid, id, storagePath, userId);
    }
  } else {
    void indexNode(id).catch(() => void 0);
  }
  return id;
}
nodesRouter.post("/folder", requireAuth, async (req, res) => {
  const schema = z2.object({ parentId: z2.string().uuid().nullable().optional(), name: z2.string().min(1).max(120) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", parsed.error.issues[0].message);
    return;
  }
  const parentId = parsed.data.parentId ?? null;
  let parentPath = null;
  if (parentId) {
    const access = await nodeAccess(parentId, req.userId);
    if (!access || access.node.kind !== "folder") {
      fail(res, 404, "not-found", "Zielordner nicht gefunden.");
      return;
    }
    if (!canWrite(access)) {
      fail(res, 403, "forbidden", "Keine Schreibrechte in diesem Ordner.");
      return;
    }
    parentPath = access.node.storage_path;
  }
  const name = await uniqueName(parentId, parsed.data.name);
  const storagePath = relative(parentPath, name);
  const id = crypto3.randomUUID();
  await fs3.promises.mkdir(absolute(storagePath), { recursive: true });
  const { rows } = await pool.query(
    `INSERT INTO nodes (id, parent_id, name, kind, storage_path, owner_id, position)
     VALUES ($1,$2,$3,'folder',$4,$5, coalesce((select max(position)+1 from nodes where parent_id is not distinct from $2), 0))
     RETURNING *`,
    [id, parentId, name, storagePath, req.userId]
  );
  res.status(201).json({ node: toDto(rows[0], req.userId) });
});
nodesRouter.patch("/:id", requireAuth, async (req, res) => {
  const schema = z2.object({
    name: z2.string().min(1).max(180).optional(),
    parentId: z2.string().uuid().nullable().optional(),
    position: z2.number().int().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", parsed.error.issues[0].message);
    return;
  }
  const access = await nodeAccess(req.params.id, req.userId);
  if (!access) {
    fail(res, 404, "not-found", "Nicht gefunden.");
    return;
  }
  if (!canWrite(access)) {
    fail(res, 403, "forbidden", "Keine Schreibrechte.");
    return;
  }
  const node = access.node;
  const name = parsed.data.name ? safeName(parsed.data.name) : node.name;
  const nextParentId = parsed.data.parentId === void 0 ? node.parent_id : parsed.data.parentId;
  if (nextParentId && nextParentId === node.id) {
    fail(res, 400, "invalid-move", "Ein Ordner kann nicht in sich selbst verschoben werden.");
    return;
  }
  if (nextParentId && await isDescendant(nextParentId, node.id)) {
    fail(res, 400, "invalid-move", "Ein Ordner kann nicht in einen seiner Unterordner.");
    return;
  }
  let parentPath = null;
  if (nextParentId) {
    const target = await nodeAccess(nextParentId, req.userId);
    if (!target || target.node.kind !== "folder") {
      fail(res, 404, "not-found", "Zielordner nicht gefunden.");
      return;
    }
    if (!canWrite(target)) {
      fail(res, 403, "forbidden", "Keine Schreibrechte im Zielordner.");
      return;
    }
    parentPath = target.node.storage_path;
  }
  const finalName = await uniqueName(nextParentId ?? null, name, node.id);
  const oldPath = node.storage_path;
  const newPath = relative(parentPath, finalName);
  if (oldPath !== newPath) {
    await movePath(absolute(oldPath), absolute(newPath));
    await pool.query(
      `UPDATE nodes SET storage_path = $1 || substr(storage_path, length($2) + 1)
        WHERE storage_path LIKE $2 || '/%'`,
      [newPath, oldPath]
    );
  }
  const { rows } = await pool.query(
    `UPDATE nodes SET name = $2, parent_id = $3, storage_path = $4, updated_at = now(),
            position = coalesce($5, position)
      WHERE id = $1 RETURNING *`,
    [node.id, finalName, nextParentId, newPath, parsed.data.position ?? null]
  );
  res.json({ node: toDto(rows[0], req.userId) });
});
nodesRouter.delete("/:id", requireAuth, async (req, res) => {
  const access = await nodeAccess(req.params.id, req.userId);
  if (!access) {
    fail(res, 404, "not-found", "Nicht gefunden.");
    return;
  }
  if (!canWrite(access)) {
    fail(res, 403, "forbidden", "Keine Schreibrechte.");
    return;
  }
  const node = access.node;
  const target = path3.join(TRASH_ROOT, `${node.id}`);
  await fs3.promises.rm(target, { recursive: true, force: true });
  await movePath(absolute(node.storage_path), target);
  await pool.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM nodes WHERE id = $1
       UNION ALL SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
     )
     UPDATE nodes SET trashed_at = now(), trashed_from = parent_id WHERE id IN (SELECT id FROM sub)`,
    [node.id]
  );
  res.json({ ok: true });
});
nodesRouter.get("/trash/list", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM nodes WHERE trashed_at is not null AND owner_id = $1 ORDER BY trashed_at DESC LIMIT 200`,
    [req.userId]
  );
  res.json({ nodes: rows.map((r) => ({ ...toDto(r, req.userId), trashedAt: r.trashed_at })) });
});
nodesRouter.post("/:id/restore", requireAuth, async (req, res) => {
  const node = await loadNode(req.params.id);
  if (!node || node.owner_id !== req.userId) {
    fail(res, 404, "not-found", "Nicht gefunden.");
    return;
  }
  const parent = node.trashed_from ? await loadNode(node.trashed_from) : null;
  const parentPath = parent && !parent.trashed_at ? parent.storage_path : null;
  const name = await uniqueName(parent && !parent.trashed_at ? parent.id : null, node.name, node.id);
  const newPath = relative(parentPath, name);
  await movePath(path3.join(TRASH_ROOT, node.id), absolute(newPath));
  await pool.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM nodes WHERE id = $1
       UNION ALL SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
     )
     UPDATE nodes SET trashed_at = null, trashed_from = null WHERE id IN (SELECT id FROM sub)`,
    [node.id]
  );
  await pool.query("UPDATE nodes SET parent_id = $2, storage_path = $3, name = $4, updated_at = now() WHERE id = $1", [
    node.id,
    parent && !parent.trashed_at ? parent.id : null,
    newPath,
    name
  ]);
  res.json({ ok: true });
});
nodesRouter.delete("/:id/purge", requireAuth, async (req, res) => {
  const node = await loadNode(req.params.id);
  if (!node || node.owner_id !== req.userId || !node.trashed_at) {
    fail(res, 404, "not-found", "Nur eigene Eintr\xE4ge im Papierkorb.");
    return;
  }
  await fs3.promises.rm(path3.join(TRASH_ROOT, node.id), { recursive: true, force: true });
  await pool.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM nodes WHERE id = $1
       UNION ALL SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
     )
     DELETE FROM nodes WHERE id IN (SELECT id FROM sub)`,
    [node.id]
  );
  res.json({ ok: true });
});
nodesRouter.get("/:id/download", requireAuth, async (req, res) => {
  const access = await nodeAccess(req.params.id, req.userId);
  if (!access) {
    fail(res, 404, "not-found", "Nicht gefunden.");
    return;
  }
  const node = access.node;
  const full = absolute(node.storage_path);
  if (!fs3.existsSync(full)) {
    fail(res, 404, "missing", "Datei fehlt im Speicher.");
    return;
  }
  if (node.kind === "file") {
    res.setHeader("Content-Type", node.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(node.name)}"`);
    fs3.createReadStream(full).pipe(res);
    return;
  }
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(node.name)}.zip"`);
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", () => res.destroy());
  archive.pipe(res);
  archive.directory(full, node.name);
  await archive.finalize();
});
nodesRouter.post("/:id/preview-token", requireAuth, async (req, res) => {
  const access = await nodeAccess(req.params.id, req.userId);
  if (!access) {
    fail(res, 404, "not-found", "Nicht gefunden.");
    return;
  }
  const token = jwt2.sign({ uid: req.userId, nid: access.node.id }, process.env.JWT_SECRET || "dev-secret-change-me", {
    expiresIn: "2h"
  });
  res.json({ url: `/api/search/preview/${access.node.id}?t=${token}` });
});
nodesRouter.post("/preview-tokens", requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const urls = {};
  for (const id of ids.slice(0, 200)) {
    const access = await nodeAccess(id, req.userId);
    if (!access || access.node.kind !== "file") continue;
    const token = jwt2.sign({ uid: req.userId, nid: access.node.id }, process.env.JWT_SECRET || "dev-secret-change-me", {
      expiresIn: "2h"
    });
    urls[access.node.id] = `/api/search/preview/${access.node.id}?t=${token}`;
  }
  res.json({ urls });
});
nodesRouter.get("/:id/versions", requireAuth, async (req, res) => {
  const access = await nodeAccess(req.params.id, req.userId);
  if (!access) {
    fail(res, 404, "not-found", "Nicht gefunden.");
    return;
  }
  const { rows } = await pool.query(
    "SELECT id, version, size, created_at FROM file_versions WHERE node_id = $1 ORDER BY created_at DESC",
    [req.params.id]
  );
  res.json({ versions: rows });
});
async function uniqueName(parentId, desired, ignoreId) {
  const base = safeName(desired);
  const ext = path3.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  let candidate = base;
  for (let i = 2; i < 200; i++) {
    const clash = await pool.query(
      `SELECT 1 FROM nodes WHERE parent_id is not distinct from $1 AND lower(name) = lower($2) AND trashed_at is null AND ($3::uuid is null or id <> $3)`,
      [parentId, candidate, ignoreId ?? null]
    );
    if (!clash.rowCount) return candidate;
    candidate = `${stem} (${i})${ext}`;
  }
  return `${stem} (${Date.now()})${ext}`;
}
async function isDescendant(candidate, ancestor) {
  const { rows } = await pool.query(
    `WITH RECURSIVE up AS (
        SELECT id, parent_id FROM nodes WHERE id = $1
        UNION ALL SELECT n.id, n.parent_id FROM nodes n JOIN up u ON n.id = u.parent_id
     ) SELECT 1 FROM up WHERE id = $2 LIMIT 1`,
    [candidate, ancestor]
  );
  return rows.length > 0;
}

// server/uploads.ts
init_db();
init_guards();
import { Router as Router3 } from "express";
import express from "express";
import fs4 from "node:fs";
import path4 from "node:path";
import crypto4 from "node:crypto";
import { z as z3 } from "zod";
var uploadsRouter = Router3();
var CHUNK_LIMIT = "96mb";
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
uploadsRouter.post("/init", requireAuth, async (req, res) => {
  const schema = z3.object({
    parentId: z3.string().uuid().nullable().optional(),
    name: z3.string().min(1).max(180),
    size: z3.number().int().nonnegative().optional(),
    mime: z3.string().max(160).optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", parsed.error.issues[0].message);
    return;
  }
  const parentId = parsed.data.parentId ?? null;
  if (parentId) {
    const access = await nodeAccess(parentId, req.userId);
    if (!access || access.node.kind !== "folder" || !canWrite(access)) {
      fail(res, 403, "forbidden", "Keine Schreibrechte in diesem Ordner.");
      return;
    }
  }
  const id = crypto4.randomUUID();
  await fs4.promises.mkdir(path4.join(TMP_ROOT, id), { recursive: true });
  await pool.query(
    "INSERT INTO upload_sessions (id, user_id, parent_id, name, mime, size) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, req.userId, parentId, safeName(parsed.data.name), parsed.data.mime ?? null, parsed.data.size ?? 0]
  );
  res.status(201).json({ uploadId: id, chunkSize: 8 * 1024 * 1024 });
});
uploadsRouter.put("/text/:id", requireAuth, async (req, res) => {
  const access = await nodeAccess(req.params.id, req.userId);
  if (!access || access.node.kind !== "file" || !canWrite(access)) {
    fail(res, 403, "forbidden", "Keine Schreibrechte.");
    return;
  }
  const content = String(req.body?.content ?? "");
  const size = await writeAtomic(absolute(access.node.storage_path), Buffer.from(content, "utf8"));
  await pool.query("UPDATE nodes SET size = $2, updated_at = now(), version = version + 1 WHERE id = $1", [req.params.id, size]);
  void indexNode(req.params.id).catch(() => void 0);
  res.json({ ok: true, size });
});
uploadsRouter.put(
  "/:id/:index",
  requireAuth,
  express.raw({ type: () => true, limit: CHUNK_LIMIT }),
  async (req, res) => {
    if (!UUID_RE.test(req.params.id)) {
      fail(res, 404, "not-found", "Upload nicht gefunden.");
      return;
    }
    const session = await pool.query("SELECT user_id, chunks FROM upload_sessions WHERE id = $1", [req.params.id]);
    if (!session.rowCount || session.rows[0].user_id !== req.userId) {
      fail(res, 404, "not-found", "Upload nicht gefunden.");
      return;
    }
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) {
      fail(res, 400, "invalid-chunk", "Ung\xFCltiger Teil.");
      return;
    }
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buffer.length) {
      fail(res, 400, "empty-chunk", "Leerer Teil.");
      return;
    }
    await fs4.promises.writeFile(path4.join(TMP_ROOT, req.params.id, String(index).padStart(5, "0")), buffer);
    const count = await fs4.promises.readdir(path4.join(TMP_ROOT, req.params.id));
    await pool.query("UPDATE upload_sessions SET chunks = $2 WHERE id = $1", [req.params.id, count.length]);
    res.json({ received: index, chunks: count.length });
  }
);
uploadsRouter.post("/:id/complete", requireAuth, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    fail(res, 404, "not-found", "Upload nicht gefunden.");
    return;
  }
  const session = await pool.query(
    "SELECT user_id, parent_id, name, mime FROM upload_sessions WHERE id = $1",
    [req.params.id]
  );
  if (!session.rowCount || session.rows[0].user_id !== req.userId) {
    fail(res, 404, "not-found", "Upload nicht gefunden.");
    return;
  }
  const { parent_id: parentId, name, mime } = session.rows[0];
  let parentPath = null;
  if (parentId) {
    const access = await nodeAccess(parentId, req.userId);
    if (!access || !canWrite(access)) {
      fail(res, 403, "forbidden", "Keine Schreibrechte in diesem Ordner.");
      return;
    }
    parentPath = access.node.storage_path;
  }
  const dir = path4.join(TMP_ROOT, req.params.id);
  const parts = (await fs4.promises.readdir(dir)).sort();
  if (!parts.length) {
    fail(res, 400, "empty-upload", "Es sind keine Teile angekommen.");
    return;
  }
  const finalName = await uniqueName2(parentId, name);
  const storagePath = relative(parentPath, finalName);
  const target = absolute(storagePath);
  await fs4.promises.mkdir(path4.dirname(target), { recursive: true });
  const tmpTarget = `${target}.uploading`;
  const out = fs4.createWriteStream(tmpTarget);
  for (const part of parts) {
    await new Promise((resolve, reject) => {
      const input = fs4.createReadStream(path4.join(dir, part));
      input.on("error", reject);
      input.on("end", () => resolve());
      input.pipe(out, { end: false });
    });
  }
  await new Promise((resolve) => out.end(resolve));
  await fs4.promises.rename(tmpTarget, target);
  await fs4.promises.rm(dir, { recursive: true, force: true });
  const stat = await fs4.promises.stat(target);
  const nodeId = crypto4.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO nodes (id, parent_id, name, kind, storage_path, mime, size, owner_id, position)
     VALUES ($1,$2,$3,'file',$4,$5,$6,$7, coalesce((select max(position)+1 from nodes where parent_id is not distinct from $2), 0))
     RETURNING *`,
    [nodeId, parentId, finalName, storagePath, mime || mimeFor(finalName), stat.size, req.userId]
  );
  await pool.query("DELETE FROM upload_sessions WHERE id = $1", [req.params.id]);
  void indexNode(nodeId).catch(() => void 0);
  res.status(201).json({
    node: {
      id: rows[0].id,
      parentId: rows[0].parent_id,
      name: rows[0].name,
      kind: rows[0].kind,
      size: Number(rows[0].size),
      mime: rows[0].mime
    }
  });
});
async function uniqueName2(parentId, desired) {
  const base = safeName(desired);
  const ext = path4.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  let candidate = base;
  for (let i = 2; i < 200; i++) {
    const clash = await pool.query(
      "SELECT 1 FROM nodes WHERE parent_id is not distinct from $1 AND lower(name) = lower($2) AND trashed_at is null",
      [parentId, candidate]
    );
    if (!clash.rowCount) return candidate;
    candidate = `${stem} (${i})${ext}`;
  }
  return `${stem} (${Date.now()})${ext}`;
}

// server/shares.ts
init_db();
init_guards();
import { Router as Router4 } from "express";
import { z as z4 } from "zod";
var sharesRouter = Router4();
sharesRouter.get("/:id", requireAuth, async (req, res) => {
  const access = await nodeAccess(req.params.id, req.userId);
  if (!access || access.level !== "owner") {
    fail(res, 403, "forbidden", "Nur der Eigent\xFCmer sieht die Freigaben.");
    return;
  }
  const { rows } = await pool.query(
    `SELECT s.id, s.permission, u.id AS user_id, u.name, u.email
       FROM shares s JOIN users u ON u.id = s.user_id
      WHERE s.node_id = $1 ORDER BY u.name`,
    [req.params.id]
  );
  res.json({ shares: rows });
});
sharesRouter.post("/:id", requireAuth, async (req, res) => {
  const schema = z4.object({ userId: z4.number().int(), permission: z4.enum(["view", "edit"]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid-input", parsed.error.issues[0].message);
    return;
  }
  const access = await nodeAccess(req.params.id, req.userId);
  if (!access || !canWrite(access)) {
    fail(res, 403, "forbidden", "Keine Schreibrechte.");
    return;
  }
  if (parsed.data.userId === req.userId) {
    fail(res, 400, "self-share", "Du hast als Eigent\xFCmer schon Zugriff.");
    return;
  }
  await pool.query(
    `INSERT INTO shares (node_id, user_id, permission) VALUES ($1,$2,$3)
     ON CONFLICT (node_id, user_id) DO UPDATE SET permission = EXCLUDED.permission`,
    [req.params.id, parsed.data.userId, parsed.data.permission]
  );
  res.json({ ok: true });
});
sharesRouter.delete("/:id/:userId", requireAuth, async (req, res) => {
  const access = await nodeAccess(req.params.id, req.userId);
  if (!access || access.level !== "owner") {
    fail(res, 403, "forbidden", "Nur der Eigent\xFCmer kann Freigaben entfernen.");
    return;
  }
  await pool.query("DELETE FROM shares WHERE node_id = $1 AND user_id = $2", [req.params.id, Number(req.params.userId)]);
  res.json({ ok: true });
});
sharesRouter.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT n.id, n.name, n.kind, s.permission, u.name AS owner_name
       FROM shares s JOIN nodes n ON n.id = s.node_id JOIN users u ON u.id = n.owner_id
      WHERE s.user_id = $1 AND n.trashed_at is null
      ORDER BY n.name`,
    [req.userId]
  );
  res.json({ shared: rows });
});
sharesRouter.get("/users/all", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT id, name, email FROM users WHERE id <> $1 ORDER BY name", [req.userId]);
  res.json({ users: rows });
});

// server/onlyoffice.ts
init_db();
init_guards();
import { Router as Router5 } from "express";
import fs5 from "node:fs";
import path5 from "node:path";
import jwt3 from "jsonwebtoken";
var officeRouter = Router5();
var DS_PUBLIC_URL = (process.env.ONLYOFFICE_URL || "https://office.nas-timgreen.com").replace(/\/+$/, "");
var DS_SECRET = process.env.ONLYOFFICE_JWT_SECRET || "";
var INTERNAL_BASE = (process.env.INTERNAL_BASE_URL || "http://education-planner:3000").replace(/\/+$/, "");
var PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || "https://education-planner.nas-timgreen.com").replace(/\/+$/, "");
var WORD = /* @__PURE__ */ new Set(["docx", "doc", "odt", "rtf", "txt"]);
var CELL = /* @__PURE__ */ new Set(["xlsx", "xls", "ods", "csv"]);
var SLIDE = /* @__PURE__ */ new Set(["pptx", "ppt", "odp"]);
function documentTypeFor(name) {
  const ext = path5.extname(name).toLowerCase().replace(".", "");
  if (WORD.has(ext)) return "word";
  if (CELL.has(ext)) return "cell";
  if (SLIDE.has(ext)) return "slide";
  return null;
}
function signLong(payload, days = 2) {
  return jwt3.sign(payload, DS_SECRET || "office-dev", { expiresIn: `${days}d` });
}
officeRouter.post("/nodes/:id/config", requireAuth, async (req, res) => {
  const access = await nodeAccess(req.params.id, req.userId);
  if (!access || access.node.kind !== "file") {
    fail(res, 404, "not-found", "Datei nicht gefunden.");
    return;
  }
  const node = access.node;
  const documentType = documentTypeFor(node.name);
  if (!documentType) {
    fail(res, 400, "unsupported", "Dieser Dateityp hat keinen Office-Editor.");
    return;
  }
  const ext = path5.extname(node.name).toLowerCase().replace(".", "");
  const fileToken = signLong({ nid: node.id, kind: "file" });
  const callbackToken = signLong({ nid: node.id, kind: "callback" });
  const docKey = `${node.id.replace(/-/g, "")}-v${node.version}`;
  await pool.query(
    `INSERT INTO office_sessions (node_id, doc_key, updated_at) VALUES ($1,$2, now())
     ON CONFLICT (node_id) DO UPDATE SET doc_key = EXCLUDED.doc_key, updated_at = now()`,
    [node.id, docKey]
  );
  const editable = canWrite(access);
  const config = {
    document: {
      fileType: ext,
      key: docKey,
      title: node.name,
      url: `${INTERNAL_BASE}/api/office/file/${node.id}?t=${fileToken}`,
      permissions: {
        edit: editable,
        download: true,
        print: true,
        comment: editable,
        review: editable,
        fillForms: editable
      }
    },
    documentType,
    editorConfig: {
      lang: "de",
      mode: editable ? "edit" : "view",
      // Intern über das Docker-Netz: kein Cloudflare dazwischen (Bot-Schutz würde Callbacks blocken)
      callbackUrl: `${INTERNAL_BASE}/api/office/callback/${node.id}?t=${callbackToken}`,
      user: { id: String(req.userId), name: req.userName || "Nutzer" },
      customization: {
        autosave: true,
        forcesave: true,
        compactHeader: false,
        hideRightMenu: true,
        uiTheme: "theme-dark",
        help: false,
        feedback: false,
        chat: false,
        comments: true,
        spellcheck: true
      }
    },
    width: "100%",
    height: "100%",
    type: "desktop",
    token: ""
  };
  config.token = jwt3.sign({
    document: config.document,
    documentType: config.documentType,
    editorConfig: config.editorConfig
  }, DS_SECRET || "office-dev", { expiresIn: "2h" });
  res.json({ documentServerUrl: DS_PUBLIC_URL, config });
});
officeRouter.get("/office/file/:id", async (req, res) => {
  try {
    const payload = jwt3.verify(String(req.query.t ?? ""), DS_SECRET || "office-dev");
    if (payload.kind !== "file") throw new Error("falscher Token");
    const node = await loadNode(payload.nid);
    if (!node) throw new Error("Datei fehlt");
    const full = absolute(node.storage_path);
    if (!fs5.existsSync(full)) throw new Error("Datei fehlt im Speicher");
    res.setHeader("Content-Type", node.mime || "application/octet-stream");
    fs5.createReadStream(full).pipe(res);
  } catch {
    res.status(403).end();
  }
});
officeRouter.post("/office/callback/:id", async (req, res) => {
  const body = req.body;
  try {
    const query = jwt3.verify(String(req.query.t ?? ""), DS_SECRET || "office-dev");
    if (query.kind !== "callback" || query.nid !== req.params.id) throw new Error("falscher Token");
    if (DS_SECRET && body.token) {
      jwt3.verify(body.token, DS_SECRET, { algorithms: ["HS256"] });
    }
    const node = await loadNode(req.params.id);
    if (!node) throw new Error("Datei fehlt");
    const status = Number(body.status ?? 0);
    await pool.query(
      "UPDATE office_sessions SET last_status = $2, last_saved_at = now(), updated_at = now() WHERE node_id = $1",
      [node.id, status]
    );
    if (status === 2 || status === 6 || status === 3 || status === 7) {
      if (status === 2 || status === 6) {
        const url = String(body.url ?? "");
        if (!url) throw new Error("keine Download-URL");
        let response = await fetch(url);
        if (response.status === 403 && DS_SECRET) {
          const token = jwt3.sign({ url }, DS_SECRET, { expiresIn: "5m" });
          response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        }
        if (!response.ok) throw new Error(`Download fehlgeschlagen: ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) throw new Error("leere Datei");
        await saveVersion(node.id, absolute(node.storage_path), node.version, null, pool);
        const size = await writeAtomic(absolute(node.storage_path), buffer);
        await pool.query(
          "UPDATE nodes SET size = $2, version = version + 1, updated_at = now() WHERE id = $1",
          [node.id, size]
        );
        void indexNode(node.id).catch(() => void 0);
      }
    }
    res.json({ error: 0 });
  } catch (e) {
    res.json({ error: 1, message: e instanceof Error ? e.message : "Fehler" });
  }
});
officeRouter.post("/office/:id/forcesave", requireAuth, async (req, res) => {
  const access = await nodeAccess(req.params.id, req.userId);
  if (!access || access.node.kind !== "file") {
    fail(res, 404, "not-found", "Datei nicht gefunden.");
    return;
  }
  if (!canWrite(access)) {
    fail(res, 403, "forbidden", "Keine Schreibrechte.");
    return;
  }
  const { rows } = await pool.query("SELECT doc_key FROM office_sessions WHERE node_id = $1", [req.params.id]);
  if (!rows.length) {
    res.json({ ok: true, skipped: "kein offener Editor" });
    return;
  }
  const payload = { c: "forcesave", key: rows[0].doc_key };
  const token = jwt3.sign(payload, DS_SECRET || "office-dev", { expiresIn: "5m" });
  try {
    const response = await fetch(`${DS_PUBLIC_URL}/coauthoring/CommandService.ashx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, token })
    });
    const data = await response.json();
    res.json({ ok: data.error === 0, error: data.error ?? null });
  } catch (e) {
    res.json({ ok: false, message: e instanceof Error ? e.message : "Command-Service nicht erreichbar" });
  }
});
officeRouter.get("/nodes/:id/office-status", requireAuth, async (req, res) => {
  const access = await nodeAccess(req.params.id, req.userId);
  if (!access) {
    fail(res, 404, "not-found", "Nicht gefunden.");
    return;
  }
  const { rows } = await pool.query("SELECT last_status, last_saved_at FROM office_sessions WHERE node_id = $1", [req.params.id]);
  res.json({ status: rows[0] ?? null, version: access.node.version });
});

// server/search.ts
init_db();
init_guards();
import { Router as Router6 } from "express";
import fs6 from "node:fs";
import jwt4 from "jsonwebtoken";
var searchRouter = Router6();
searchRouter.get("/", requireAuth, async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) {
    res.json({ results: [] });
    return;
  }
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const { rows } = await pool.query(
    `WITH RECURSIVE shared AS (
        SELECT n.*, s.permission FROM nodes n
          JOIN shares s ON s.node_id = n.id AND s.user_id = $1
         WHERE n.trashed_at IS NULL
      ), down AS (
        SELECT * FROM shared
        UNION ALL
        SELECT n.*, d.permission FROM nodes n JOIN down d ON n.parent_id = d.id WHERE n.trashed_at IS NULL
      ), visible AS (
        SELECT * FROM down
        UNION
        SELECT n.*, 'owner' FROM nodes n WHERE n.owner_id = $1 AND n.trashed_at IS NULL
      )
      SELECT * FROM visible WHERE name ILIKE $2 ORDER BY kind DESC, name ASC LIMIT 40`,
    [req.userId, like]
  );
  const results = rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentId: row.parent_id,
    mime: row.mime,
    size: Number(row.size),
    match: "name",
    snippet: null
  }));
  const { rows: content } = await pool.query(
    `WITH RECURSIVE shared AS (
        SELECT n.*, s.permission FROM nodes n
          JOIN shares s ON s.node_id = n.id AND s.user_id = $1
         WHERE n.trashed_at IS NULL
      ), down AS (
        SELECT * FROM shared
        UNION ALL
        SELECT n.*, d.permission FROM nodes n JOIN down d ON n.parent_id = d.id WHERE n.trashed_at IS NULL
      ), visible AS (
        SELECT * FROM down
        UNION
        SELECT n.*, 'owner' FROM nodes n WHERE n.owner_id = $1 AND n.trashed_at IS NULL
      )
      SELECT v.id, v.name, v.parent_id, v.mime, v.size::text AS size,
             ts_headline('german', t.content, query, 'StartSel=\xAB,StopSel=\xBB,MaxWords=18,MinWords=6') AS excerpt,
             ts_rank(t.tsv, query) AS rank
        FROM visible v
        JOIN node_texts t ON t.node_id = v.id
       CROSS JOIN websearch_to_tsquery('german', $2) AS query
       WHERE v.kind = 'file' AND t.tsv @@ query
       ORDER BY rank DESC
       LIMIT 30`,
    [req.userId, q]
  );
  const indexedHits = content.map((row) => ({
    id: row.id,
    name: row.name,
    kind: "file",
    parentId: row.parent_id,
    mime: row.mime,
    size: Number(row.size),
    match: "content",
    snippet: row.excerpt.replace(/\s+/g, " ").trim()
  }));
  const seen = new Set(results.map((r) => r.id));
  const merged = [...results];
  for (const hit of indexedHits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    merged.push(hit);
  }
  res.json({ results: merged.slice(0, 60), pending: await indexPending() });
});
searchRouter.get("/preview/:id", async (req, res) => {
  const { nodeAccess: nodeAccess2 } = await Promise.resolve().then(() => (init_guards(), guards_exports));
  let userId = Number(req.userId ?? 0);
  if (!userId) {
    try {
      const payload = jwt4.verify(String(req.query.t ?? ""), process.env.JWT_SECRET || "dev-secret-change-me");
      if (payload.nid !== req.params.id) throw new Error("falsche Datei");
      userId = payload.uid;
    } catch {
      fail(res, 401, "unauthorized", "Bitte anmelden.");
      return;
    }
  }
  const access = await nodeAccess2(req.params.id, userId);
  if (!access || access.node.kind !== "file") {
    fail(res, 404, "not-found", "Nicht gefunden.");
    return;
  }
  const full = absolute(access.node.storage_path);
  if (!fs6.existsSync(full)) {
    fail(res, 404, "missing", "Datei fehlt im Speicher.");
    return;
  }
  res.setHeader("Content-Type", access.node.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(access.node.name)}"`);
  fs6.createReadStream(full).pipe(res);
});

// server/index.ts
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason);
});
process.on("uncaughtException", (error) => {
  console.error("uncaughtException", error);
});
var app = express2();
app.use(express2.json({ limit: "2mb" }));
var dist = path6.join(process.cwd(), "dist");
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, storage: fs7.existsSync(process.env.FILES_ROOT || "/data/files") });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : "db" });
  }
});
app.use("/api", attachUser);
app.use("/api/auth", authRouter);
app.use("/api/nodes", nodesRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/shares", sharesRouter);
app.use("/api/search", searchRouter);
app.use("/api", officeRouter);
app.use("/api", (_req, res) => {
  fail(res, 404, "not-found", "Unbekannter Endpunkt.");
});
if (fs7.existsSync(dist)) {
  app.use(express2.static(dist, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => {
    res.sendFile(path6.join(dist, "index.html"));
  });
}
var port = Number(process.env.PORT || 3e3);
async function start() {
  ensureDirs();
  await initDb();
  startIndexer();
  app.listen(port, () => {
    console.log(`education-planner l\xE4uft auf :${port}`);
  });
}
void start().catch((e) => {
  console.error("Start fehlgeschlagen", e);
  process.exit(1);
});
