# 임대 관리 시스템 (rental)

도산빌딩 임대료·관리비·공과금 관리 시스템.
매월 계량기 사진 수집 → 사용량 비례 공과금 배분 → 항목별 납부 확인 → SMS 알림.

## 도메인 & 인프라

| 항목 | 값 |
|------|-----|
| 도메인 | https://dosan.creable.work |
| 서버 | AWS Lightsail 43.203.204.208 |
| GitHub | tandangji/rental |
| 배포 | GitHub Actions → SSH → docker compose build/up |
| DB | PostgreSQL 17 (Docker 내부, 포트 5432) |
| 내부 포트 | 3000 (nginx 리버스 프록시, SSL) |

## 기술 스택

- **서버**: Node.js 20 + Express 5 + PostgreSQL (pg)
- **클라이언트**: React 19 + Vite + Tailwind CSS 3 + Lucide Icons
- **PDF**: html2canvas + jspdf (클라이언트)
- **이미지 압축**: Canvas API (1280px, JPEG 70%)
- **인증**: in-memory sessions Map + Bearer 토큰
- **배포**: Docker + nginx + Let's Encrypt SSL

## 빌드 & 실행

```bash
npm run build    # server npm install + client npm install + vite build
npm start        # node server/index.js
```

## 프로젝트 구조

```
rental/
├── package.json
├── Dockerfile
├── .github/workflows/deploy.yml
├── server/
│   ├── package.json
│   └── index.js              # 모든 API 라우트, DB 스키마, auth, cron
└── client/
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.cjs
    └── src/
        ├── main.jsx
        ├── App.jsx                # 세션 관리 + 역할별 탭 라우팅
        ├── utils/
        │   ├── api.js             # API_BASE, authFetch, getToken
        │   └── imageCompress.js   # 클라이언트 이미지 압축
        └── components/
            ├── LoginForm.jsx          # 로그인 (건물주/입주사 탭)
            ├── AdminDashboard.jsx     # 건물주 대시보드
            ├── TenantManage.jsx       # 입주사 CRUD 목록
            ├── TenantForm.jsx         # 입주사 등록/수정 모달
            ├── MeterOverview.jsx      # 건물주 검침 현황 (3열 그리드)
            ├── MeterUpload.jsx        # 입주사 계량기 사진 업로드
            ├── BuildingBillForm.jsx   # 건물 전체 공과금 입력 (아코디언)
            ├── BillingView.jsx        # 건물주 청구서 관리
            ├── TaxInvoiceView.jsx     # 세금계산서 관리
            ├── SettingsView.jsx       # 시스템 설정
            ├── TenantDashboard.jsx    # 입주사 홈 (계약정보+청구)
            ├── MyBillView.jsx         # 입주사 청구서 (PDF 다운로드)
            └── BankInfo.jsx           # 입금 계좌 안내 (복사 기능)
```

## 역할 & 권한

| 역할 | 로그인 방식 | session.role | 접근 범위 |
|------|------------|-------------|----------|
| 건물주 | ADMIN_PASSWORD | `admin` | 전체 관리 |
| 입주사 | 업체명 + 비밀번호 | `tenant` | 본인 층만 조회/업로드 |

## DB 스키마 (6개 테이블)

### tenants (입주사)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| floor | INTEGER UNIQUE | 층수 |
| company_name | TEXT | 업체명 |
| business_number | TEXT | 사업자등록번호 |
| representative | TEXT | 대표자명 |
| business_type | TEXT | 업종 |
| business_item | TEXT | 업태 |
| address | TEXT | 사업장 주소 |
| contact_phone | TEXT | 연락처 (SMS용) |
| email | TEXT | 이메일 |
| password | TEXT | 로그인 비밀번호 (기본: 층수 4자리) |
| rent_amount | INTEGER | 월 임대료 |
| maintenance_fee | INTEGER | 월 관리비 |
| deposit_amount | INTEGER | 보증금 |
| lease_start | DATE | 계약 시작일 |
| lease_end | DATE | 계약 종료일 |
| billing_day | INTEGER | 청구일 (1~28) |
| payment_type | TEXT | 납부방식 (prepaid/postpaid) |
| is_active | BOOLEAN | 활성 여부 |

### monthly_bills (월별 청구서)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| tenant_id | FK → tenants | |
| year, month | INTEGER | |
| rent_amount | INTEGER | 임대료 |
| maintenance_fee | INTEGER | 관리비 |
| gas_amount | INTEGER | 가스 배분액 |
| electricity_amount | INTEGER | 전기 배분액 |
| water_amount | INTEGER | 수도 배분액 |
| rent_paid ~ water_paid | BOOLEAN | 항목별 납부 여부 |
| rent_paid_date ~ water_paid_date | DATE | 납부일 |
| UNIQUE(tenant_id, year, month) | | |

### meter_readings (계량기 검침)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| tenant_id | FK → tenants | |
| year, month | INTEGER | |
| utility_type | TEXT | gas / electricity / water |
| reading_value | NUMERIC(12,2) | 사용량 (건물주 입력) |
| photo | BYTEA | 계량기 사진 |
| photo_filename | TEXT | |
| uploaded_at | TIMESTAMP | |
| UNIQUE(tenant_id, year, month, utility_type) | | |

### building_bills (건물 전체 공과금)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| year, month | INTEGER | |
| gas_total | INTEGER | 가스 총액 |
| electricity_total | INTEGER | 전기 총액 |
| water_total | INTEGER | 수도 총액 |
| UNIQUE(year, month) | | |

