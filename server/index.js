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

  // ─── tenant_floors (다중층 입주사 지원) — 다른 마이그레이션보다 먼저 생성 ───
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_floors (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      floor INTEGER UNIQUE NOT NULL
    )
  `);
  // 기존 tenants.floor → tenant_floors 이관
  await pool.query(`
    INSERT INTO tenant_floors (tenant_id, floor)
    SELECT id, floor FROM tenants WHERE floor IS NOT NULL
    ON CONFLICT DO NOTHING
  `);

  // 최초 비밀번호(예: 0001) 사용 여부 플래그
  await pool.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN
  `);
  // 기존 데이터 보정: 기본 비밀번호(최소 층수 4자리)면 변경 필요로 설정
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

  // 사업자등록증 이미지 컬럼
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS biz_doc BYTEA`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS biz_doc_filename TEXT`);

  // 세금계산서 공급받는자 정보 (입주사 약식 정보와 별도 관리)
  const taxCols = ['tax_company_name', 'tax_representative', 'tax_address', 'tax_business_type', 'tax_business_item', 'tax_email', 'tax_email2'];
  for (const col of taxCols) {
    await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ${col} TEXT DEFAULT ''`);
  }

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

  // monthly_bills: 기타(other) 항목 컬럼 추가
  await pool.query(`ALTER TABLE monthly_bills ADD COLUMN IF NOT EXISTS other_amount INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE monthly_bills ADD COLUMN IF NOT EXISTS other_label TEXT`);
  await pool.query(`ALTER TABLE monthly_bills ADD COLUMN IF NOT EXISTS other_paid BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE monthly_bills ADD COLUMN IF NOT EXISTS other_paid_date DATE`);

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
    ["tax_supplier_company", "주식회사 엔피케이테크"],
    ["tax_supplier_name", "남동우"],
    ["tax_supplier_biz_no", "7438602924"],
    ["tax_supplier_address", "경기도 남양주시 와부읍 수레로116번길 16, 2층 203호(아이비타워-2)"],
    ["tax_supplier_business_type", "정보통신업"],
    ["tax_supplier_business_item", "소프트웨어 개발 및 공급업"],
    ["tax_supplier_email", ""],
  ];
  for (const [k, v] of defaultSettings) {
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
      [k, v]
    );
  }

  // 세금계산서 공급받는자 정보 초기 세팅 (XLSX 템플릿 기준, 한번만 실행)
  const taxBuyerSeed = [
    { floor: 1, tax_company_name: '주식회사 신세계인터내셔널', tax_representative: '김덕주', tax_address: '서울특별시 강남구 도산대로 449(청담동)', tax_business_type: '도매업', tax_business_item: '무역, 의류', tax_email: 'smLee@sikorea.co.kr', tax_email2: 'k5junghee@sikorea.co.kr' },
    { floor: 2, tax_company_name: '브이 모먼트 클리닉', tax_representative: '최승운', tax_address: '서울특별시 강남구 도산대로49길 22, 2층, 4층(신사동, 아가페 트리)', tax_business_type: '보건업', tax_business_item: '피부과, 성형외과', tax_email: 'beanchoi@naver.com', tax_email2: '' },
    { floor: 3, tax_company_name: '주식회사 하이퍼코퍼레이션', tax_representative: '이상석', tax_address: '서울특별시 강남구 언주로 637, 15층(논현동, 싸이칸타워)', tax_business_type: '도소매, 서비스', tax_business_item: '컴퓨터주변기기, 별정통신', tax_email: 'info@hyper-corp.com', tax_email2: '' },
    { floor: 4, tax_company_name: '브이 모먼트 클리닉', tax_representative: '최승운', tax_address: '서울특별시 강남구 도산대로49길 22, 2층, 4층(신사동, 아가페 트리)', tax_business_type: '보건업', tax_business_item: '피부과, 성형외과', tax_email: 'beanchoi@naver.com', tax_email2: '' },
    { floor: 5, tax_company_name: '칼라빈', tax_representative: '서일주', tax_address: '', tax_business_type: '', tax_business_item: '', tax_email: 'tal222@daum.net', tax_email2: '' },
    { floor: 6, tax_company_name: '주식회사 하이퍼코퍼레이션', tax_representative: '이상석', tax_address: '서울특별시 강남구 언주로 637, 15층(논현동, 싸이칸타워)', tax_business_type: '도소매, 서비스', tax_business_item: '컴퓨터주변기기, 별정통신', tax_email: 'info@hyper-corp.com', tax_email2: '' },
    { floor: 7, tax_company_name: '바시필라테스', tax_representative: '차주한', tax_address: '서울특별시 강남구 도산대로49길 22, 7층(신사동, 아가페 트리)', tax_business_type: '서비스업', tax_business_item: '필라테스', tax_email: 'basiflexcha@gmail.com', tax_email2: '' },
    { floor: 8, tax_company_name: '버터', tax_representative: '신나라', tax_address: '서울특별시 강남구 도산대로49길 22, 8층(신사동, 아가페 트리)', tax_business_type: '음식점업', tax_business_item: '기타 주점업', tax_email: 'inetjin@hanmail.net', tax_email2: '' },
  ];
  for (const d of taxBuyerSeed) {
    await pool.query(
      `UPDATE tenants SET tax_company_name=$1, tax_representative=$2, tax_address=$3, tax_business_type=$4, tax_business_item=$5, tax_email=$6, tax_email2=$7
       WHERE id IN (SELECT tenant_id FROM tenant_floors WHERE floor=$8) AND tax_company_name=''`,
      [d.tax_company_name, d.tax_representative, d.tax_address, d.tax_business_type, d.tax_business_item, d.tax_email, d.tax_email2, d.floor]
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
  // Migration: item_name 컬럼 추가
  try { await pool.query("ALTER TABLE tax_invoices ADD COLUMN IF NOT EXISTS item_name TEXT"); } catch {}

  // partners (협력사/직원)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS partners (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      contact_phone TEXT,
      memo TEXT,
      business_number TEXT,
      company_name TEXT,
      representative TEXT,
      bank_name TEXT,
      bank_account TEXT,
      bank_holder TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      biz_doc BYTEA,
      biz_doc_filename TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // partners: 통장사본 컬럼 마이그레이션
  await pool.query(`ALTER TABLE partners ADD COLUMN IF NOT EXISTS bank_doc BYTEA`);
  await pool.query(`ALTER TABLE partners ADD COLUMN IF NOT EXISTS bank_doc_filename TEXT`);

  // partners: 납기일 컬럼 마이그레이션
  await pool.query(`ALTER TABLE partners ADD COLUMN IF NOT EXISTS payment_day INTEGER`);

  // partner_payments (협력사 지급내역)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_payments (
      id SERIAL PRIMARY KEY,
      partner_id INTEGER REFERENCES partners(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      payment_date DATE,
      memo TEXT,
      is_paid BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(partner_id, year, month)
    )
  `);

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

  // meter_readings에 floor 컬럼 추가 + 백필
  await pool.query(`ALTER TABLE meter_readings ADD COLUMN IF NOT EXISTS floor INTEGER`);
  await pool.query(`
    UPDATE meter_readings mr SET floor = t.floor
    FROM tenants t WHERE mr.tenant_id = t.id AND mr.floor IS NULL
  `);

  // ─── 브이모먼트 다중층 머지 (2층+4층 → 1개 tenant) ───────
  {
    const { rows: vms } = await pool.query(
      `SELECT id, floor FROM tenants WHERE company_name LIKE '%브이모먼트%' AND is_active = TRUE ORDER BY floor ASC`
    );
    if (vms.length === 2) {
      const primary = vms[0]; // 2층 (MIN floor)
      const secondary = vms[1]; // 4층

      // tenant_floors: primary에 secondary floor 추가
      await pool.query(
        `INSERT INTO tenant_floors (tenant_id, floor) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [primary.id, secondary.floor]
      );

      // meter_readings: secondary → primary, floor 보존
      await pool.query(
        `UPDATE meter_readings SET tenant_id = $1, floor = $2 WHERE tenant_id = $3`,
        [primary.id, secondary.floor, secondary.id]
      );

      // monthly_bills 머지: 양쪽 다 있는 월은 공과금 합산
      const { rows: secBills } = await pool.query(
        `SELECT * FROM monthly_bills WHERE tenant_id = $1`, [secondary.id]
      );
      for (const sb of secBills) {
        const { rows: priB } = await pool.query(
          `SELECT id FROM monthly_bills WHERE tenant_id = $1 AND year = $2 AND month = $3`,
          [primary.id, sb.year, sb.month]
        );
        if (priB.length > 0) {
          // 합산 (공과금만; 임대료/관리비는 primary 기준 유지)
          await pool.query(
            `UPDATE monthly_bills SET
              electricity_amount = electricity_amount + $1,
              water_amount = water_amount + $2
            WHERE id = $3`,
            [sb.electricity_amount || 0, sb.water_amount || 0, priB[0].id]
          );
          await pool.query(`DELETE FROM monthly_bills WHERE id = $1`, [sb.id]);
        } else {
          // secondary만 있는 월 → primary로 재할당
          await pool.query(
            `UPDATE monthly_bills SET tenant_id = $1 WHERE id = $2`,
            [primary.id, sb.id]
          );
        }
      }

      // tax_invoices → primary로 재할당 (중복 키는 삭제)
      await pool.query(
        `DELETE FROM tax_invoices WHERE tenant_id = $1
         AND (year, month, item_type) IN (SELECT year, month, item_type FROM tax_invoices WHERE tenant_id = $2)`,
        [secondary.id, primary.id]
      );
      await pool.query(`UPDATE tax_invoices SET tenant_id = $1 WHERE tenant_id = $2`, [primary.id, secondary.id]);
      // inquiries → primary로 재할당
      await pool.query(`UPDATE inquiries SET tenant_id = $1 WHERE tenant_id = $2`, [primary.id, secondary.id]);

      // secondary 비활성화 + tenant_floors에서 제거
      await pool.query(`DELETE FROM tenant_floors WHERE tenant_id = $1`, [secondary.id]);
      await pool.query(`UPDATE tenants SET is_active = FALSE, floor = NULL WHERE id = $1`, [secondary.id]);

      console.log(`브이모먼트 다중층 머지 완료: tenant ${primary.id}(${primary.floor}F) ← tenant ${secondary.id}(${secondary.floor}F)`);
    }
  }

  // ─── meter_readings UNIQUE 제약 변경 (floor 포함) ─────────
  try { await pool.query(`ALTER TABLE meter_readings DROP CONSTRAINT IF EXISTS meter_readings_tenant_id_year_month_utility_type_key`); } catch {}
  try { await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_meter_readings_unique ON meter_readings (tenant_id, floor, year, month, utility_type)`); } catch {}

  // tenants.floor UNIQUE/NOT NULL 제거 (기존 제약 해제)
  try { await pool.query(`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_floor_key`); } catch {}
  try { await pool.query(`ALTER TABLE tenants ALTER COLUMN floor DROP NOT NULL`); } catch {}

  console.log("테이블 초기화 완료");

  // ─── One-time migration: 2026년 1월 공과금 데이터 ─────────
  {
    const jan2026Data = [
      { floor: 1, electricity: 2027671, water: 39512 },
      { floor: 2, electricity: 637666, water: 103718 },
      { floor: 3, electricity: 829165, water: 29634 },
      { floor: 4, electricity: 637666, water: 103718 },
      { floor: 5, electricity: 556855, water: 750726 },
      { floor: 6, electricity: 131745, water: 11648 },
      { floor: 7, electricity: 156870, water: 29634 },
      { floor: 8, electricity: 217108, water: 49390 },
    ];
    // building_bills 합계
    await pool.query(
      `INSERT INTO building_bills (year, month, electricity_total, water_total)
       VALUES (2026, 1, 5194746, 1117980)
       ON CONFLICT (year, month) DO NOTHING`
    );
    for (const d of jan2026Data) {
      const { rows } = await pool.query(
        `SELECT t.id, t.rent_amount, t.maintenance_fee FROM tenants t
         JOIN tenant_floors tf ON tf.tenant_id = t.id
         WHERE tf.floor = $1 AND t.is_active = TRUE`, [d.floor]
      );
      if (rows.length === 0) continue;
      const t = rows[0];
      // monthly_bills: 전액 납부 완료 상태
      await pool.query(
        `INSERT INTO monthly_bills (tenant_id, year, month, rent_amount, maintenance_fee, electricity_amount, water_amount,
           rent_paid, maintenance_paid, electricity_paid, water_paid,
           rent_paid_date, maintenance_paid_date, electricity_paid_date, water_paid_date)
         VALUES ($1, 2026, 1, $2, $3, $4, $5,
           TRUE, TRUE, TRUE, TRUE,
           '2026-01-31', '2026-01-31', '2026-01-31', '2026-01-31')
         ON CONFLICT (tenant_id, year, month) DO UPDATE SET
           electricity_amount = $4, water_amount = $5,
           rent_paid = TRUE, maintenance_paid = TRUE, electricity_paid = TRUE, water_paid = TRUE,
           rent_paid_date = COALESCE(monthly_bills.rent_paid_date, '2026-01-31'),
           maintenance_paid_date = COALESCE(monthly_bills.maintenance_paid_date, '2026-01-31'),
           electricity_paid_date = COALESCE(monthly_bills.electricity_paid_date, '2026-01-31'),
           water_paid_date = COALESCE(monthly_bills.water_paid_date, '2026-01-31')`,
        [t.id, t.rent_amount, t.maintenance_fee, d.electricity, d.water]
      );
    }
    console.log("2026년 1월 공과금 마이그레이션 완료");
  }

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
      // 다중층 지원: tenant_floors에서 층 목록 조회
      const { rows: floorRows } = await pool.query(
        "SELECT floor FROM tenant_floors WHERE tenant_id = $1 ORDER BY floor", [tenant.id]
      );
      const floors = floorRows.map((f) => f.floor);
      const token = crypto.randomUUID();
      sessions.set(token, {
        id: tenant.id,
        name: tenant.company_name,
        floors,
        role: "tenant",
        mustChangePassword: !!tenant.must_change_password,
        createdAt: Date.now(),
      });
      return res.json({
        id: tenant.id,
        name: tenant.company_name,
        floors,
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

  // ─── Tenant biz-doc (auth 미들웨어 앞: 새 탭에서 query token 사용) ──
  app.get("/tenants/:id/biz-doc", (req, res, next) => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : req.query.token;
    if (!token) return res.status(401).json({ error: "인증이 필요합니다" });
    const user = sessions.get(token);
    if (!user) return res.status(401).json({ error: "세션이 만료되었습니다" });
    if (Date.now() - user.createdAt > SESSION_TTL_MS) {
      sessions.delete(token);
      return res.status(401).json({ error: "세션이 만료되었습니다" });
    }
    if (user.role !== "admin") return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    req.user = user;
    next();
  }, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT biz_doc, biz_doc_filename FROM tenants WHERE id = $1", [req.params.id]);
      if (rows.length === 0 || !rows[0].biz_doc) {
        return res.status(404).json({ error: "파일이 없습니다" });
      }
      const buf = rows[0].biz_doc;
      const filename = rows[0].biz_doc_filename || "document.jpg";
      const ext = filename.split(".").pop().toLowerCase();
      const mimeMap = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
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
  const TENANT_LIST_COLS = "id, floor, company_name, business_number, representative, business_type, business_item, address, contact_phone, email, password, rent_amount, maintenance_fee, deposit_amount, lease_start, lease_end, billing_day, payment_type, is_active, created_at, must_change_password, tax_company_name, tax_representative, tax_address, tax_business_type, tax_business_item, tax_email, tax_email2, biz_doc_filename";

  // tenant 목록에 floors 배열 추가 헬퍼
  async function attachFloors(tenantRows) {
    if (tenantRows.length === 0) return tenantRows;
    const ids = tenantRows.map((t) => t.id);
    const { rows: allFloors } = await pool.query(
      `SELECT tenant_id, floor FROM tenant_floors WHERE tenant_id = ANY($1) ORDER BY floor`, [ids]
    );
    const floorMap = {};
    allFloors.forEach((f) => {
      if (!floorMap[f.tenant_id]) floorMap[f.tenant_id] = [];
      floorMap[f.tenant_id].push(f.floor);
    });
    return tenantRows.map((t) => ({ ...t, floors: floorMap[t.id] || (t.floor != null ? [t.floor] : []) }));
  }

  app.get("/tenants", async (req, res) => {
    try {
      if (req.user.role === "tenant") {
      const { rows } = await pool.query(`SELECT ${TENANT_LIST_COLS} FROM tenants WHERE id = $1`, [req.user.id]);
      return res.json(await attachFloors(rows));
      }
      const { rows } = await pool.query(`SELECT ${TENANT_LIST_COLS} FROM tenants ORDER BY (SELECT MIN(floor) FROM tenant_floors WHERE tenant_id = tenants.id) ASC NULLS LAST`);
      res.json(await attachFloors(rows));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.post("/tenants", requireAdmin, async (req, res) => {
    const { floors, floor, company_name, business_number, representative, business_type, business_item, address, contact_phone, email, password, rent_amount, maintenance_fee, deposit_amount, lease_start, lease_end, billing_day, payment_type, tax_company_name, tax_representative, tax_address, tax_business_type, tax_business_item, tax_email, tax_email2, biz_doc_base64, biz_doc_filename } = req.body;
    // floors 배열 또는 단일 floor 지원
    const floorList = Array.isArray(floors) ? floors.map(Number).filter(Boolean) : (floor ? [Number(floor)] : []);
    if (floorList.length === 0 || !company_name) {
      return res.status(400).json({ error: "층수와 업체명은 필수입니다" });
    }
    try {
      // tenant_floors에서 중복 체크
      const { rows: dup } = await pool.query(
        "SELECT floor FROM tenant_floors WHERE floor = ANY($1)", [floorList]
      );
      if (dup.length > 0) {
        return res.status(409).json({ error: `${dup.map(d => d.floor + '층').join(', ')}에 이미 입주사가 등록되어 있습니다` });
      }
      let docBuf = null, docSafe = null;
      if (biz_doc_base64) {
        const base64Data = biz_doc_base64.replace(/^data:[^;]+;base64,/, "");
        docBuf = Buffer.from(base64Data, "base64");
        if (docBuf.length > 5 * 1024 * 1024) return res.status(400).json({ error: "파일 크기는 5MB 이하여야 합니다" });
        const isJpeg = docBuf[0] === 0xFF && docBuf[1] === 0xD8 && docBuf[2] === 0xFF;
        const isPng = docBuf[0] === 0x89 && docBuf[1] === 0x50 && docBuf[2] === 0x4E && docBuf[3] === 0x47;
        if (!isJpeg && !isPng) return res.status(400).json({ error: "JPEG 또는 PNG 이미지만 업로드 가능합니다" });
        docSafe = biz_doc_filename ? path.basename(biz_doc_filename).replace(/[^a-zA-Z0-9가-힣._-]/g, "_") : null;
      }
      const pw = password || String(Math.min(...floorList)).padStart(4, "0");
      const primaryFloor = Math.min(...floorList);
      const { rows } = await pool.query(
        `INSERT INTO tenants (floor, company_name, business_number, representative, business_type, business_item, address, contact_phone, email, password, rent_amount, maintenance_fee, deposit_amount, lease_start, lease_end, billing_day, payment_type, must_change_password, tax_company_name, tax_representative, tax_address, tax_business_type, tax_business_item, tax_email, tax_email2, biz_doc, biz_doc_filename)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,TRUE,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING id`,
        [primaryFloor, company_name, business_number || null, representative || null, business_type || null, business_item || null, address || null, contact_phone || null, email || null, pw, rent_amount || 0, maintenance_fee || 0, deposit_amount || 0, lease_start || null, lease_end || null, billing_day || 1, payment_type || 'prepaid', tax_company_name || '', tax_representative || '', tax_address || '', tax_business_type || '', tax_business_item || '', tax_email || '', tax_email2 || '', docBuf, docSafe]
      );
      const tenantId = rows[0].id;
      // tenant_floors 등록
      for (const f of floorList) {
        await pool.query("INSERT INTO tenant_floors (tenant_id, floor) VALUES ($1, $2) ON CONFLICT DO NOTHING", [tenantId, f]);
      }
      res.json({ id: tenantId });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.put("/tenants/:id", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { floors, floor, company_name, business_number, representative, business_type, business_item, address, contact_phone, email, password, rent_amount, maintenance_fee, deposit_amount, lease_start, lease_end, is_active, billing_day, payment_type, tax_company_name, tax_representative, tax_address, tax_business_type, tax_business_item, tax_email, tax_email2, biz_doc_base64, biz_doc_filename } = req.body;
    // floors 배열 또는 단일 floor 지원
    const floorList = Array.isArray(floors) ? floors.map(Number).filter(Boolean) : (floor ? [Number(floor)] : null);
    try {
      // Check floor conflict in tenant_floors
      if (floorList) {
        const { rows: dup } = await pool.query(
          "SELECT floor FROM tenant_floors WHERE floor = ANY($1) AND tenant_id != $2", [floorList, id]
        );
        if (dup.length > 0) {
          return res.status(409).json({ error: `${dup.map(d => d.floor + '층').join(', ')}에 이미 다른 입주사가 있습니다` });
        }
      }
      let docBuf = undefined, docSafe = undefined;
      if (biz_doc_base64) {
        const base64Data = biz_doc_base64.replace(/^data:[^;]+;base64,/, "");
        docBuf = Buffer.from(base64Data, "base64");
        if (docBuf.length > 5 * 1024 * 1024) return res.status(400).json({ error: "파일 크기는 5MB 이하여야 합니다" });
        const isJpeg = docBuf[0] === 0xFF && docBuf[1] === 0xD8 && docBuf[2] === 0xFF;
        const isPng = docBuf[0] === 0x89 && docBuf[1] === 0x50 && docBuf[2] === 0x4E && docBuf[3] === 0x47;
        if (!isJpeg && !isPng) return res.status(400).json({ error: "JPEG 또는 PNG 이미지만 업로드 가능합니다" });
        docSafe = biz_doc_filename ? path.basename(biz_doc_filename).replace(/[^a-zA-Z0-9가-힣._-]/g, "_") : null;
      }

      const primaryFloor = floorList ? Math.min(...floorList) : null;
      let query = `UPDATE tenants SET
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
          payment_type = COALESCE($18, payment_type),
          tax_company_name = COALESCE($19, tax_company_name),
          tax_representative = COALESCE($20, tax_representative),
          tax_address = COALESCE($21, tax_address),
          tax_business_type = COALESCE($22, tax_business_type),
          tax_business_item = COALESCE($23, tax_business_item),
          tax_email = COALESCE($24, tax_email),
          tax_email2 = COALESCE($25, tax_email2)`;
      const params = [primaryFloor, company_name, business_number ?? null, representative ?? null, business_type ?? null, business_item ?? null, address ?? null, contact_phone ?? null, email ?? null, password || "", rent_amount, maintenance_fee, deposit_amount, lease_start || null, lease_end || null, is_active, billing_day, payment_type, tax_company_name ?? '', tax_representative ?? '', tax_address ?? '', tax_business_type ?? '', tax_business_item ?? '', tax_email ?? '', tax_email2 ?? ''];
      if (docBuf !== undefined) {
        query += `, biz_doc=$${params.length + 1}, biz_doc_filename=$${params.length + 2}`;
        params.push(docBuf, docSafe);
      }
      query += ` WHERE id=$${params.length + 1}`;
      params.push(id);
      await pool.query(query, params);

      // tenant_floors 업데이트
      if (floorList) {
        await pool.query("DELETE FROM tenant_floors WHERE tenant_id = $1", [id]);
        for (const f of floorList) {
          await pool.query("INSERT INTO tenant_floors (tenant_id, floor) VALUES ($1, $2)", [id, f]);
        }
      }
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
        query = "SELECT mr.*, t.company_name FROM meter_readings mr JOIN tenants t ON mr.tenant_id = t.id WHERE mr.tenant_id = $1";
        params = [req.user.id];
        if (year && month) {
          query += " AND mr.year = $2 AND mr.month = $3";
          params.push(Number(year), Number(month));
        }
      } else {
        query = "SELECT mr.*, t.company_name FROM meter_readings mr JOIN tenants t ON mr.tenant_id = t.id WHERE 1=1";
        params = [];
        if (year && month) {
          query += ` AND mr.year = $${params.length + 1} AND mr.month = $${params.length + 2}`;
          params.push(Number(year), Number(month));
        }
      }
      query += " ORDER BY mr.floor ASC, mr.utility_type ASC";
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
    const { tenant_id, year, month, utility_type, photo_base64, photo_filename, reading_value, floor: reqFloor } = req.body;
    try {
      // Tenant can only upload for themselves
      const targetTenantId = req.user.role === "tenant" ? req.user.id : tenant_id;
      if (!targetTenantId || !year || !month || !utility_type) {
        return res.status(400).json({ error: "필수 항목 누락" });
      }

      // floor 결정: 요청에서 받거나, 단일층 tenant는 자동 결정
      let targetFloor = reqFloor ? Number(reqFloor) : null;
      const { rows: tenantFloors } = await pool.query(
        "SELECT floor FROM tenant_floors WHERE tenant_id = $1 ORDER BY floor", [targetTenantId]
      );
      if (!targetFloor) {
        if (tenantFloors.length === 1) {
          targetFloor = tenantFloors[0].floor;
        } else if (tenantFloors.length > 1) {
          return res.status(400).json({ error: "다중층 입주사는 층을 지정해야 합니다" });
        } else {
          // tenant_floors에 없으면 tenants.floor 사용 (fallback)
          const { rows: tRows } = await pool.query("SELECT floor FROM tenants WHERE id = $1", [targetTenantId]);
          targetFloor = tRows[0]?.floor;
        }
      }
      // tenant가 해당 floor에 접근 권한이 있는지 검증
      if (req.user.role === "tenant" && tenantFloors.length > 0 && !tenantFloors.some(f => f.floor === targetFloor)) {
        return res.status(403).json({ error: "해당 층에 대한 권한이 없습니다" });
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
        `INSERT INTO meter_readings (tenant_id, floor, year, month, utility_type, reading_value, photo, photo_filename, uploaded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_id, floor, year, month, utility_type)
         DO UPDATE SET photo = COALESCE($7, meter_readings.photo),
                       photo_filename = COALESCE($8, meter_readings.photo_filename),
                       uploaded_at = CASE WHEN $7 IS NOT NULL THEN $9 ELSE meter_readings.uploaded_at END,
                       reading_value = COALESCE($6, meter_readings.reading_value)
         RETURNING id`,
        [targetTenantId, targetFloor, year, month, utility_type, reading_value ?? null, photoBuf, safeName, now]
      );
      res.json({ id: rows[0].id });

      // 사진 업로드 시 텔레그램 알림
      if (photoBuf) {
        const UTILITY_LABEL = { electricity: "⚡ 전기", water: "💧 수도" };
        const { rows: tenantRows } = await pool.query(
          "SELECT company_name FROM tenants WHERE id = $1", [targetTenantId]
        );
        if (tenantRows.length > 0) {
          const t = tenantRows[0];
          const kstNow = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
          await sendTelegramAlert(
            `📷 <b>검침 사진 업로드</b>\n📍 ${targetFloor}층 ${t.company_name}\n${UTILITY_LABEL[utility_type] || utility_type}\n📅 ${year}년 ${month}월\n🕐 ${kstNow}`
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
      let query = `SELECT mb.*, t.company_name,
        (SELECT array_agg(tf.floor ORDER BY tf.floor) FROM tenant_floors tf WHERE tf.tenant_id = t.id) as floors
        FROM monthly_bills mb JOIN tenants t ON mb.tenant_id = t.id WHERE 1=1`;
      const params = [];
      if (req.user.role === "tenant") {
        query += ` AND mb.tenant_id = $${params.length + 1}`;
        params.push(req.user.id);
      }
      if (year && month) {
        query += ` AND mb.year = $${params.length + 1} AND mb.month = $${params.length + 2}`;
        params.push(Number(year), Number(month));
      }
      query += " ORDER BY (SELECT MIN(tf.floor) FROM tenant_floors tf WHERE tf.tenant_id = t.id) ASC NULLS LAST";
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

  // Generate monthly bills (auto-distribute utility costs) — 층별 배분 → tenant별 합산
  app.post("/monthly-bills/generate", requireAdmin, async (req, res) => {
    const { year, month } = req.body;
    if (!year || !month) {
      return res.status(400).json({ error: "연도와 월은 필수입니다" });
    }
    try {
      // Get active tenants with their floors
      const { rows: tenants } = await pool.query("SELECT * FROM tenants WHERE is_active = TRUE");
      if (tenants.length === 0) {
        return res.status(400).json({ error: "활성 입주사가 없습니다" });
      }
      // tenant_floors → 층별 tenant 매핑
      const { rows: allFloors } = await pool.query(
        `SELECT tf.tenant_id, tf.floor FROM tenant_floors tf JOIN tenants t ON tf.tenant_id = t.id WHERE t.is_active = TRUE ORDER BY tf.floor ASC`
      );
      if (allFloors.length === 0) {
        return res.status(400).json({ error: "활성 층이 없습니다" });
      }

      // Get building bills
      const { rows: bbRows } = await pool.query("SELECT * FROM building_bills WHERE year=$1 AND month=$2", [year, month]);
      const buildingBill = bbRows[0] || { electricity_total: 0, water_total: 0 };

      const isWaterMonth = month % 2 === 1;
      const utilityTypes = isWaterMonth ? ["electricity", "water"] : ["electricity"];
      const totalFields = { electricity: "electricity_total", water: "water_total" };
      const amountFields = { electricity: "electricity_amount", water: "water_amount" };

      // tenant별 배분 결과
      const distribution = {};
      tenants.forEach((t) => {
        distribution[t.id] = { electricity_amount: 0, water_amount: isWaterMonth ? 0 : undefined };
      });

      for (const utype of utilityTypes) {
        const totalCost = buildingBill[totalFields[utype]] || 0;
        if (totalCost === 0) continue;

        // 층별 사용량 조회
        const { rows: readings } = await pool.query(
          "SELECT tenant_id, floor, reading_value FROM meter_readings WHERE year=$1 AND month=$2 AND utility_type=$3",
          [year, month, utype]
        );

        // 층별 사용량 결정
        const floorUsages = [];
        let totalUsage = 0;
        for (const tf of allFloors) {
          const reading = readings.find((r) => r.tenant_id === tf.tenant_id && r.floor === tf.floor);
          const usage = reading?.reading_value != null ? parseFloat(reading.reading_value) : null;
          floorUsages.push({ tenantId: tf.tenant_id, floor: tf.floor, usage });
          if (usage != null && usage > 0) totalUsage += usage;
        }

        // 층별 배분 → tenant별 합산
        const validUsages = floorUsages.filter((u) => u.usage !== null && u.usage > 0);
        if (validUsages.length === 0) {
          // 균등 배분 (층 수 기준)
          const share = Math.round(totalCost / allFloors.length);
          let allocated = 0;
          allFloors.forEach((tf, idx) => {
            const amt = idx === allFloors.length - 1 ? totalCost - allocated : share;
            distribution[tf.tenant_id][amountFields[utype]] = (distribution[tf.tenant_id][amountFields[utype]] || 0) + amt;
            allocated += amt;
          });
        } else {
          // 사용량 비례 배분 (층별)
          let allocated = 0;
          validUsages.forEach((u, idx) => {
            const amt = idx === validUsages.length - 1
              ? totalCost - allocated
              : Math.round(totalCost * (u.usage / totalUsage));
            distribution[u.tenantId][amountFields[utype]] = (distribution[u.tenantId][amountFields[utype]] || 0) + amt;
            allocated += amt;
          });
        }
      }

      // Upsert: tenant 단위 1개 monthly_bill
      let updated = 0;
      for (const t of tenants) {
        const d = distribution[t.id];
        if (isWaterMonth) {
          await pool.query(
            `INSERT INTO monthly_bills (tenant_id, year, month, rent_amount, maintenance_fee, electricity_amount, water_amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (tenant_id, year, month) DO UPDATE SET
               electricity_amount=$6, water_amount=$7`,
            [t.id, year, month, t.rent_amount, t.maintenance_fee, d.electricity_amount || 0, d.water_amount || 0]
          );
        } else {
          await pool.query(
            `INSERT INTO monthly_bills (tenant_id, year, month, rent_amount, maintenance_fee, electricity_amount, water_amount)
             VALUES ($1,$2,$3,$4,$5,$6,0)
             ON CONFLICT (tenant_id, year, month) DO UPDATE SET
               electricity_amount=$6, water_amount=0`,
            [t.id, year, month, t.rent_amount, t.maintenance_fee, d.electricity_amount || 0]
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

  // 임대료/관리비 수동 발행 (자동 cron 누락 시 fallback)
  app.post("/monthly-bills/generate-rent", requireAdmin, async (req, res) => {
    const { year, month } = req.body;
    if (!year || !month) {
      return res.status(400).json({ error: "연도와 월은 필수입니다" });
    }
    try {
      const { rows: tenants } = await pool.query(
        "SELECT * FROM tenants WHERE is_active = TRUE"
      );
      if (tenants.length === 0) {
        return res.status(400).json({ error: "활성 입주사가 없습니다" });
      }
      let created = 0;
      for (const t of tenants) {
        const { rowCount } = await pool.query(
          `INSERT INTO monthly_bills (tenant_id, year, month, rent_amount, maintenance_fee)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, year, month) DO NOTHING`,
          [t.id, year, month, t.rent_amount, t.maintenance_fee]
        );
        if (rowCount > 0) created++;
      }
      res.json({ created, message: created > 0 ? `${created}건 임대료/관리비 발행 완료` : "이미 발행된 청구서가 있습니다" });
      if (created > 0) {
        await sendTelegramAlert(
          `📋 <b>임대료/관리비 수동 발행</b>\n📅 ${year}년 ${month}월\n✅ ${created}건 생성`
        );
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // Toggle payment status
  app.patch("/monthly-bills/:id/pay", requireAdmin, async (req, res) => {
    const { field } = req.body; // e.g. 'rent_paid', 'gas_paid', etc.
    const validFields = ["rent_paid", "maintenance_paid", "electricity_paid", "water_paid", "other_paid"];
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

  // Update other (기타) item
  app.patch("/monthly-bills/:id/other", requireAdmin, async (req, res) => {
    const { other_amount, other_label } = req.body;
    try {
      await pool.query(
        `UPDATE monthly_bills SET other_amount = $1, other_label = $2 WHERE id = $3`,
        [other_amount || 0, other_label || null, req.params.id]
      );
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // Bulk update monthly bills (Excel 대조 반영)
  app.patch("/monthly-bills/bulk-update", requireAdmin, async (req, res) => {
    const { year, month, updates } = req.body;
    if (!year || !month || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: "year, month, updates 배열이 필요합니다" });
    }
    try {
      let updated = 0;
      const errors = [];
      for (const u of updates) {
        const { floor, rent_amount, maintenance_fee, electricity_amount, water_amount, other_amount, other_label } = u;
        if (floor == null) { errors.push("floor 누락"); continue; }
        const { rows } = await pool.query(
          `SELECT tf.tenant_id as id FROM tenant_floors tf JOIN tenants t ON tf.tenant_id = t.id WHERE tf.floor = $1 AND t.is_active = true`, [floor]
        );
        if (rows.length === 0) { errors.push(`${floor}층: 입주사 없음`); continue; }
        const tenantId = rows[0].id;
        await pool.query(
          `INSERT INTO monthly_bills (tenant_id, year, month, rent_amount, maintenance_fee, electricity_amount, water_amount, other_amount, other_label)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id, year, month) DO UPDATE SET
             rent_amount=$4, maintenance_fee=$5, electricity_amount=$6, water_amount=$7, other_amount=$8, other_label=$9`,
          [tenantId, year, month, rent_amount || 0, maintenance_fee || 0, electricity_amount || 0, water_amount || 0, other_amount || 0, other_label || null]
        );
        updated++;
      }
      res.json({ updated, errors });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // ─── Monthly Bills: single update + delete ───────────────
  // PUT /monthly-bills/:id — 금액 수정
  app.put("/monthly-bills/:id", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { rent_amount, maintenance_fee, electricity_amount, water_amount, other_amount, other_label } = req.body;
    try {
      const { rows } = await pool.query("SELECT id FROM monthly_bills WHERE id = $1", [id]);
      if (rows.length === 0) return res.status(404).json({ error: "청구서를 찾을 수 없습니다" });
      await pool.query(
        `UPDATE monthly_bills SET rent_amount=$1, maintenance_fee=$2, electricity_amount=$3, water_amount=$4, other_amount=$5, other_label=$6 WHERE id=$7`,
        [rent_amount ?? 0, maintenance_fee ?? 0, electricity_amount ?? 0, water_amount ?? 0, other_amount ?? 0, other_label || null, id]
      );
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // DELETE /monthly-bills/:id — 단건 삭제
  app.delete("/monthly-bills/:id", requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
      const { rowCount } = await pool.query("DELETE FROM monthly_bills WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "청구서를 찾을 수 없습니다" });
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // ─── Tax Invoices API (monthly_bills 파생) ─────────────────
  const ITEM_TYPES = [
    { type: "rent", name: "임대료", amountField: "rent_amount" },
    { type: "maintenance", name: "관리비", amountField: "maintenance_fee" },
    { type: "electricity", name: "전기", amountField: "electricity_amount" },
    { type: "water", name: "수도", amountField: "water_amount" },
    { type: "other", name: "기타", amountField: "other_amount" },
  ];

  // GET /tax-invoices — monthly_bills 기반 파생 조회
  app.get("/tax-invoices", async (req, res) => {
    const { year, month } = req.query;
    try {
      let query = `
        SELECT mb.*, t.company_name, t.business_number, t.representative, t.address,
               t.business_type, t.business_item, t.email,
               t.tax_company_name, t.tax_representative, t.tax_address,
               t.tax_business_type, t.tax_business_item, t.tax_email, t.tax_email2,
               (SELECT array_agg(tf.floor ORDER BY tf.floor) FROM tenant_floors tf WHERE tf.tenant_id = t.id) as floors
        FROM monthly_bills mb
        JOIN tenants t ON mb.tenant_id = t.id
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
      query += " ORDER BY (SELECT MIN(tf.floor) FROM tenant_floors tf WHERE tf.tenant_id = t.id) ASC NULLS LAST";
      const { rows: bills } = await pool.query(query, params);

      // monthly_bills → 항목별 세금계산서 행으로 변환
      const result = [];
      for (const bill of bills) {
        for (const { type, name, amountField } of ITEM_TYPES) {
          const amount = bill[amountField] || 0;
          if (amount <= 0) continue;
          const itemName = type === "other" ? (bill.other_label || "기타") : name;
          const taxAmount = type === "water" ? 0 : Math.round(amount * 0.1);
          const totalAmount = amount + taxAmount;

          // tax_invoices에서 발행 상태 조회
          const { rows: tiRows } = await pool.query(
            `SELECT id, is_issued, issued_date, memo FROM tax_invoices
             WHERE tenant_id=$1 AND year=$2 AND month=$3 AND item_type=$4`,
            [bill.tenant_id, bill.year, bill.month, type]
          );
          const ti = tiRows[0];

          result.push({
            bill_id: bill.id,
            tenant_id: bill.tenant_id,
            year: bill.year,
            month: bill.month,
            item_type: type,
            item_name: itemName,
            supply_amount: amount,
            tax_amount: taxAmount,
            total_amount: totalAmount,
            is_issued: ti?.is_issued || false,
            issued_date: ti?.issued_date || null,
            memo: ti?.memo || null,
            floors: bill.floors,
            company_name: bill.company_name,
            business_number: bill.business_number,
            representative: bill.representative,
            address: bill.address,
            business_type: bill.business_type,
            business_item: bill.business_item,
            email: bill.email,
            tax_company_name: bill.tax_company_name,
            tax_representative: bill.tax_representative,
            tax_address: bill.tax_address,
            tax_business_type: bill.tax_business_type,
            tax_business_item: bill.tax_business_item,
            tax_email: bill.tax_email,
            tax_email2: bill.tax_email2,
          });
        }
      }
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // PATCH /tax-invoices/:billId/issue — 발행 토글 (billId + item_type body)
  app.patch("/tax-invoices/:billId/issue", requireAdmin, async (req, res) => {
    const { billId } = req.params;
    const { item_type } = req.body;
    if (!item_type) return res.status(400).json({ error: "item_type 필수" });
    try {
      // monthly_bills에서 tenant_id, year, month 조회
      const { rows: billRows } = await pool.query(
        "SELECT tenant_id, year, month FROM monthly_bills WHERE id = $1", [billId]
      );
      if (billRows.length === 0) return res.status(404).json({ error: "청구서를 찾을 수 없습니다" });
      const { tenant_id, year, month } = billRows[0];

      // 해당 금액 조회
      const amountField = ITEM_TYPES.find((t) => t.type === item_type)?.amountField;
      if (!amountField) return res.status(400).json({ error: "잘못된 item_type" });

      const { rows: mbRows } = await pool.query(
        `SELECT ${amountField}, other_label FROM monthly_bills WHERE id = $1`, [billId]
      );
      const amount = mbRows[0][amountField] || 0;
      if (amount <= 0) return res.status(400).json({ error: "해당 항목 금액이 0입니다" });

      const taxAmount = item_type === "water" ? 0 : Math.round(amount * 0.1);
      const totalAmount = amount + taxAmount;
      const itemName = item_type === "other" ? (mbRows[0].other_label || "기타") : ITEM_TYPES.find((t) => t.type === item_type)?.name;

      // tax_invoices UPSERT + 토글
      const { rows: existing } = await pool.query(
        `SELECT id, is_issued FROM tax_invoices WHERE tenant_id=$1 AND year=$2 AND month=$3 AND item_type=$4`,
        [tenant_id, year, month, item_type]
      );

      const today = new Date().toISOString().split("T")[0];
      if (existing.length > 0) {
        const newVal = !existing[0].is_issued;
        await pool.query(
          "UPDATE tax_invoices SET is_issued=$1, issued_date=$2, supply_amount=$3, tax_amount=$4, total_amount=$5, item_name=$6 WHERE id=$7",
          [newVal, newVal ? today : null, amount, taxAmount, totalAmount, itemName, existing[0].id]
        );
        res.json({ success: true, is_issued: newVal });
      } else {
        // 최초 발행: INSERT
        await pool.query(
          `INSERT INTO tax_invoices (tenant_id, year, month, item_type, item_name, supply_amount, tax_amount, total_amount, is_issued, issued_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9)`,
          [tenant_id, year, month, item_type, itemName, amount, taxAmount, totalAmount, today]
        );
        res.json({ success: true, is_issued: true });
      }
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
      const { rows: tenants } = await pool.query("SELECT * FROM tenants WHERE is_active = TRUE ORDER BY (SELECT MIN(floor) FROM tenant_floors WHERE tenant_id = tenants.id)");
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
      // 각 tenant의 floors 조회
      const { rows: tfRows } = await pool.query("SELECT tenant_id, floor FROM tenant_floors ORDER BY floor");
      const tfMap = {};
      tfRows.forEach((r) => { if (!tfMap[r.tenant_id]) tfMap[r.tenant_id] = []; tfMap[r.tenant_id].push(r.floor); });
      const targetInfo = targets.map((t) => ({
        floors: (tfMap[t.id] || [t.floor]).join(','),
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
        `SELECT mb.*, t.company_name, t.contact_phone,
          (SELECT array_agg(tf.floor ORDER BY tf.floor) FROM tenant_floors tf WHERE tf.tenant_id = t.id) as floors
         FROM monthly_bills mb
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
        return { floors: (b.floors || []).join(','), company: b.company_name, phone: b.contact_phone, unpaid };
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

  // ─── Auto Utility Distribution ──────────────────────────────
  // 검침 자동 배분: building_bills 미입력→스킵, reading 미입력→전월 1.5배
  async function autoDistributeUtility(utilityType, year, month) {
    const UTILITY_LABEL = { electricity: "⚡ 전기", water: "💧 수도" };
    const totalField = utilityType === "electricity" ? "electricity_total" : "water_total";
    const amountField = utilityType === "electricity" ? "electricity_amount" : "water_amount";
    const label = UTILITY_LABEL[utilityType] || utilityType;

    try {
      // 1. building_bills에서 해당 월 총액 조회
      const { rows: bbRows } = await pool.query(
        "SELECT * FROM building_bills WHERE year=$1 AND month=$2", [year, month]
      );
      const totalCost = bbRows[0]?.[totalField] || 0;
      if (totalCost === 0) {
        console.log(`[자동배분] ${year}/${month} ${utilityType} — 건물 공과금 미입력, 스킵`);
        await sendTelegramAlert(`⚠️ <b>${label} 건물 공과금 미입력</b>\n📅 ${year}년 ${month}월\n배분을 스킵합니다. 금액 입력 후 수동 배분해주세요.`);
        return;
      }

      // 2. 활성 입주사 목록 + 층별 매핑
      const { rows: tenants } = await pool.query(
        "SELECT * FROM tenants WHERE is_active = TRUE"
      );
      if (tenants.length === 0) return;

      const { rows: allFloors } = await pool.query(
        `SELECT tf.tenant_id, tf.floor FROM tenant_floors tf JOIN tenants t ON tf.tenant_id = t.id WHERE t.is_active = TRUE ORDER BY tf.floor ASC`
      );
      if (allFloors.length === 0) return;

      // 3. 해당 월 층별 사용량 조회
      const { rows: currentReadings } = await pool.query(
        "SELECT tenant_id, floor, reading_value FROM meter_readings WHERE year=$1 AND month=$2 AND utility_type=$3",
        [year, month, utilityType]
      );

      // 4. 전월 사용량 조회 (수도: 2달 전 홀수달, 전기: 직전 달)
      let prevYear = year, prevMonth;
      if (utilityType === "water") {
        prevMonth = month - 2;
      } else {
        prevMonth = month - 1;
      }
      if (prevMonth <= 0) { prevMonth += 12; prevYear--; }

      const { rows: prevReadings } = await pool.query(
        "SELECT tenant_id, floor, reading_value FROM meter_readings WHERE year=$1 AND month=$2 AND utility_type=$3",
        [prevYear, prevMonth, utilityType]
      );

      // 5. 층별 사용량 결정: 미입력 → 전월 1.5배
      const floorUsages = [];
      let totalUsage = 0;
      const autoFilledTenants = [];

      for (const tf of allFloors) {
        const current = currentReadings.find((r) => r.tenant_id === tf.tenant_id && r.floor === tf.floor);
        let usage = current?.reading_value != null ? parseFloat(current.reading_value) : null;

        if (usage === null) {
          const prev = prevReadings.find((r) => r.tenant_id === tf.tenant_id && r.floor === tf.floor);
          if (prev?.reading_value != null) {
            usage = Math.round(parseFloat(prev.reading_value) * 1.5 * 100) / 100;
            const tName = tenants.find((t) => t.id === tf.tenant_id)?.company_name || '';
            autoFilledTenants.push(`${tf.floor}층 ${tName} (${usage})`);
            // meter_readings에 자동값 기록
            await pool.query(
              `INSERT INTO meter_readings (tenant_id, floor, year, month, utility_type, reading_value)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (tenant_id, floor, year, month, utility_type)
               DO UPDATE SET reading_value = $6`,
              [tf.tenant_id, tf.floor, year, month, utilityType, usage]
            );
          }
        }

        floorUsages.push({ tenantId: tf.tenant_id, floor: tf.floor, usage });
        if (usage != null && usage > 0) totalUsage += usage;
      }

      // 6. 층별 배분 → tenant별 합산
      const distribution = {};
      for (const t of tenants) distribution[t.id] = 0;

      const validUsages = floorUsages.filter((u) => u.usage !== null && u.usage > 0);

      if (validUsages.length === 0) {
        const share = Math.round(totalCost / allFloors.length);
        let allocated = 0;
        allFloors.forEach((tf, idx) => {
          const amt = idx === allFloors.length - 1 ? totalCost - allocated : share;
          distribution[tf.tenant_id] = (distribution[tf.tenant_id] || 0) + amt;
          allocated += amt;
        });
      } else {
        let allocated = 0;
        validUsages.forEach((u, idx) => {
          const amt = idx === validUsages.length - 1
            ? totalCost - allocated
            : Math.round(totalCost * (u.usage / totalUsage));
          distribution[u.tenantId] = (distribution[u.tenantId] || 0) + amt;
          allocated += amt;
        });
      }

      // 7. monthly_bills UPSERT (tenant 단위)
      let updated = 0;
      for (const t of tenants) {
        await pool.query(
          `INSERT INTO monthly_bills (tenant_id, year, month, rent_amount, maintenance_fee, ${amountField})
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (tenant_id, year, month) DO UPDATE SET ${amountField}=$6`,
          [t.id, year, month, t.rent_amount, t.maintenance_fee, distribution[t.id] || 0]
        );
        updated++;
      }

      // 8. 텔레그램 알림
      let msg = `📋 <b>${label} 자동 배분 완료</b>\n📅 ${year}년 ${month}월\n✅ ${updated}건 청구서 업데이트\n💰 총액: ${totalCost.toLocaleString()}원`;
      if (autoFilledTenants.length > 0) {
        msg += `\n⚠️ 미제출 1.5배 적용: ${autoFilledTenants.join(", ")}`;
      }
      await sendTelegramAlert(msg);
      console.log(`[자동배분] ${year}/${month} ${utilityType} — ${updated}건 완료`);
    } catch (err) {
      console.error(`[자동배분] ${utilityType} 오류:`, err.message);
      await sendTelegramAlert(`❌ <b>${label} 자동 배분 실패</b>\n📅 ${year}년 ${month}월\n오류: ${err.message}`);
    }
  }

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

  // 매일 00:05 KST (= 15:05 UTC) 실행 — 말일에만 실제 동작 + 검침 자동 배분
  cron.schedule("5 15 * * *", () => {
    autoGenerateRentBills();
    autoDistributeCheck();
  });

  // 검침 자동 배분 체크 (매일 실행, 특정 날짜에만 동작)
  async function autoDistributeCheck() {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const day = now.getDate();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    // 매월 24일: 전기 자동 배분
    if (day === 24) {
      await autoDistributeUtility("electricity", year, month);
    }
    // 홀수달 8일: 수도 자동 배분
    if (day === 8 && month % 2 === 1) {
      await autoDistributeUtility("water", year, month);
    }
  }

  // 매일 09:00 KST (= 00:00 UTC) 미납 현황 알림
  async function checkUnpaidAlert() {
    try {
      const { rows } = await pool.query(
        `SELECT mb.year, mb.month, t.company_name,
                (SELECT array_agg(tf.floor ORDER BY tf.floor) FROM tenant_floors tf WHERE tf.tenant_id = t.id) as floors,
                mb.rent_paid, mb.maintenance_paid, mb.electricity_paid, mb.water_paid,
                mb.rent_amount, mb.maintenance_fee, mb.electricity_amount, mb.water_amount
         FROM monthly_bills mb JOIN tenants t ON t.id = mb.tenant_id
         WHERE (mb.rent_paid = FALSE OR mb.maintenance_paid = FALSE
                OR mb.electricity_paid = FALSE OR mb.water_paid = FALSE)
           AND (mb.rent_amount > 0 OR mb.maintenance_fee > 0 OR mb.electricity_amount > 0 OR mb.water_amount > 0)
         ORDER BY mb.year DESC, mb.month DESC, (SELECT MIN(tf.floor) FROM tenant_floors tf WHERE tf.tenant_id = t.id) ASC`
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
          const floorStr = (b.floors || []).join(',');
          lines.push(`📍 ${floorStr}층 ${b.company_name} (${b.year}/${String(b.month).padStart(2,"0")}) — ${unpaid.join(", ")}`);
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

  // ─── Partners API ─────────────────────────────────────────
  app.get("/partners", requireAdmin, async (req, res) => {
    const { type } = req.query;
    try {
      let query = "SELECT id, type, name, contact_phone, memo, business_number, company_name, representative, bank_name, bank_account, bank_holder, is_active, biz_doc_filename, bank_doc_filename, payment_day, created_at FROM partners";
      const params = [];
      if (type) {
        query += " WHERE type = $1";
        params.push(type);
      }
      query += " ORDER BY created_at DESC";
      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.post("/partners", requireAdmin, async (req, res) => {
    const { type, name, contact_phone, memo, business_number, company_name, representative, bank_name, bank_account, bank_holder, is_active, payment_day, biz_doc_base64, biz_doc_filename, bank_doc_base64, bank_doc_filename } = req.body;
    if (!type || !name) {
      return res.status(400).json({ error: "유형과 이름은 필수입니다" });
    }
    if (!["employee", "vendor"].includes(type)) {
      return res.status(400).json({ error: "유형은 employee 또는 vendor만 가능합니다" });
    }
    try {
      // 이미지 검증 헬퍼
      const validateImage = (base64, filename) => {
        const data = base64.replace(/^data:[^;]+;base64,/, "");
        const buf = Buffer.from(data, "base64");
        if (buf.length > 5 * 1024 * 1024) return { error: "파일 크기는 5MB 이하여야 합니다" };
        const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
        const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
        if (!isJpeg && !isPng) return { error: "JPEG 또는 PNG 이미지만 업로드 가능합니다" };
        const safe = filename ? path.basename(filename).replace(/[^a-zA-Z0-9가-힣._-]/g, "_") : null;
        return { buf, safe };
      };

      let docBuf = null, docSafe = null;
      if (biz_doc_base64) {
        const v = validateImage(biz_doc_base64, biz_doc_filename);
        if (v.error) return res.status(400).json({ error: v.error });
        docBuf = v.buf; docSafe = v.safe;
      }
      let bankBuf = null, bankSafe = null;
      if (bank_doc_base64) {
        const v = validateImage(bank_doc_base64, bank_doc_filename);
        if (v.error) return res.status(400).json({ error: v.error });
        bankBuf = v.buf; bankSafe = v.safe;
      }

      const { rows } = await pool.query(
        `INSERT INTO partners (type, name, contact_phone, memo, business_number, company_name, representative, bank_name, bank_account, bank_holder, is_active, biz_doc, biz_doc_filename, bank_doc, bank_doc_filename, payment_day)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [type, name, contact_phone || null, memo || null, business_number || null, company_name || null, representative || null, bank_name || null, bank_account || null, bank_holder || null, is_active !== false, docBuf, docSafe, bankBuf, bankSafe, payment_day || null]
      );
      res.json({ id: rows[0].id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.put("/partners/:id", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { type, name, contact_phone, memo, business_number, company_name, representative, bank_name, bank_account, bank_holder, is_active, payment_day, biz_doc_base64, biz_doc_filename, bank_doc_base64, bank_doc_filename } = req.body;
    try {
      const validateImage = (base64, filename) => {
        const data = base64.replace(/^data:[^;]+;base64,/, "");
        const buf = Buffer.from(data, "base64");
        if (buf.length > 5 * 1024 * 1024) return { error: "파일 크기는 5MB 이하여야 합니다" };
        const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
        const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
        if (!isJpeg && !isPng) return { error: "JPEG 또는 PNG 이미지만 업로드 가능합니다" };
        const safe = filename ? path.basename(filename).replace(/[^a-zA-Z0-9가-힣._-]/g, "_") : null;
        return { buf, safe };
      };

      let docBuf = undefined, docSafe = undefined;
      if (biz_doc_base64) {
        const v = validateImage(biz_doc_base64, biz_doc_filename);
        if (v.error) return res.status(400).json({ error: v.error });
        docBuf = v.buf; docSafe = v.safe;
      }
      let bankBuf = undefined, bankSafe = undefined;
      if (bank_doc_base64) {
        const v = validateImage(bank_doc_base64, bank_doc_filename);
        if (v.error) return res.status(400).json({ error: v.error });
        bankBuf = v.buf; bankSafe = v.safe;
      }

      let query = `UPDATE partners SET type=COALESCE($1,type), name=COALESCE($2,name), contact_phone=$3, memo=$4, business_number=$5, company_name=$6, representative=$7, bank_name=$8, bank_account=$9, bank_holder=$10, is_active=COALESCE($11,is_active), payment_day=$12`;
      const params = [type, name, contact_phone ?? null, memo ?? null, business_number ?? null, company_name ?? null, representative ?? null, bank_name ?? null, bank_account ?? null, bank_holder ?? null, is_active, payment_day ?? null];
      if (docBuf !== undefined) {
        query += `, biz_doc=$${params.length + 1}, biz_doc_filename=$${params.length + 2}`;
        params.push(docBuf, docSafe);
      }
      if (bankBuf !== undefined) {
        query += `, bank_doc=$${params.length + 1}, bank_doc_filename=$${params.length + 2}`;
        params.push(bankBuf, bankSafe);
      }
      query += ` WHERE id=$${params.length + 1}`;
      params.push(id);
      await pool.query(query, params);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.delete("/partners/:id", requireAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM partners WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.get("/partners/:id/biz-doc", requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT biz_doc, biz_doc_filename FROM partners WHERE id = $1", [req.params.id]);
      if (rows.length === 0 || !rows[0].biz_doc) {
        return res.status(404).json({ error: "파일이 없습니다" });
      }
      const buf = rows[0].biz_doc;
      const filename = rows[0].biz_doc_filename || "document.jpg";
      const ext = filename.split(".").pop().toLowerCase();
      const mimeMap = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
      res.set("Content-Type", mimeMap[ext] || "image/jpeg");
      res.send(buf);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.get("/partners/:id/bank-doc", requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT bank_doc, bank_doc_filename FROM partners WHERE id = $1", [req.params.id]);
      if (rows.length === 0 || !rows[0].bank_doc) {
        return res.status(404).json({ error: "파일이 없습니다" });
      }
      const buf = rows[0].bank_doc;
      const filename = rows[0].bank_doc_filename || "document.jpg";
      const ext = filename.split(".").pop().toLowerCase();
      const mimeMap = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
      res.set("Content-Type", mimeMap[ext] || "image/jpeg");
      res.send(buf);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // ─── Partner Payments API ───────────────────────────────────
  app.get("/partner-payments", requireAdmin, async (req, res) => {
    const { partner_id, year, month } = req.query;
    try {
      let query = "SELECT pp.*, p.name as partner_name, p.type as partner_type FROM partner_payments pp JOIN partners p ON pp.partner_id = p.id WHERE 1=1";
      const params = [];
      if (partner_id) {
        query += ` AND pp.partner_id = $${params.length + 1}`;
        params.push(Number(partner_id));
      }
      if (year) {
        query += ` AND pp.year = $${params.length + 1}`;
        params.push(Number(year));
      }
      if (month) {
        query += ` AND pp.month = $${params.length + 1}`;
        params.push(Number(month));
      }
      query += " ORDER BY pp.year DESC, pp.month DESC";
      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.post("/partner-payments", requireAdmin, async (req, res) => {
    const { partner_id, year, month, amount, payment_date, memo, is_paid } = req.body;
    if (!partner_id || !year || !month) {
      return res.status(400).json({ error: "협력사, 연도, 월은 필수입니다" });
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO partner_payments (partner_id, year, month, amount, payment_date, memo, is_paid)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (partner_id, year, month) DO UPDATE SET
           amount=$4, payment_date=$5, memo=$6, is_paid=$7
         RETURNING id`,
        [partner_id, year, month, amount || 0, payment_date || null, memo || null, is_paid || false]
      );
      res.json({ id: rows[0].id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.patch("/partner-payments/:id/pay", requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT is_paid FROM partner_payments WHERE id = $1", [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: "지급 내역을 찾을 수 없습니다" });
      const newVal = !rows[0].is_paid;
      const today = new Date().toISOString().split("T")[0];
      await pool.query(
        "UPDATE partner_payments SET is_paid = $1, payment_date = $2 WHERE id = $3",
        [newVal, newVal ? today : null, req.params.id]
      );
      res.json({ success: true, is_paid: newVal });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.delete("/partner-payments/:id", requireAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM partner_payments WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  app.get("/partner-payments/summary", requireAdmin, async (req, res) => {
    try {
      const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const { rows } = await pool.query(
        `SELECT is_paid, COUNT(*)::int as count, COALESCE(SUM(amount),0)::int as total
         FROM partner_payments WHERE year=$1 AND month=$2
         GROUP BY is_paid`,
        [year, month]
      );
      const paid = rows.find((r) => r.is_paid === true) || { count: 0, total: 0 };
      const unpaid = rows.find((r) => r.is_paid === false) || { count: 0, total: 0 };
      res.json({ year, month, paid: { count: paid.count, total: paid.total }, unpaid: { count: unpaid.count, total: unpaid.total } });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  });

  // ─── Partner Payments Schedule API ─────────────────────────
  app.get("/partner-payments/schedule", requireAdmin, async (req, res) => {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ error: "year, month는 필수입니다" });
    try {
      const { rows } = await pool.query(
        `SELECT p.id, p.name, p.type, p.payment_day, p.bank_name, p.bank_account,
                pp.id as payment_id, pp.amount, pp.is_paid, pp.payment_date, pp.memo
         FROM partners p
         LEFT JOIN partner_payments pp ON pp.partner_id = p.id AND pp.year = $1 AND pp.month = $2
         WHERE p.is_active = TRUE
         ORDER BY p.payment_day ASC NULLS LAST, p.name ASC`,
        [Number(year), Number(month)]
      );
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
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
      const { rows: tenantRows } = await pool.query("SELECT company_name FROM tenants WHERE id = $1", [req.user.id]);
      if (tenantRows.length === 0) return res.status(404).json({ error: "입주사 정보를 찾을 수 없습니다" });
      const { company_name } = tenantRows[0];
      // 다중층 tenant: body에서 floor를 받거나, 단일층이면 자동
      const { rows: tfRows } = await pool.query("SELECT floor FROM tenant_floors WHERE tenant_id = $1 ORDER BY floor", [req.user.id]);
      const reqFloor = req.body.floor ? Number(req.body.floor) : null;
      const inquiryFloor = reqFloor || (tfRows.length === 1 ? tfRows[0].floor : tfRows[0]?.floor || 0);
      const floorsStr = tfRows.map(f => f.floor).join(',');
      const { rows } = await pool.query(
        "INSERT INTO inquiries (tenant_id, floor, company_name, category, content) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at",
        [req.user.id, inquiryFloor, company_name, category, String(content).trim()]
      );
      const now = new Date(rows[0].created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
      await sendTelegramAlert(`🔔 <b>새 문의 접수</b>\n📍 ${floorsStr}층 ${company_name}\n📋 ${category}\n💬 ${String(content).trim()}\n🕐 ${now}`);
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
