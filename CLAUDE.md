# 임대 관리 시스템 (rental)

도산빌딩 임대료·관리비·공과금 관리 시스템.
계량기 사진 수집(전기 매월/수도 격월) → 사용량 비례 공과금 배분 → 항목별 납부 확인 → SMS 알림.

## 도메인 & 인프라

| 항목 | 값 |
|------|-----|
| 도메인 | https://dosan.creable.work |
| 서버 | AWS Lightsail 43.203.204.208 |
| GitHub | tandangji/rental |
| 배포 | GitHub Actions → SSH → docker compose build/up |
| DB | AWS Lightsail Managed Database (PostgreSQL 16, creable-db) — `rental_db` |
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
            ├── BillingView.jsx        # 건물주 청구서 관리 (인라인 금액 편집 + 삭제)
            ├── TaxInvoiceView.jsx     # 세금계산서 (monthly_bills 파생, 발행 토글만)
            ├── SettingsView.jsx       # 설정 (서브탭: 기본 설정/입주사/협력사/지급 관리)
            ├── PartnerManage.jsx      # 협력사 CRUD 목록 + 지급내역
            ├── PartnerForm.jsx        # 협력사 등록/수정 모달
            ├── PaymentManage.jsx      # 지급 관리 (월별 협력사 지급 현황)
            ├── TenantDashboard.jsx    # 입주사 홈 (계약정보+청구)
            ├── MyBillView.jsx         # 입주사 청구서 (PDF 다운로드)
            ├── BankInfo.jsx           # 입금 계좌 안내 (복사 기능)
            ├── InquiryForm.jsx        # 입주사 문의 제출
            └── InquiryList.jsx        # 관리자 문의 목록 (처리 토글·삭제)
