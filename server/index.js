const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cron = require("node-cron");

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});

const app = express();
const sessions = new Map();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8시간
const loginWindowMs = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const loginMaxAttempts = Number(process.env.LOGIN_RATE_LIMIT_MAX) || 30;

// nginx/ALB 뒤에서 실제 클라이언트 IP를 사용하도록 기본 신뢰 설정
// (직접 노출 환경이면 TRUST_PROXY=false로 끌 수 있음)
app.set("trust proxy", process.env.TRUST_PROXY === "false" ? false : 1);

// 1시간마다 만료 세션 정리
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of sessions) {
    if (now - data.createdAt > SESSION_TTL_MS) sessions.delete(token);
  }
}, 60 * 60 * 1000);

if (process.env.ALLOWED_ORIGINS) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  app.use(cors({ origin: allowedOrigins }));
} else {
  app.use(cors({ origin: false }));
}

app.use(helmet());

app.use(express.json({ limit: "10mb" }));

const clientBuildPath = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientBuildPath));

if (!process.env.ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD 환경변수가 설정되지 않았습니다.");
  process.exit(1);
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL 환경변수가 설정되지 않았습니다.");
  process.exit(1);
}
const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : false,
});

// ─── DB Init ───────────────────────────────────────────────
(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("DB 연결 성공");
  } catch (err) {
    console.error("DB 연결 실패:", err.message);
    process.exit(1);
  }

  // tenants
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id SERIAL PRIMARY KEY,
      floor INTEGER UNIQUE NOT NULL,
      company_name TEXT NOT NULL,
      business_number TEXT,
      representative TEXT,
      business_type TEXT,
      business_item TEXT,
      address TEXT,
      contact_phone TEXT,
      email TEXT,
      password TEXT NOT NULL,
      rent_amount INTEGER NOT NULL DEFAULT 0,
      maintenance_fee INTEGER NOT NULL DEFAULT 0,
      deposit_amount INTEGER NOT NULL DEFAULT 0,
      lease_start DATE,
      lease_end DATE,
      billing_day INTEGER NOT NULL DEFAULT 1,
      payment_type TEXT NOT NULL DEFAULT 'prepaid',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // payment_type 컬럼이 없으면 추가
  await pool.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'prepaid'
  `).catch(() => {});

  // billing_day 컬럼이 없으면 추가 (기존 DB 마이그레이션)
  await pool.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_day INTEGER NOT NULL DEFAULT 1
  `);
  // 최초 비밀번호(예: 0001) 사용 여부 플래그
  await pool.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN
  `);
  // 기존 데이터 보정: 기본 비밀번호(층수 4자리)면 변경 필요로 설정
  await pool.query(`
    UPDATE tenants
    SET must_change_password = CASE
      WHEN password = LPAD(floor::text, 4, '0') THEN TRUE
      ELSE FALSE
    END
    WHERE must_change_password IS NULL
  `);
  await pool.query(`
    ALTER TABLE tenants ALTER COLUMN must_change_password SET DEFAULT TRUE
  `);
  await pool.query(`
    ALTER TABLE tenants ALTER COLUMN must_change_password SET NOT NULL
  `);

  // monthly_bills
  await pool.query(`
    CREATE TABLE IF NOT EXISTS monthly_bills (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      rent_amount INTEGER NOT NULL DEFAULT 0,
      maintenance_fee INTEGER NOT NULL DEFAULT 0,
      gas_amount INTEGER NOT NULL DEFAULT 0,
      electricity_amount INTEGER NOT NULL DEFAULT 0,
      water_amount INTEGER NOT NULL DEFAULT 0,
      rent_paid BOOLEAN DEFAULT FALSE,
      maintenance_paid BOOLEAN DEFAULT FALSE,
      gas_paid BOOLEAN DEFAULT FALSE,
      electricity_paid BOOLEAN DEFAULT FALSE,
      water_paid BOOLEAN DEFAULT FALSE,
      rent_paid_date DATE,
      maintenance_paid_date DATE,
      gas_paid_date DATE,
      electricity_paid_date DATE,
      water_paid_date DATE,
      memo TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, year, month)
    )
  `);

  // meter_readings
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meter_readings (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      utility_type TEXT NOT NULL,
      reading_value NUMERIC(12,2),
      photo BYTEA,
      photo_filename TEXT,
      uploaded_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, year, month, utility_type)
    )
  `);

  // building_bills
  await pool.query(`
    CREATE TABLE IF NOT EXISTS building_bills (
      id SERIAL PRIMARY KEY,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      gas_total INTEGER NOT NULL DEFAULT 0,
      electricity_total INTEGER NOT NULL DEFAULT 0,
      water_total INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(year, month)
    )
  `);

  // settings
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Insert default settings
  const defaultSettings = [
    ["building_name", "건물명"],
    ["landlord_name", "관리자명"],
    ["landlord_business_number", ""],
    ["landlord_phone", ""],
    ["bank_name", ""],
    ["bank_account", ""],
    ["bank_holder", ""],
    ["sms_api_key", ""],
    ["sms_sender_number", ""],
  ];
  for (const [k, v] of defaultSettings) {
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
      [k, v]
    );
  }

  // tax_invoices (항목별 개별 발행: item_type = rent/maintenance/electricity/water)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tax_invoices (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      item_type TEXT NOT NULL DEFAULT 'rent',
      supply_amount INTEGER NOT NULL,
      tax_amount INTEGER NOT NULL,
      total_amount INTEGER NOT NULL,
      issued_date DATE,
      is_issued BOOLEAN DEFAULT FALSE,
      memo TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Migration: 기존 테이블에 item_type 컬럼 추가
  try { await pool.query("ALTER TABLE tax_invoices ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'rent'"); } catch {}
  // 기존 UNIQUE(tenant_id, year, month) 제약조건 제거
  try { await pool.query("ALTER TABLE tax_invoices DROP CONSTRAINT IF EXISTS tax_invoices_tenant_id_year_month_key"); } catch {}
  // 새 UNIQUE INDEX 생성
  try { await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_inv_unique ON tax_invoices (tenant_id, year, month, item_type)"); } catch {}

  // inquiries (문의/고장신고)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      floor INTEGER NOT NULL,
      company_name TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      is_resolved BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("테이블 초기화 완료");

  // ─── Auth Routes ──────────────────────────────────────────
  const loginLimiter = rateLimit({
    windowMs: loginWindowMs,
    max: loginMaxAttempts,
    message: { error: "너무 많은 로그인 시도입니다. 잠시 후 다시 시도하세요" },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      const ip = req.ip || req.socket?.remoteAddress || "unknown-ip";
      const body = req.body || {};
      const account = body.isAdmin
        ? "admin"
        : String(body.companyName || "").trim().toLowerCase() || "tenant";
      return `${ip}:${account}`;
    },
  });

  // Login
  app.post("/login", loginLimiter, async (req, res) => {
    const { isAdmin, password, companyName, tenantPassword } = req.body;

    if (isAdmin) {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "관리자 비밀번호가 올바르지 않습니다" });
      }
      const token = crypto.randomUUID();
      sessions.set(token, { id: "admin", name: "관리자", role: "admin", createdAt: Date.now() });
      return res.json({ id: "admin", name: "관리자", role: "admin", token });
    }

    // Tenant login
    if (!companyName || !tenantPassword) {
      return res.status(400).json({ error: "업체명과 비밀번호를 입력하세요" });
    }
    try {
      const { rows } = await pool.query(
        "SELECT * FROM tenants WHERE company_name = $1 AND password = $2 AND is_active = TRUE",
        [companyName.trim(), tenantPassword]
      );
      if (rows.length === 0) {
        return res.status(401).json({ error: "로그인 실패: 업체명 또는 비밀번호를 확인하세요" });
      }
      const tenant = rows[0];
      const token = crypto.randomUUID();
      sessions.set(token, {
        id: tenant.id,
        name: tenant.company_name,
        floor: tenant.floor,
        role: "tenant",
        mustChangePassword: !!tenant.must_change_password,
        createdAt: Date.now(),
      });
      return res.json({
        id: tenant.id,
        name: tenant.company_name,
        floor: tenant.floor,
        role: "tenant",
        mustChangePassword: !!tenant.must_change_password,
        token,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // Logout
  app.post("/logout", (req, res) => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith("Bearer ")) {
      sessions.delete(auth.slice(7));
    }
    res.json({ success: true });
  });

  // ─── Photo endpoint (auth 미들웨어 앞: img src에서 query token 사용) ──
  app.get("/meter-readings/:id/photo", (req, res, next) => {
    // header 또는 query token 인증
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : req.query.token;
    if (!token) return res.status(401).json({ error: "인증이 필요합니다" });
    const user = sessions.get(token);
    if (!user) return res.status(401).json({ error: "세션이 만료되었습니다" });
    if (Date.now() - user.createdAt > SESSION_TTL_MS) {
      sessions.delete(token);
      return res.status(401).json({ error: "세션이 만료되었습니다" });
    }
    req.user = user;
    next();
  }, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT photo, photo_filename, tenant_id FROM meter_readings WHERE id = $1", [req.params.id]);
      if (rows.length === 0 || !rows[0].photo) {
        return res.status(404).json({ error: "사진이 없습니다" });
      }
      if (req.user.role === "tenant" && rows[0].tenant_id !== req.user.id) {
        return res.status(403).json({ error: "권한이 없습니다" });
      }
      const buf = rows[0].photo;
      const filename = rows[0].photo_filename || "photo.jpg";
      const ext = filename.split(".").pop().toLowerCase();
      const mimeMap = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
      res.set("Content-Type", mimeMap[ext] || "image/jpeg");
      res.send(buf);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // ─── Auth Middleware ──────────────────────────────────────
  app.use((req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ error: "인증이 필요합니다" });
    }
    const token = auth.slice(7);
    const user = sessions.get(token);
    if (!user) {
      return res.status(401).json({ error: "세션이 만료되었습니다" });
    }
    if (Date.now() - user.createdAt > SESSION_TTL_MS) {
      sessions.delete(token);
      return res.status(401).json({ error: "세션이 만료되었습니다" });
    }
    req.user = user;
    next();
  });

  app.use((req, res, next) => {
    if (req.user.role !== "tenant") return next();
    if (!req.user.mustChangePassword) return next();
    if (req.method === "POST" && req.path === "/tenants/me/password") return next();
    return res.status(403).json({
      error: "초기 비밀번호를 변경한 뒤 이용할 수 있습니다",
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  });

  function requireAdmin(req, res, next) {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }
    next();
  }

  // ─── Tenants API ──────────────────────────────────────────
  app.get("/tenants", async (req, res) => {
    try {
      if (req.user.role === "tenant") {
      const { rows } = await pool.query("SELECT * FROM tenants WHERE id = $1", [req.user.id]);
      return res.json(rows);
      }
      const { rows } = await pool.query("SELECT * FROM tenants ORDER BY floor ASC");
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.post("/tenants", requireAdmin, async (req, res) => {
    const { floor, company_name, business_number, representative, business_type, business_item, address, contact_phone, email, password, rent_amount, maintenance_fee, deposit_amount, lease_start, lease_end, billing_day, payment_type } = req.body;
    if (!floor || !company_name) {
      return res.status(400).json({ error: "층수와 업체명은 필수입니다" });
    }
    try {
      const { rows: dup } = await pool.query("SELECT id FROM tenants WHERE floor = $1", [floor]);
      if (dup.length > 0) {
        return res.status(409).json({ error: "해당 층에 이미 입주사가 등록되어 있습니다" });
      }
      const pw = password || String(floor).padStart(4, "0");
      const { rows } = await pool.query(
        `INSERT INTO tenants (floor, company_name, business_number, representative, business_type, business_item, address, contact_phone, email, password, rent_amount, maintenance_fee, deposit_amount, lease_start, lease_end, billing_day, payment_type, must_change_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,TRUE) RETURNING id`,
        [floor, company_name, business_number || null, representative || null, business_type || null, business_item || null, address || null, contact_phone || null, email || null, pw, rent_amount || 0, maintenance_fee || 0, deposit_amount || 0, lease_start || null, lease_end || null, billing_day || 1, payment_type || 'prepaid']
      );
      res.json({ id: rows[0].id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.put("/tenants/:id", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { floor, company_name, business_number, representative, business_type, business_item, address, contact_phone, email, password, rent_amount, maintenance_fee, deposit_amount, lease_start, lease_end, is_active, billing_day, payment_type } = req.body;
    try {
      // Check floor conflict
      if (floor) {
        const { rows: dup } = await pool.query("SELECT id FROM tenants WHERE floor = $1 AND id != $2", [floor, id]);
        if (dup.length > 0) {
          return res.status(409).json({ error: "해당 층에 이미 다른 입주사가 있습니다" });
        }
      }
      await pool.query(
        `UPDATE tenants SET
          floor = COALESCE($1, floor),
          company_name = COALESCE($2, company_name),
          business_number = $3,
          representative = $4,
          business_type = $5,
          business_item = $6,
          address = $7,
          contact_phone = $8,
          email = $9,
          password = COALESCE(NULLIF($10,''), password),
          must_change_password = CASE
            WHEN NULLIF($10,'') IS NULL THEN must_change_password
            ELSE TRUE
          END,
          rent_amount = COALESCE($11, rent_amount),
          maintenance_fee = COALESCE($12, maintenance_fee),
          deposit_amount = COALESCE($13, deposit_amount),
          lease_start = $14,
          lease_end = $15,
          is_active = COALESCE($16, is_active),
          billing_day = COALESCE($17, billing_day),
          payment_type = COALESCE($18, payment_type)
        WHERE id = $19`,
        [floor, company_name, business_number ?? null, representative ?? null, business_type ?? null, business_item ?? null, address ?? null, contact_phone ?? null, email ?? null, password || "", rent_amount, maintenance_fee, deposit_amount, lease_start || null, lease_end || null, is_active, billing_day, payment_type, id]
      );
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.delete("/tenants/:id", requireAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM tenants WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.post("/tenants/me/password", async (req, res) => {
    if (req.user.role !== "tenant") {
      return res.status(403).json({ error: "입주사 계정만 사용할 수 있습니다" });
    }
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "현재 비밀번호와 새 비밀번호를 입력하세요" });
    }
    if (String(newPassword).trim().length < 4) {
      return res.status(400).json({ error: "새 비밀번호는 4자리 이상 입력하세요" });
    }
    try {
      const { rows } = await pool.query("SELECT password FROM tenants WHERE id = $1", [req.user.id]);
      if (rows.length === 0) return res.status(404).json({ error: "입주사 정보를 찾을 수 없습니다" });
      if (rows[0].password !== currentPassword) {
        return res.status(401).json({ error: "현재 비밀번호가 올바르지 않습니다" });
      }
      await pool.query(
        "UPDATE tenants SET password = $1, must_change_password = FALSE WHERE id = $2",
        [String(newPassword), req.user.id]
      );
      req.user.mustChangePassword = false;
      return res.json({ success: true, mustChangePassword: false });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // ─── Settings API ─────────────────────────────────────────
  app.get("/settings", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM settings ORDER BY key");
      const obj = {};
      const sensitiveKeys = ["sms_api_key", "sms_sender_number"];
      rows.forEach((r) => {
        if (req.user.role !== "admin" && sensitiveKeys.includes(r.key)) return;
        obj[r.key] = r.value;
      });
      res.json(obj);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.put("/settings", requireAdmin, async (req, res) => {
    try {
      const entries = Object.entries(req.body);
      for (const [k, v] of entries) {
        await pool.query(
          "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
          [k, String(v)]
        );
      }
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // ─── Meter Readings API ───────────────────────────────────
  app.get("/meter-readings", async (req, res) => {
    const { year, month } = req.query;
    try {
      let query, params;
      if (req.user.role === "tenant") {
        query = "SELECT mr.*, t.floor, t.company_name FROM meter_readings mr JOIN tenants t ON mr.tenant_id = t.id WHERE mr.tenant_id = $1";
        params = [req.user.id];
        if (year && month) {
          query += " AND mr.year = $2 AND mr.month = $3";
          params.push(Number(year), Number(month));
        }
      } else {
        query = "SELECT mr.*, t.floor, t.company_name FROM meter_readings mr JOIN tenants t ON mr.tenant_id = t.id WHERE 1=1";
        params = [];
        if (year && month) {
          query += ` AND mr.year = $${params.length + 1} AND mr.month = $${params.length + 2}`;
          params.push(Number(year), Number(month));
        }
      }
      query += " ORDER BY t.floor ASC, mr.utility_type ASC";
      const { rows } = await pool.query(query, params);
      // Strip photo BYTEA from list response
      const result = rows.map(({ photo, ...rest }) => rest);
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.post("/meter-readings", async (req, res) => {
    const { tenant_id, year, month, utility_type, photo_base64, photo_filename, reading_value } = req.body;
    try {
      // Tenant can only upload for themselves
      const targetTenantId = req.user.role === "tenant" ? req.user.id : tenant_id;
      if (!targetTenantId || !year || !month || !utility_type) {
        return res.status(400).json({ error: "필수 항목 누락" });
      }

      let photoBuf = null;
      let safeName = null;
      if (photo_base64) {
        const base64Data = photo_base64.replace(/^data:[^;]+;base64,/, "");
        photoBuf = Buffer.from(base64Data, "base64");

        // 5MB 제한
        if (photoBuf.length > 5 * 1024 * 1024) {
          return res.status(400).json({ error: "파일 크기는 5MB 이하여야 합니다" });
        }

        // 매직 바이트로 이미지 타입 확인
        const isJpeg = photoBuf[0] === 0xFF && photoBuf[1] === 0xD8 && photoBuf[2] === 0xFF;
        const isPng = photoBuf[0] === 0x89 && photoBuf[1] === 0x50 && photoBuf[2] === 0x4E && photoBuf[3] === 0x47;
        if (!isJpeg && !isPng) {
          return res.status(400).json({ error: "JPEG 또는 PNG 이미지만 업로드 가능합니다" });
        }
      }

      // 파일명 sanitize
      if (photo_filename) {
        safeName = path.basename(photo_filename).replace(/[^a-zA-Z0-9가-힣._-]/g, "_");
      }

      const now = new Date().toISOString();
      const { rows } = await pool.query(
        `INSERT INTO meter_readings (tenant_id, year, month, utility_type, reading_value, photo, photo_filename, uploaded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, year, month, utility_type)
         DO UPDATE SET photo = COALESCE($6, meter_readings.photo),
                       photo_filename = COALESCE($7, meter_readings.photo_filename),
                       uploaded_at = CASE WHEN $6 IS NOT NULL THEN $8 ELSE meter_readings.uploaded_at END,
                       reading_value = COALESCE($5, meter_readings.reading_value)
         RETURNING id`,
        [targetTenantId, year, month, utility_type, reading_value ?? null, photoBuf, safeName, now]
      );
      res.json({ id: rows[0].id });

      // 사진 업로드 시 텔레그램 알림
      if (photoBuf) {
        const UTILITY_LABEL = { electricity: "⚡ 전기", water: "💧 수도" };
        const { rows: tenantRows } = await pool.query(
          "SELECT floor, company_name FROM tenants WHERE id = $1", [targetTenantId]
        );
        if (tenantRows.length > 0) {
          const t = tenantRows[0];
          const kstNow = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
          await sendTelegramAlert(
            `📷 <b>검침 사진 업로드</b>\n📍 ${t.floor}층 ${t.company_name}\n${UTILITY_LABEL[utility_type] || utility_type}\n📅 ${year}년 ${month}월\n🕐 ${kstNow}`
          );
        }
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.put("/meter-readings/:id", requireAdmin, async (req, res) => {
    const { reading_value } = req.body;
    try {
      await pool.query("UPDATE meter_readings SET reading_value = $1 WHERE id = $2", [reading_value, req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // photo endpoint는 auth 미들웨어 위에 정의됨 (query token 지원)

  // 사진 삭제 (건물주 전용)
  app.delete("/meter-readings/:id/photo", requireAdmin, async (req, res) => {
    try {
      await pool.query(
        "UPDATE meter_readings SET photo = NULL, photo_filename = NULL, uploaded_at = NULL WHERE id = $1",
        [req.params.id]
      );
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // ─── Building Bills API ───────────────────────────────────
  app.get("/building-bills", async (req, res) => {
    const { year, month } = req.query;
    try {
      let query = "SELECT * FROM building_bills WHERE 1=1";
      const params = [];
      if (year && month) {
        query += ` AND year = $${params.length + 1} AND month = $${params.length + 2}`;
        params.push(Number(year), Number(month));
      }
      query += " ORDER BY year DESC, month DESC";
      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.post("/building-bills", requireAdmin, async (req, res) => {
    const { year, month, electricity_total, water_total } = req.body;
    if (!year || !month) {
      return res.status(400).json({ error: "연도와 월은 필수입니다" });
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO building_bills (year, month, electricity_total, water_total)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (year, month) DO UPDATE SET electricity_total=$3, water_total=$4
         RETURNING id`,
        [year, month, electricity_total || 0, water_total || 0]
      );
      res.json({ id: rows[0].id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // ─── Monthly Bills API ────────────────────────────────────
  app.get("/monthly-bills", async (req, res) => {
    const { year, month } = req.query;
    try {
      let query = "SELECT mb.*, t.floor, t.company_name FROM monthly_bills mb JOIN tenants t ON mb.tenant_id = t.id WHERE 1=1";
      const params = [];
      if (req.user.role === "tenant") {
        query += ` AND mb.tenant_id = $${params.length + 1}`;
        params.push(req.user.id);
      }
      if (year && month) {
        query += ` AND mb.year = $${params.length + 1} AND mb.month = $${params.length + 2}`;
        params.push(Number(year), Number(month));
      }
      query += " ORDER BY t.floor ASC";
      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.delete("/monthly-bills", requireAdmin, async (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "삭제할 청구서 IDs가 필요합니다" });
    }
    const normalizedIds = ids
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0);
    if (normalizedIds.length === 0) {
      return res.status(400).json({ error: "유효한 IDs가 없습니다" });
    }
    try {
      const { rowCount } = await pool.query(
        "DELETE FROM monthly_bills WHERE id = ANY($1::int[])",
        [normalizedIds]
      );
      return res.json({ success: true, deleted: rowCount });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // Generate monthly bills (auto-distribute utility costs)
  app.post("/monthly-bills/generate", requireAdmin, async (req, res) => {
    const { year, month } = req.body;
    if (!year || !month) {
      return res.status(400).json({ error: "연도와 월은 필수입니다" });
    }
    try {
      // Get active tenants
      const { rows: tenants } = await pool.query("SELECT * FROM tenants WHERE is_active = TRUE ORDER BY floor ASC");
      if (tenants.length === 0) {
        return res.status(400).json({ error: "활성 입주사가 없습니다" });
      }

      // Get building bills
      const { rows: bbRows } = await pool.query("SELECT * FROM building_bills WHERE year=$1 AND month=$2", [year, month]);
      const buildingBill = bbRows[0] || { electricity_total: 0, water_total: 0 };

      // Distribute utility costs — reading_value를 해당 월 사용량으로 직접 사용
      // 홀수달: 전기+수도, 짝수달: 전기만
      const isWaterMonth = month % 2 === 1;
      const utilityTypes = isWaterMonth ? ["electricity", "water"] : ["electricity"];
      const totalFields = { electricity: "electricity_total", water: "water_total" };
      const amountFields = { electricity: "electricity_amount", water: "water_amount" };

      const distribution = {};
      tenants.forEach((t) => {
        distribution[t.id] = { electricity_amount: 0, water_amount: isWaterMonth ? 0 : undefined };
      });

      for (const utype of utilityTypes) {
        const totalCost = buildingBill[totalFields[utype]] || 0;
        if (totalCost === 0) continue;

        // 해당 월 사용량 조회
        const { rows: readings } = await pool.query(
          "SELECT tenant_id, reading_value FROM meter_readings WHERE year=$1 AND month=$2 AND utility_type=$3",
          [year, month, utype]
        );

        const usages = [];
        let totalUsage = 0;
        for (const t of tenants) {
          const reading = readings.find((r) => r.tenant_id === t.id);
          const usage = reading?.reading_value != null ? parseFloat(reading.reading_value) : null;
          usages.push({ tenantId: t.id, usage });
          if (usage != null) totalUsage += usage;
        }

        // Distribute
        const validUsages = usages.filter((u) => u.usage !== null && u.usage > 0);
        if (validUsages.length === 0) {
          // 사용량 미입력: 균등 배분
          const share = Math.round(totalCost / tenants.length);
          let allocated = 0;
          tenants.forEach((t, idx) => {
            if (idx === tenants.length - 1) {
              distribution[t.id][amountFields[utype]] = totalCost - allocated;
            } else {
              distribution[t.id][amountFields[utype]] = share;
              allocated += share;
            }
          });
        } else {
          // 사용량 비례 배분
          let allocated = 0;
          validUsages.forEach((u, idx) => {
            if (idx === validUsages.length - 1) {
              distribution[u.tenantId][amountFields[utype]] = totalCost - allocated;
            } else {
              const amount = Math.round(totalCost * (u.usage / totalUsage));
              distribution[u.tenantId][amountFields[utype]] = amount;
              allocated += amount;
            }
          });
        }
      }

      // Upsert: 기존 청구서가 있으면 공과금만 업데이트, 없으면 임대료/관리비 포함 생성
      let updated = 0;
      for (const t of tenants) {
        const d = distribution[t.id];
        if (isWaterMonth) {
          await pool.query(
            `INSERT INTO monthly_bills (tenant_id, year, month, rent_amount, maintenance_fee, electricity_amount, water_amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (tenant_id, year, month) DO UPDATE SET
               electricity_amount=$6, water_amount=$7`,
            [t.id, year, month, t.rent_amount, t.maintenance_fee, d.electricity_amount, d.water_amount]
          );
        } else {
          await pool.query(
            `INSERT INTO monthly_bills (tenant_id, year, month, rent_amount, maintenance_fee, electricity_amount, water_amount)
             VALUES ($1,$2,$3,$4,$5,$6,0)
             ON CONFLICT (tenant_id, year, month) DO UPDATE SET
               electricity_amount=$6, water_amount=0`,
            [t.id, year, month, t.rent_amount, t.maintenance_fee, d.electricity_amount]
          );
        }
        updated++;
      }
      res.json({ created: updated, message: `${updated}건 공과금 배분 완료` });

      await sendTelegramAlert(
        `📋 <b>공과금 배분 완료</b>\n📅 ${year}년 ${month}월\n✅ ${updated}건 청구서 업데이트`
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // Toggle payment status
  app.patch("/monthly-bills/:id/pay", requireAdmin, async (req, res) => {
    const { field } = req.body; // e.g. 'rent_paid', 'gas_paid', etc.
    const validFields = ["rent_paid", "maintenance_paid", "electricity_paid", "water_paid"];
    if (!validFields.includes(field)) {
      return res.status(400).json({ error: "잘못된 필드입니다" });
    }
    const dateField = field.replace("_paid", "_paid_date");
    try {
      const { rows } = await pool.query(`SELECT ${field} FROM monthly_bills WHERE id = $1`, [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: "청구서를 찾을 수 없습니다" });
      const currentVal = rows[0][field];
      const newVal = !currentVal;
      const today = new Date().toISOString().split("T")[0];
      await pool.query(
        `UPDATE monthly_bills SET ${field} = $1, ${dateField} = $2 WHERE id = $3`,
        [newVal, newVal ? today : null, req.params.id]
      );
      res.json({ success: true, [field]: newVal });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // ─── Tax Invoices API (항목별 개별 발행) ─────────────────
  const ITEM_TYPES = [
    { type: "rent", name: "임대료", amountField: "rent_amount" },
    { type: "maintenance", name: "관리비", amountField: "maintenance_fee" },
    { type: "electricity", name: "전기", amountField: "electricity_amount" },
    { type: "water", name: "수도", amountField: "water_amount" },
  ];

  app.get("/tax-invoices", async (req, res) => {
    const { year, month } = req.query;
    try {
      // 1) 월별 청구서 조회
      let billQuery = `
        SELECT mb.id as bill_id, mb.tenant_id, mb.year, mb.month,
               mb.rent_amount, mb.maintenance_fee, mb.electricity_amount, mb.water_amount,
               t.floor, t.company_name, t.business_number, t.representative, t.address
        FROM monthly_bills mb
        JOIN tenants t ON mb.tenant_id = t.id WHERE 1=1`;
      const params = [];
      if (req.user.role === "tenant") {
        billQuery += ` AND mb.tenant_id = $${params.length + 1}`;
        params.push(req.user.id);
      }
      if (year && month) {
        billQuery += ` AND mb.year = $${params.length + 1} AND mb.month = $${params.length + 2}`;
        params.push(Number(year), Number(month));
      }
      billQuery += " ORDER BY t.floor ASC";
      const { rows: bills } = await pool.query(billQuery, params);

      // 2) 세금계산서 발행 이력 조회
      let taxQuery = "SELECT * FROM tax_invoices WHERE 1=1";
      const taxParams = [];
      if (req.user.role === "tenant") {
        taxQuery += ` AND tenant_id = $${taxParams.length + 1}`;
        taxParams.push(req.user.id);
      }
      if (year && month) {
        taxQuery += ` AND year = $${taxParams.length + 1} AND month = $${taxParams.length + 2}`;
        taxParams.push(Number(year), Number(month));
      }
      const { rows: taxRecords } = await pool.query(taxQuery, taxParams);

      // 3) 항목별 개별 세금계산서 생성
      const result = [];
      for (const bill of bills) {
        for (const { type, name, amountField } of ITEM_TYPES) {
          const amount = bill[amountField] || 0;
          if (amount <= 0) continue;
          const taxRecord = taxRecords.find((t) =>
            t.tenant_id === bill.tenant_id && t.year === bill.year && t.month === bill.month && t.item_type === type
          );
          const taxAmount = Math.round(amount * 0.1);
          result.push({
            bill_id: bill.bill_id,
            tenant_id: bill.tenant_id,
            year: bill.year,
            month: bill.month,
            floor: bill.floor,
            company_name: bill.company_name,
            business_number: bill.business_number || "",
            representative: bill.representative || "",
            address: bill.address || "",
            item_type: type,
            item_name: name,
            supply_amount: amount,
            tax_amount: taxAmount,
            total_amount: amount + taxAmount,
            tax_id: taxRecord?.id,
            is_issued: taxRecord?.is_issued || false,
            issued_date: taxRecord?.issued_date,
          });
        }
      }
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // Toggle issue status per item (발행대기 ↔ 발행완료)
  app.patch("/tax-invoices/:billId/issue", requireAdmin, async (req, res) => {
    const { billId } = req.params;
    const { item_type } = req.body;
    if (!item_type) return res.status(400).json({ error: "item_type 필수" });
    try {
      const { rows: bills } = await pool.query("SELECT tenant_id, year, month FROM monthly_bills WHERE id = $1", [billId]);
      if (bills.length === 0) return res.status(404).json({ error: "청구서를 찾을 수 없습니다" });
      const { tenant_id, year, month } = bills[0];
      const today = new Date().toISOString().split("T")[0];

      const { rows: existing } = await pool.query(
        "SELECT id, is_issued FROM tax_invoices WHERE tenant_id=$1 AND year=$2 AND month=$3 AND item_type=$4",
        [tenant_id, year, month, item_type]
      );

      if (existing.length === 0) {
        await pool.query(
          `INSERT INTO tax_invoices (tenant_id, year, month, item_type, supply_amount, tax_amount, total_amount, is_issued, issued_date)
           VALUES ($1,$2,$3,$4,0,0,0,TRUE,$5)`,
          [tenant_id, year, month, item_type, today]
        );
        return res.json({ success: true, is_issued: true });
      }

      const newVal = !existing[0].is_issued;
      await pool.query(
        "UPDATE tax_invoices SET is_issued = $1, issued_date = $2 WHERE id = $3",
        [newVal, newVal ? today : null, existing[0].id]
      );
      res.json({ success: true, is_issued: newVal });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // Download settings (for tax invoice CSV: landlord info)
  app.get("/tax-invoices/download-info", requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM settings");
      const settings = {};
      rows.forEach((r) => (settings[r.key] = r.value));
      res.json(settings);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // ─── SMS API (placeholder) ────────────────────────────────
  app.post("/sms/remind-meter", requireAdmin, async (req, res) => {
    const { year, month } = req.body;
    try {
      // Find tenants who haven't uploaded all 3 meter photos
      const { rows: tenants } = await pool.query("SELECT * FROM tenants WHERE is_active = TRUE ORDER BY floor");
      const { rows: readings } = await pool.query(
        "SELECT tenant_id, utility_type FROM meter_readings WHERE year=$1 AND month=$2 AND photo IS NOT NULL",
        [year, month]
      );
      const uploadedMap = {};
      readings.forEach((r) => {
        if (!uploadedMap[r.tenant_id]) uploadedMap[r.tenant_id] = new Set();
        uploadedMap[r.tenant_id].add(r.utility_type);
      });

      // 홀수달: 전기+수도(2장), 짝수달: 전기만(1장)
      const requiredCount = month % 2 === 1 ? 2 : 1;
      const targets = tenants.filter((t) => {
        const uploaded = uploadedMap[t.id];
        return !uploaded || uploaded.size < requiredCount;
      });

      if (targets.length === 0) {
        return res.json({ sent: 0, message: "모든 입주사가 사진을 업로드했습니다" });
      }

      // TODO: Integrate with actual SMS API (coolsms/aligo)
      const targetInfo = targets.map((t) => ({
        floor: t.floor,
        company: t.company_name,
        phone: t.contact_phone,
        missing: requiredCount - (uploadedMap[t.id]?.size || 0),
      }));

      res.json({
        sent: targets.length,
        message: `${targets.length}개 업체에 알림 발송 (SMS API 미연동 — 대상 목록 반환)`,
        targets: targetInfo,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.post("/sms/remind-payment", requireAdmin, async (req, res) => {
    const { year, month } = req.body;
    try {
      const { rows: bills } = await pool.query(
        `SELECT mb.*, t.floor, t.company_name, t.contact_phone FROM monthly_bills mb
         JOIN tenants t ON mb.tenant_id = t.id
         WHERE mb.year=$1 AND mb.month=$2
         AND (mb.rent_paid = FALSE OR mb.maintenance_paid = FALSE OR mb.electricity_paid = FALSE OR mb.water_paid = FALSE)`,
        [year, month]
      );

      if (bills.length === 0) {
        return res.json({ sent: 0, message: "미납 입주사가 없습니다" });
      }

      const targetInfo = bills.map((b) => {
        const unpaid = [];
        if (!b.rent_paid && b.rent_amount > 0) unpaid.push("임대료");
        if (!b.maintenance_paid && b.maintenance_fee > 0) unpaid.push("관리비");
        if (!b.electricity_paid && b.electricity_amount > 0) unpaid.push("전기");
        if (!b.water_paid && b.water_amount > 0) unpaid.push("수도");
        return { floor: b.floor, company: b.company_name, phone: b.contact_phone, unpaid };
      });

      res.json({
        sent: bills.length,
        message: `${bills.length}개 업체에 미납 알림 발송 (SMS API 미연동 — 대상 목록 반환)`,
        targets: targetInfo,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // ─── Auto Bill Generation ─────────────────────────────────
  // 매월 말일에 전체 활성 입주사의 다음달 임대료+관리비 자동 생성 (공과금은 수동 배분)
  async function autoGenerateRentBills() {
    try {
      // KST 기준 오늘 날짜
      const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));

      // 말일 체크: 내일이 1일이면 오늘이 말일
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      if (tomorrow.getDate() !== 1) return;

      // 다음 달 연/월 계산
      let billYear = now.getFullYear();
      let billMonth = now.getMonth() + 2; // getMonth()는 0-indexed → +1이 현재월, +2가 다음달
      if (billMonth > 12) { billMonth = 1; billYear++; }

      const { rows: tenants } = await pool.query(
        "SELECT * FROM tenants WHERE is_active = TRUE"
      );
      if (tenants.length === 0) return;

      let created = 0;
      for (const t of tenants) {
        const { rowCount } = await pool.query(
          `INSERT INTO monthly_bills (tenant_id, year, month, rent_amount, maintenance_fee)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, year, month) DO NOTHING`,
          [t.id, billYear, billMonth, t.rent_amount, t.maintenance_fee]
        );
        if (rowCount > 0) created++;
      }
      if (created > 0) {
        console.log(`[자동청구] ${billYear}년 ${billMonth}월 임대료/관리비 ${created}건 생성`);
        await sendTelegramAlert(
          `📋 <b>청구서 자동발행</b>\n📅 ${billYear}년 ${billMonth}월\n✅ ${created}건 생성 (임대료 + 관리비)`
        );
      }
    } catch (err) {
      console.error("[자동청구] 오류:", err.message);
    }
  }

  // 매일 00:05 KST (= 15:05 UTC) 실행 — 말일에만 실제 동작
  cron.schedule("5 15 * * *", () => {
    autoGenerateRentBills();
  });

  // 매일 09:00 KST (= 00:00 UTC) 미납 현황 알림
  async function checkUnpaidAlert() {
    try {
      const { rows } = await pool.query(
        `SELECT mb.year, mb.month, t.floor, t.company_name,
                mb.rent_paid, mb.maintenance_paid, mb.electricity_paid, mb.water_paid,
                mb.rent_amount, mb.maintenance_fee, mb.electricity_amount, mb.water_amount
         FROM monthly_bills mb JOIN tenants t ON t.id = mb.tenant_id
         WHERE (mb.rent_paid = FALSE OR mb.maintenance_paid = FALSE
                OR mb.electricity_paid = FALSE OR mb.water_paid = FALSE)
           AND (mb.rent_amount > 0 OR mb.maintenance_fee > 0 OR mb.electricity_amount > 0 OR mb.water_amount > 0)
         ORDER BY mb.year DESC, mb.month DESC, t.floor ASC`
      );
      if (rows.length === 0) return;

      const lines = [`💰 <b>미납 현황 (${rows.length}건)</b>`];
      for (const b of rows) {
        const unpaid = [];
        if (!b.rent_paid && b.rent_amount > 0) unpaid.push("임대료");
        if (!b.maintenance_paid && b.maintenance_fee > 0) unpaid.push("관리비");
        if (!b.electricity_paid && b.electricity_amount > 0) unpaid.push("전기");
        if (!b.water_paid && b.water_amount > 0) unpaid.push("수도");
        if (unpaid.length > 0) {
          lines.push(`📍 ${b.floor}층 ${b.company_name} (${b.year}/${String(b.month).padStart(2,"0")}) — ${unpaid.join(", ")}`);
        }
      }
      await sendTelegramAlert(lines.join("\n"));
    } catch (err) {
      console.error("[미납알림] 오류:", err.message);
    }
  }

  cron.schedule("0 0 * * *", () => {
    checkUnpaidAlert();
  });

  // ─── Inquiries API ────────────────────────────────────────
  async function sendTelegramAlert(message) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
      });
    } catch (err) {
      console.error("[텔레그램] 알림 전송 실패:", err.message);
    }
  }

  app.post("/inquiries", async (req, res) => {
    if (req.user.role !== "tenant") {
      return res.status(403).json({ error: "입주사 계정만 사용할 수 있습니다" });
    }
    const { category, content } = req.body || {};
    if (!category || !String(content || "").trim()) {
      return res.status(400).json({ error: "카테고리와 내용을 입력하세요" });
    }
    const validCategories = ["고장신고", "건의사항", "기타"];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: "올바른 카테고리를 선택하세요" });
    }
    try {
      const { rows: tenantRows } = await pool.query("SELECT floor, company_name FROM tenants WHERE id = $1", [req.user.id]);
      if (tenantRows.length === 0) return res.status(404).json({ error: "입주사 정보를 찾을 수 없습니다" });
      const { floor, company_name } = tenantRows[0];
      const { rows } = await pool.query(
        "INSERT INTO inquiries (tenant_id, floor, company_name, category, content) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at",
        [req.user.id, floor, company_name, category, String(content).trim()]
      );
      const now = new Date(rows[0].created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
      await sendTelegramAlert(`🔔 <b>새 문의 접수</b>\n📍 ${floor}층 ${company_name}\n📋 ${category}\n💬 ${String(content).trim()}\n🕐 ${now}`);
      res.json({ id: rows[0].id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.get("/inquiries", async (req, res) => {
    try {
      let query = "SELECT * FROM inquiries";
      const params = [];
      if (req.user.role === "tenant") {
        query += " WHERE tenant_id = $1";
        params.push(req.user.id);
      }
      query += " ORDER BY created_at DESC";
      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.patch("/inquiries/:id/resolve", requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT is_resolved FROM inquiries WHERE id = $1", [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: "문의를 찾을 수 없습니다" });
      await pool.query("UPDATE inquiries SET is_resolved = $1 WHERE id = $2", [!rows[0].is_resolved, req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.delete("/inquiries/:id", requireAdmin, async (req, res) => {
    try {
      const { rowCount } = await pool.query("DELETE FROM inquiries WHERE id = $1", [req.params.id]);
      if (rowCount === 0) return res.status(404).json({ error: "문의를 찾을 수 없습니다" });
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // ─── SPA Fallback ─────────────────────────────────────────
  const indexPath = path.join(clientBuildPath, "index.html");
  app.get("/{*splat}", (req, res) => {
    res.sendFile(indexPath);
  });

  // ─── Start Server ─────────────────────────────────────────
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
  });
})();