### tax_invoices (세금계산서)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| tenant_id | FK → tenants | |
| year, month | INTEGER | |
| item_type | TEXT | rent/maintenance/gas/electricity/water |
| supply_amount | INTEGER | 공급가액 |
| tax_amount | INTEGER | 세액 (supply × 0.1) |
| total_amount | INTEGER | 총금액 |
| issued_date | DATE | 발행일 |
| is_issued | BOOLEAN | 발행 여부 |
| UNIQUE INDEX(tenant_id, year, month, item_type) | | |

### settings (시스템 설정)
key-value 구조: building_name, landlord_name, landlord_business_number, landlord_phone, bank_name, bank_account, bank_holder, sms_api_key, sms_sender_number

## API 엔드포인트

### 인증
| Method | Path | 설명 |
|--------|------|------|
| POST | /login | 로그인 |
| POST | /logout | 로그아웃 |

### 입주사 (requireAdmin, GET은 인증)
| Method | Path | 설명 |
|--------|------|------|
| GET | /tenants | 목록 (입주사: 본인만) |
| POST | /tenants | 등록 |
| PUT | /tenants/:id | 수정 |
| DELETE | /tenants/:id | 삭제 |

### 계량기 검침
| Method | Path | 권한 | 설명 |
|--------|------|------|------|
| GET | /meter-readings | 인증 | 목록 |
| POST | /meter-readings | 인증 | 사진 업로드 / 생성 |
| PUT | /meter-readings/:id | admin | 사용량 입력 |
| GET | /meter-readings/:id/photo | 인증 (query token) | 사진 조회 |
| DELETE | /meter-readings/:id/photo | admin | 사진 삭제 |

### 건물 공과금 (requireAdmin)
| Method | Path | 설명 |
|--------|------|------|
| GET | /building-bills | 조회 |
| POST | /building-bills | 입력 (upsert) |

### 월별 청구서
| Method | Path | 권한 | 설명 |
|--------|------|------|------|
| GET | /monthly-bills | 인증 | 목록 |
| POST | /monthly-bills/generate | admin | 공과금 배분 + 청구서 생성 |
| PATCH | /monthly-bills/:id/pay | admin | 납부 확인 토글 |

### 세금계산서
| Method | Path | 권한 | 설명 |
|--------|------|------|------|
| GET | /tax-invoices | 인증 | 항목별 목록 |
| PATCH | /tax-invoices/:billId/issue | admin | 발행 처리 (item_type 지정) |

### 설정 (requireAdmin)
| Method | Path | 설명 |
|--------|------|------|
| GET | /settings | 조회 |
| PUT | /settings | 일괄 수정 |

### SMS (requireAdmin)
| Method | Path | 설명 |
|--------|------|------|
| POST | /sms/remind-meter | 검침 사진 알림 |
| POST | /sms/remind-payment | 미납 알림 |

## 공과금 배분 로직

1. 각 층 사용량 = `reading_value` (당월 입력값 그대로)
2. 총 사용량 = 전체 층 사용량 합계
3. 각 층 배분 = 건물 전체 공과금 × (해당 층 사용량 / 총 사용량)
4. `Math.round()` 처리, 반올림 오차는 마지막 층에서 보정
5. 사용량 0인 층은 제외, 전체 0이면 균등 배분

## 부가세 처리

- DB 저장 금액 = 공급가액 (부가세 미포함)
- 부가세 = `Math.round(공급가액 × 0.1)`
- 합계 = 공급가액 + 부가세
- 화면 표시: 합계(메인) + 공급가액/세액(소텍스트)

## 자동 청구서 생성 (cron)

- 매일 00:05 KST (= 15:05 UTC) 실행
- 각 입주사의 `billing_day`와 오늘 일자 비교
- **선불(prepaid)**: 당월 청구서 생성
- **후불(postpaid)**: 전월 청구서 생성
- 임대료 + 관리비만 자동 생성 (공과금은 수동 배분)

## 월간 워크플로우

```
매월 1~5일: SMS 계량기 촬영 알림 발송
     ↓
입주사: 계량기 사진 3장 업로드 (가스/전기/수도)
     ↓
건물주: 사진 확인 → 사용량 입력
     ↓
건물주: 건물 전체 공과금 입력
     ↓
건물주: "공과금 배분" → 자동 배분 + 청구서 업데이트
     ↓
건물주: 입금 확인 → 항목별 납부 확인
     ↓
건물주: 세금계산서 발행 (선택)
```

## 환경변수

| 변수 | 설명 |
|------|------|
| ADMIN_PASSWORD | 건물주 로그인 비밀번호 (필수) |
| DATABASE_URL | PostgreSQL 연결 문자열 (필수) |
| PORT | 서버 포트 (기본 3000) |
| ALLOWED_ORIGINS | CORS 허용 도메인 |
| NODE_ENV | production |

## 주의사항

- 사진 endpoint(`GET /meter-readings/:id/photo`)는 auth 미들웨어 전에 정의됨 (img src에서 `?token=` 쿼리 파라미터로 인증)
- 로그인 시 `localStorage`에 세션 즉시 저장 (자식 컴포넌트 마운트 전)
- 모바일 퍼스트 레이아웃 — 기존 레이아웃을 임의로 변경하지 말 것
- 이미지는 클라이언트에서 1280px/JPEG 70%로 압축 후 업로드

## 버전 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1.0 | 2026-02-26 | 초기 구현 (전체 시스템) |
| v1.1 | 2026-02-26 | 입주사 settings 민감 정보 필터링 (sms_api_key, sms_sender_number) |
| v1.2 | 2026-02-27 | 보안 강화: helmet, rate-limit, 세션 TTL 8시간, 업로드 검증(매직바이트+5MB), 파일명 sanitize |
| v1.3 | 2026-02-27 | React ErrorBoundary 추가 (렌더링 에러 시 안내 UI) |