```

## 역할 & 권한

| 역할 | 로그인 방식 | session.role | 접근 범위 |
|------|------------|-------------|----------|
| 건물주 | ADMIN_PASSWORD | `admin` | 전체 관리 |
| 입주사 | 업체명 + 비밀번호 | `tenant` | 본인 층(들)만 조회/업로드, session.floors 배열 |

## DB 스키마 (9개 테이블)

### tenants (입주사)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| floor | INTEGER (nullable) | 대표 층수 (레거시, tenant_floors 사용 권장) |
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
| tax_company_name | TEXT | 세금계산서 공급받는자 상호 |
| tax_representative | TEXT | 세금계산서 공급받는자 성명 |
| tax_address | TEXT | 세금계산서 공급받는자 주소 |
| tax_business_type | TEXT | 세금계산서 공급받는자 업태 |
| tax_business_item | TEXT | 세금계산서 공급받는자 종목 |
| tax_email | TEXT | 세금계산서 공급받는자 이메일1 |
| tax_email2 | TEXT | 세금계산서 공급받는자 이메일2 |

### tenant_floors (입주사 층 매핑 — 다중층 지원)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| tenant_id | FK → tenants | |
| floor | INTEGER UNIQUE NOT NULL | 층수 |

### monthly_bills (월별 청구서)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| tenant_id | FK → tenants | |
| year, month | INTEGER | |
| rent_amount | INTEGER | 임대료 |
| maintenance_fee | INTEGER | 관리비 |
| electricity_amount | INTEGER | 전기 배분액 |
| water_amount | INTEGER | 수도 배분액 |
| other_amount | INTEGER | 기타 항목 금액 |
| other_label | TEXT | 기타 항목명 (예: 재활용비) |
| rent_paid, maintenance_paid, electricity_paid, water_paid, other_paid | BOOLEAN | 항목별 납부 여부 |
| rent_paid_date ~ water_paid_date, other_paid_date | DATE | 납부일 |
| ※ gas_amount, gas_paid, gas_paid_date 컬럼은 DB에 존재하지만 코드에서 미사용 (DEFAULT 0) |
| UNIQUE(tenant_id, year, month) | | |

### meter_readings (계량기 검침)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| tenant_id | FK → tenants | |
| floor | INTEGER | 층수 (다중층 tenant 구분) |
| year, month | INTEGER | |
| utility_type | TEXT | electricity / water |
| reading_value | NUMERIC(12,2) | 사용량 (건물주 입력) |
| photo | BYTEA | 계량기 사진 |
| photo_filename | TEXT | |
| sub_meter | TEXT | 서브계량기 키 (5층 수도: hair_cold/hair_hot/laundry_cold/laundry_hot, 기타 NULL) |
| uploaded_at | TIMESTAMP | |
| UNIQUE(tenant_id, floor, year, month, utility_type, COALESCE(sub_meter, '')) | | |

### building_bills (건물 전체 공과금)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| year, month | INTEGER | |
| electricity_total | INTEGER | 전기 총액 |
| ※ gas_total 컬럼은 DB에 존재하지만 코드에서 미사용 (DEFAULT 0) |
| water_total | INTEGER | 수도 총액 |
| UNIQUE(year, month) | | |

### tax_invoices (세금계산서)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| tenant_id | FK → tenants | |
| year, month | INTEGER | |
| item_type | TEXT | rent/maintenance/electricity/water/other |
| item_name | TEXT | 품목명 (초안 생성 시 자동, 이후 수정 가능) |
| supply_amount | INTEGER | 공급가액 |
| tax_amount | INTEGER | 세액 (supply × 0.1) |
| total_amount | INTEGER | 총금액 |
| issued_date | DATE | 발행일 |
| is_issued | BOOLEAN | 발행 여부 |
| memo | TEXT | 메모 |
| UNIQUE INDEX(tenant_id, year, month, item_type) | | |

### settings (시스템 설정)
key-value 구조: building_name, landlord_name, landlord_business_number, landlord_phone, bank_name, bank_account, bank_holder, sms_api_key, sms_sender_number, tax_supplier_company, tax_supplier_name, tax_supplier_biz_no, tax_supplier_address, tax_supplier_business_type, tax_supplier_business_item, tax_supplier_email

### partners (협력사/직원)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| type | TEXT NOT NULL | 'employee' / 'vendor' |
| name | TEXT NOT NULL | 이름/업체명 |
| contact_phone | TEXT | 연락처 |
| memo | TEXT | 메모 |
| business_number | TEXT | 사업자등록번호 |
| company_name | TEXT | 회사명 |
| representative | TEXT | 대표자 |
| bank_name | TEXT | 은행명 |
| bank_account | TEXT | 계좌번호 |
| bank_holder | TEXT | 예금주 |
| is_active | BOOLEAN | 활성 여부 |
| biz_doc | BYTEA | 사업자등록증 이미지 |
| biz_doc_filename | TEXT | 파일명 |
| payment_day | INTEGER | 납기일 (매월 N일, 1~28) |

### partner_payments (협력사 지급내역)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| partner_id | FK → partners | |
| year, month | INTEGER | |
| amount | INTEGER | 지급액 |
| payment_date | DATE | 지급일 |
| memo | TEXT | 메모 |
| is_paid | BOOLEAN | 지급 완료 여부 |
| UNIQUE(partner_id, year, month) | | |

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
| POST | /monthly-bills/generate-rent | admin | 임대료/관리비 수동 발행 (cron 누락 시 fallback) |
| PUT | /monthly-bills/:id | admin | 금액 수정 (rent_amount, maintenance_fee, electricity/water/other_amount, other_label) |
| DELETE | /monthly-bills/:id | admin | 단건 삭제 |
| PATCH | /monthly-bills/:id/pay | admin | 납부 확인 토글 |
| PATCH | /monthly-bills/:id/other | admin | 기타 항목 수정 (other_amount, other_label) |
| PATCH | /monthly-bills/bulk-update | admin | Excel 대조 일괄 반영 (floor 기준 매칭, UPSERT) |

### 세금계산서 (monthly_bills 파생)
| Method | Path | 권한 | 설명 |
|--------|------|------|------|
| GET | /tax-invoices | 인증 | 항목별 목록 (monthly_bills 기반 파생, tax_invoices에서 발행 상태 조회) |
| PATCH | /tax-invoices/:billId/issue | admin | 발행 토글 (body: { item_type }) |

### 협력사 (requireAdmin)
| Method | Path | 설명 |
|--------|------|------|
| GET | /partners | 목록 (?type=employee/vendor) |
| POST | /partners | 등록 (biz_doc_base64 포함) |
| PUT | /partners/:id | 수정 |
| DELETE | /partners/:id | 삭제 (cascade) |
| GET | /partners/:id/biz-doc | 사업자등록증 이미지 |

### 협력사 지급 (requireAdmin)
| Method | Path | 설명 |
|--------|------|------|
| GET | /partner-payments | 목록 (?partner_id, ?year, ?month) |
| POST | /partner-payments | 등록 (UPSERT) |
| PATCH | /partner-payments/:id/pay | 지급 토글 |
| DELETE | /partner-payments/:id | 삭제 |
| GET | /partner-payments/summary | 대시보드 요약 (이번 달) |
| GET | /partner-payments/schedule | 월별 지급 일정 (?year, ?month) — partners LEFT JOIN partner_payments |

### 문의 (Inquiries)
| Method | Path | 권한 | 설명 |
|--------|------|------|------|
| POST | /inquiries | tenant | 문의 제출 (텔레그램 알림 발송) |
| GET | /inquiries | admin | 전체 목록 |
| PATCH | /inquiries/:id/resolve | admin | 처리 상태 토글 |
| DELETE | /inquiries/:id | admin | 삭제 |

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

1. `tenant_floors` 기준 활성 층 목록 조회
2. 각 층 사용량 = `reading_value` (당월 입력값 그대로, `meter_readings.floor` 기준)
3. 총 사용량 = 전체 층 사용량 합계
4. **층별 배분** = 건물 전체 공과금 × (해당 층 사용량 / 총 사용량)
5. **동일 tenant의 층별 배분액 합산** → `monthly_bills` 1건 (tenant 단위)
6. `Math.round()` 처리, 반올림 오차는 마지막 항목에서 보정
7. 사용량 0인 층은 제외, 전체 0이면 균등 배분 (층 수 기준)
8. 미제출: 전월(수도: 2달 전 홀수달) reading_value × 1.5 자동 적용
9. 전월 데이터도 없으면 균등 배분에 포함

## 부가세 처리

- DB 저장 금액 = 공급가액 (부가세 미포함)
- 임대료·관리비·전기: 부가세 = `Math.round(공급가액 × 0.1)`
- **수도: 면세 (부가세 0원)**
- 합계 = 공급가액 + 부가세
- 화면 표시: 합계(메인) + 공급가액/세액(소텍스트)

## 자동 청구서 생성 (cron)

- 매일 00:05 KST (= 15:05 UTC) 실행
- 말일: 다음달 임대료+관리비 자동 생성
- 매월 24일: 전기 자동 배분 (`autoDistributeUtility`)
- 홀수달 8일: 수도 자동 배분 (`autoDistributeUtility`)

### 자동 배분 로직 (`autoDistributeUtility`)
1. `building_bills`에서 해당 월 총액 조회 → 미입력(0원)이면 스킵 + 텔레그램 알림
2. 활성 입주사 목록 조회
3. `meter_readings`에서 해당 월 사용량 조회
4. `reading_value`가 NULL인 입주사 → 전월(수도: 2달 전 홀수달) × 1.5 자동 적용 + `meter_readings`에 기록
5. 전월 데이터도 없으면 균등 배분에 포함
6. 사용량 비례 배분 → `monthly_bills` UPSERT
7. 텔레그램 알림 발송

## 검침 주기 & 자동화 워크플로우

### 업로드 기간
- **전기**: 매월 22일 검침 사진 업로드 → **24일 자동 배분**
- **수도**: 홀수달(1,3,5,7,9,11월) 6일 검침 사진 업로드 → **8일 자동 배분**
- 짝수달에는 수도 관련 UI(업로드·건물공과금·배분) 숨김
- 업로드 기간 외: 버튼 disabled + 안내 문구 표시

### 월간 타임라인
```
매월 말일   → 다음달 임대료+관리비 자동 발행

