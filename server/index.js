const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
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

if (process.env.ALLOWED_ORIGINS) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  app.use(cors({ origin: allowedOrigins }));
} else {
  app.use(cors({ origin: false }));
}

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
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // billing_day 컬럼이 없으면 추가 (기존 DB 마이그레이션)
  await pool.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_day INTEGER NOT NULL DEFAULT 1
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
    ["landlord_name", "건물주명"],
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

  // tax_invoices
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tax_invoices (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      supply_amount INTEGER NOT NULL,
      tax_amount INTEGER NOT NULL,
      total_amount INTEGER NOT NULL,
      issued_date DATE,
      is_issued BOOLEAN DEFAULT FALSE,
      memo TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, year, month)
    )
  `);

  console.log("테이블 초기화 완료");

  // ─── Auth Routes ──────────────────────────────────────────
  // Login
  app.post("/login", async (req, res) => {
    const { isAdmin, password, companyName, tenantPassword } = req.body;

    if (isAdmin) {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "관리자 비밀번호가 올바르지 않습니다" });
      }
      const token = crypto.randomUUID();
      sessions.set(token, { id: "admin", name: "건물주", role: "admin" });
      return res.json({ id: "admin", name: "건물주", role: "admin", token });
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
      });
      return res.json({
        id: tenant.id,
        name: tenant.company_name,
        floor: tenant.floor,
        role: "tenant",
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

  // ─── Auth Middleware ──────────────────────────────────────
  app.use((req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ error: "인증이 필요합니다" });
    }
    const user = sessions.get(auth.slice(7));
    if (!user) {
      return res.status(401).json({ error: "세션이 만료되었습니다" });
    }
    req.user = user;
    next();
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
    const { floor, company_name, business_number, representative, business_type, business_item, address, contact_phone, email, password, rent_amount, maintenance_fee, deposit_amount, lease_start, lease_end, billing_day } = req.body;
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
        `INSERT INTO tenants (floor, company_name, business_number, representative, business_type, business_item, address, contact_phone, email, password, rent_amount, maintenance_fee, deposit_amount, lease_start, lease_end, billing_day)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [floor, company_name, business_number || null, representative || null, business_type || null, business_item || null, address || null, contact_phone || null, email || null, pw, rent_amount || 0, maintenance_fee || 0, deposit_amount || 0, lease_start || null, lease_end || null, billing_day || 1]
      );
      res.json({ id: rows[0].id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.put("/tenants/:id", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { floor, company_name, business_number, representative, business_type, business_item, address, contact_phone, email, password, rent_amount, maintenance_fee, deposit_amount, lease_start, lease_end, is_active, billing_day } = req.body;
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
          rent_amount = COALESCE($11, rent_amount),
          maintenance_fee = COALESCE($12, maintenance_fee),
          deposit_amount = COALESCE($13, deposit_amount),
          lease_start = $14,
          lease_end = $15,
          is_active = COALESCE($16, is_active),
          billing_day = COALESCE($17, billing_day)
        WHERE id = $18`,
        [floor, company_name, business_number ?? null, representative ?? null, business_type ?? null, business_item ?? null, address ?? null, contact_phone ?? null, email ?? null, password || "", rent_amount, maintenance_fee, deposit_amount, lease_start || null, lease_end || null, is_active, billing_day, id]
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

  // ─── Settings API ─────────────────────────────────────────
  app.get("/settings", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM settings ORDER BY key");
      const obj = {};
      rows.forEach((r) => (obj[r.key] = r.value));
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
      if (photo_base64) {
        const base64Data = photo_base64.replace(/^data:[^;]+;base64,/, "");
        photoBuf = Buffer.from(base64Data, "base64");
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
        [targetTenantId, year, month, utility_type, reading_value ?? null, photoBuf, photo_filename || null, now]
      );
      res.json({ id: rows[0].id });
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

  app.get("/meter-readings/:id/photo", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT photo, photo_filename, tenant_id FROM meter_readings WHERE id = $1", [req.params.id]);
      if (rows.length === 0 || !rows[0].photo) {
        return res.status(404).json({ error: "사진이 없습니다" });
      }
      // Tenant can only view own photos
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
    const { year, month, gas_total, electricity_total, water_total } = req.body;
    if (!year || !month) {
      return res.status(400).json({ error: "연도와 월은 필수입니다" });
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO building_bills (year, month, gas_total, electricity_total, water_total)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (year, month) DO UPDATE SET gas_total=$3, electricity_total=$4, water_total=$5
         RETURNING id`,
        [year, month, gas_total || 0, electricity_total || 0, water_total || 0]
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
      const buildingBill = bbRows[0] || { gas_total: 0, electricity_total: 0, water_total: 0 };

      // Get previous month for usage calculation
      let prevYear = year;
      let prevMonth = month - 1;
      if (prevMonth === 0) { prevYear -= 1; prevMonth = 12; }

      // Distribute utility costs
      const utilityTypes = ["gas", "electricity", "water"];
      const totalFields = { gas: "gas_total", electricity: "electricity_total", water: "water_total" };
      const amountFields = { gas: "gas_amount", electricity: "electricity_amount", water: "water_amount" };

      const distribution = {};
      tenants.forEach((t) => {
        distribution[t.id] = { gas_amount: 0, electricity_amount: 0, water_amount: 0 };
      });

      for (const utype of utilityTypes) {
        const totalCost = buildingBill[totalFields[utype]] || 0;
        if (totalCost === 0) continue;

        // Get current month readings
        const { rows: currentReadings } = await pool.query(
          "SELECT tenant_id, reading_value FROM meter_readings WHERE year=$1 AND month=$2 AND utility_type=$3",
          [year, month, utype]
        );
        // Get previous month readings
        const { rows: prevReadings } = await pool.query(
          "SELECT tenant_id, reading_value FROM meter_readings WHERE year=$1 AND month=$2 AND utility_type=$3",
          [prevYear, prevMonth, utype]
        );

        const currentMap = {};
        currentReadings.forEach((r) => { currentMap[r.tenant_id] = parseFloat(r.reading_value) || 0; });
        const prevMap = {};
        prevReadings.forEach((r) => { prevMap[r.tenant_id] = parseFloat(r.reading_value) || 0; });

        // Calculate usage per tenant
        const usages = [];
        let totalUsage = 0;
        for (const t of tenants) {
          const current = currentMap[t.id];
          const prev = prevMap[t.id];
          if (current != null && prev != null) {
            const usage = Math.max(0, current - prev);
            usages.push({ tenantId: t.id, usage });
            totalUsage += usage;
          } else {
            usages.push({ tenantId: t.id, usage: null }); // no reading
          }
        }

        // Distribute
        const validUsages = usages.filter((u) => u.usage !== null);
        if (validUsages.length === 0) {
          // No readings: equal split among all tenants
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
        } else if (totalUsage === 0) {
          // All zero usage: equal split among tenants with readings
          const share = Math.round(totalCost / validUsages.length);
          let allocated = 0;
          validUsages.forEach((u, idx) => {
            if (idx === validUsages.length - 1) {
              distribution[u.tenantId][amountFields[utype]] = totalCost - allocated;
            } else {
              distribution[u.tenantId][amountFields[utype]] = share;
              allocated += share;
            }
          });
        } else {
          // Proportional distribution
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
        await pool.query(
          `INSERT INTO monthly_bills (tenant_id, year, month, rent_amount, maintenance_fee, gas_amount, electricity_amount, water_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (tenant_id, year, month) DO UPDATE SET
             gas_amount=$6, electricity_amount=$7, water_amount=$8`,
          [t.id, year, month, t.rent_amount, t.maintenance_fee, d.gas_amount, d.electricity_amount, d.water_amount]
        );
        updated++;
      }
      res.json({ created: updated, message: `${updated}건 공과금 배분 완료` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // Toggle payment status
  app.patch("/monthly-bills/:id/pay", requireAdmin, async (req, res) => {
    const { field } = req.body; // e.g. 'rent_paid', 'gas_paid', etc.
    const validFields = ["rent_paid", "maintenance_paid", "gas_paid", "electricity_paid", "water_paid"];
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

  // ─── Tax Invoices API ─────────────────────────────────────
  // List: join monthly_bills + tax_invoices for status
  app.get("/tax-invoices", async (req, res) => {
    const { year, month } = req.query;
    try {
      let query = `
        SELECT mb.id as bill_id, mb.tenant_id, mb.year, mb.month,
               mb.rent_amount, mb.maintenance_fee, mb.gas_amount, mb.electricity_amount, mb.water_amount,
               t.floor, t.company_name, t.business_number, t.representative, t.address,
               ti.id as tax_id, ti.is_issued, ti.issued_date, ti.memo as tax_memo
        FROM monthly_bills mb
        JOIN tenants t ON mb.tenant_id = t.id
        LEFT JOIN tax_invoices ti ON ti.tenant_id = mb.tenant_id AND ti.year = mb.year AND ti.month = mb.month
        WHERE 1=1`;
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

      // Compute supply/tax per item
      const result = rows.map((r) => {
        const items = [];
        if (r.rent_amount > 0) items.push({ name: "임대료", amount: r.rent_amount });
        if (r.maintenance_fee > 0) items.push({ name: "관리비", amount: r.maintenance_fee });
        if (r.gas_amount > 0) items.push({ name: "가스", amount: r.gas_amount });
        if (r.electricity_amount > 0) items.push({ name: "전기", amount: r.electricity_amount });
        if (r.water_amount > 0) items.push({ name: "수도", amount: r.water_amount });
        const supplyAmount = items.reduce((s, i) => s + i.amount, 0);
        const taxAmount = Math.round(supplyAmount * 0.1);
        const totalAmount = supplyAmount + taxAmount;
        return {
          bill_id: r.bill_id,
          tenant_id: r.tenant_id,
          year: r.year,
          month: r.month,
          floor: r.floor,
          company_name: r.company_name,
          business_number: r.business_number || "",
          representative: r.representative || "",
          address: r.address || "",
          items,
          total_amount: totalAmount,
          supply_amount: supplyAmount,
          tax_amount: taxAmount,
          tax_id: r.tax_id,
          is_issued: r.is_issued || false,
          issued_date: r.issued_date,
          tax_memo: r.tax_memo,
        };
      });
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // Toggle issue status (발행대기 ↔ 발행완료)
  app.patch("/tax-invoices/:billId/issue", requireAdmin, async (req, res) => {
    const { billId } = req.params;
    try {
      // Get bill info
      const { rows: bills } = await pool.query("SELECT tenant_id, year, month FROM monthly_bills WHERE id = $1", [billId]);
      if (bills.length === 0) return res.status(404).json({ error: "청구서를 찾을 수 없습니다" });
      const { tenant_id, year, month } = bills[0];
      const today = new Date().toISOString().split("T")[0];

      // Check if tax_invoices record exists
      const { rows: existing } = await pool.query(
        "SELECT id, is_issued FROM tax_invoices WHERE tenant_id=$1 AND year=$2 AND month=$3",
        [tenant_id, year, month]
      );

      if (existing.length === 0) {
        // Create as issued
        await pool.query(
          `INSERT INTO tax_invoices (tenant_id, year, month, supply_amount, tax_amount, total_amount, is_issued, issued_date)
           VALUES ($1,$2,$3,0,0,0,TRUE,$4)`,
          [tenant_id, year, month, today]
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

      const targets = tenants.filter((t) => {
        const uploaded = uploadedMap[t.id];
        return !uploaded || uploaded.size < 3;
      });

      if (targets.length === 0) {
        return res.json({ sent: 0, message: "모든 입주사가 사진을 업로드했습니다" });
      }

      // TODO: Integrate with actual SMS API (coolsms/aligo)
      const targetInfo = targets.map((t) => ({
        floor: t.floor,
        company: t.company_name,
        phone: t.contact_phone,
        missing: 3 - (uploadedMap[t.id]?.size || 0),
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
         AND (mb.rent_paid = FALSE OR mb.maintenance_paid = FALSE OR mb.gas_paid = FALSE OR mb.electricity_paid = FALSE OR mb.water_paid = FALSE)`,
        [year, month]
      );

      if (bills.length === 0) {
        return res.json({ sent: 0, message: "미납 입주사가 없습니다" });
      }

      const targetInfo = bills.map((b) => {
        const unpaid = [];
        if (!b.rent_paid && b.rent_amount > 0) unpaid.push("임대료");
        if (!b.maintenance_paid && b.maintenance_fee > 0) unpaid.push("관리비");
        if (!b.gas_paid && b.gas_amount > 0) unpaid.push("가스");
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
  // 각 입주사의 billing_day에 맞춰 임대료+관리비 자동 생성 (공과금은 제외)
  async function autoGenerateRentBills() {
    try {
      // KST 기준 오늘 날짜
      const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
      const today = now.getDate();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      // 오늘이 billing_day인 활성 입주사만 조회
      const { rows: tenants } = await pool.query(
        "SELECT * FROM tenants WHERE is_active = TRUE AND billing_day = $1",
        [today]
      );
      if (tenants.length === 0) return;

      let created = 0;
      for (const t of tenants) {
        // INSERT ... ON CONFLICT DO NOTHING → 이미 생성된 건은 건너뜀
        const { rowCount } = await pool.query(
          `INSERT INTO monthly_bills (tenant_id, year, month, rent_amount, maintenance_fee)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, year, month) DO NOTHING`,
          [t.id, year, month, t.rent_amount, t.maintenance_fee]
        );
        if (rowCount > 0) created++;
      }
      if (created > 0) {
        console.log(`[자동청구] ${year}년 ${month}월 임대료/관리비 ${created}건 생성 (청구일: ${today}일)`);
      }
    } catch (err) {
      console.error("[자동청구] 오류:", err.message);
    }
  }

  // 서버 시작 시 한 번 실행 + 매일 00:05 KST (= 15:05 UTC) 실행
  autoGenerateRentBills();
  cron.schedule("5 15 * * *", () => {
    autoGenerateRentBills();
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