홀수달 6일 → 수도 검침 사진 업로드 기간 (배너 표시)
홀수달 8일   → 수도 자동 배분 (building_bills 미입력→스킵)

매월 22일 → 전기 검침 사진 업로드 기간 (배너 표시)
매월 24일    → 전기 자동 배분 (building_bills 미입력→스킵)
```

### 미제출 처리
- 미제출 입주사: 전월(수도: 2달 전 홀수달) 사용량 × 1.5 자동 적용
- 전월 데이터도 없으면: 균등 배분에 포함
- 자동 적용된 값은 meter_readings에 기록됨

### 관리자 fallback
- 관리자는 기간 제한 없이 언제든 사용량 입력 가능
- 수동 배분 (`POST /monthly-bills/generate`) 엔드포인트 유지

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
| v1.4 | 2026-02-27 | 월별 청구서 일괄 삭제 API 추가 (DELETE /monthly-bills) |
| v1.5 | 2026-02-27 | 입주사 최초 로그인 시 비밀번호 강제 변경 플로우 추가 |
| v1.6 | 2026-03-02 | 공지사항 기능(관리자 등록·입주사 홈 표시), 비밀번호 설정 팝업 닫기·재오픈 버튼 |
| v1.7 | 2026-03-03 | 가스비 전체 제거, 말일 자동청구(KST), 건물주→관리자, 계약정보 박스 제거, 하단 네비 다크 스타일 |
| v1.8 | 2026-03-03 | 문의하기 기능(입주사 제출·관리자 목록·삭제·처리 토글), 텔레그램 알림(문의·검침·청구·미납) |
| v1.9 | 2026-03-05 | 검침 주기 차등화 — 전기 매월/수도 격월(홀수달), 짝수달 수도 UI 숨김, 유의사항 문구 업데이트 |
| v2.0 | 2026-03-05 | 검침 자동화 워크플로우 — 업로드 기간 제한(전기 22일/수도 홀수달 6일), 자동 배분 cron(전기 24일/수도 8일), 미제출 1.5배 자동 적용, 검침일 배너 알림, 관리자 검침 일정 카드, 수도세 면세 처리, 월 선택기, 기본월 전월 설정 |
| v2.1 | 2026-03-05 | 홈택스 XLSX 세금계산서 — CSV→XLSX 변환(59컬럼 홈택스 양식), 공급자/공급받는자 정보 별도 관리(settings+tenants tax_*), 동적 월 품목명, 수도 면세 제외 |
| v2.2 | 2026-03-06 | 기타(other) 청구 항목 추가 — other_amount/other_label/other_paid 컬럼, 인라인 편집 UI, 세금계산서 자동 포함, 검침일 단일화(22일/6일), 전자세금계산서 홈택스 안내 추가 |
| v2.3 | 2026-03-06 | Excel 대조 기능 — 양식 다운로드(XLSX), 업로드→파싱→대조 테이블(일치/차이/신규 하이라이트), 전체 반영(bulk-update API) |
| v2.4 | 2026-03-06 | 협력사 관리 + 설정 서브탭 — partners/partner_payments 테이블, CRUD+지급내역 API 9개, 설정 서브탭(기본 설정/입주사/협력사), 하단 네비 7→6탭, 대시보드 지급 현황 카드 |
| v2.5 | 2026-03-06 | 세금계산서 수동 관리 — tax_invoices 독립 CRUD(초안 생성/추가/수정/삭제/발행 토글), item_name 컬럼 추가, monthly_bills 파생 제거, TaxInvoiceForm 모달 신규 |
| v2.6 | 2026-03-06 | 청구 중심 관리 — v2.5 세금계산서 독립 CRUD 롤백, monthly_bills를 유일한 원본(single source of truth)으로 복원. PUT/DELETE /monthly-bills/:id 추가(금액 수정/삭제), BillingView 인라인 편집+삭제 UI, 납부 버튼 '완료'→'입금완료', TaxInvoiceForm 삭제, 세금계산서 발행 토글 billId+item_type 방식 복원 |
| v2.7 | 2026-03-06 | 협력사 납기일 + 지급 관리 — partners에 payment_day 컬럼 추가, GET /partner-payments/schedule API, 설정 서브탭 4번째(지급 관리) 추가, PaymentManage 컴포넌트(월별 지급 현황+요약+토글+추가/삭제), 대시보드 지급 일정 카드(D-day 컬러) |
| v3.0 | 2026-03-06 | 다중층 입주사 지원 — tenant_floors 테이블 신규, meter_readings.floor 컬럼 추가, 브이모먼트 2+4F 데이터 머지, 층별 공과금 배분→tenant별 합산, 검침 층 탭 UI, 로그인 session.floors 배열, 세금계산서/청구서/Excel 대조 floors 대응 |
| v3.1 | 2026-03-06 | v3.0 핫픽스 + UX 개선 — 검침 면제(meter_exempt) 플래그, 비밀번호 미변경 시 API 차단 제거, 청구 납부 뱃지+버튼 분리 UI, 입주사 청구서/대시보드 세금계산서 발행 태그, 세금계산서 매월 20일 발행 안내, 검침 업로드 iOS 호환성 개선, 납부일 날짜 포맷팅 |
| v3.2 | 2026-03-06 | 5층 수도 서브계량기 — meter_readings.sub_meter 컬럼 추가(hair_cold/hair_hot/laundry_cold/laundry_hot), UNIQUE 인덱스 COALESCE(sub_meter,'') 포함, 배분 로직 sub_meter 합산, 자동배분 서브계량기별 1.5배 처리, MeterUpload 4개 카드 UI, MeterOverview 4개 입력 칸 |
| v3.3 | 2026-03-06 | 청구서 PDF 전문 양식 리디자인 — 숨겨진 A4 템플릿(pdfRef) 방식, 헤더(상호/사업자번호/전화/이메일/주소), 고객 정보(대표자명/문서번호/청구일/납부기한), 입금 계좌, 품목 테이블(공급가액/세액/합계), 비고란, tenant 정보 fetch 추가, 세금계산서 뱃지 '계산서 발행완료'로 통일(MyBillView+TenantDashboard) |
