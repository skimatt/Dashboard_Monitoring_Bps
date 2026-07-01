# Dashboard Monitoring BPS Bireuen

Dashboard monitoring operasional berbasis Google Apps Script untuk membaca data Google Sheets, menampilkan ringkasan kecamatan, PPL/Petugas, PML/Pengawas, SLS, risk monitor, dan asisten AI berbasis OpenRouter melalui Cloudflare Worker.

## Fitur Utama

- Executive overview progres harian.
- Analisis kecamatan: prelist, submit, approve, target harian, dan status capaian.
- Analisis PPL/Petugas dari detail SLS.
- Analisis PML/Pengawas.
- Detail SLS dari export SERASI.
- Risk monitor berdasarkan realisasi, open, draft, dan risk score.
- Global search dan export tabel.
- Sidebar responsive dengan mode collapse.
- AI assistant dalam bentuk chat drawer kanan.
- Hardening production:
  - Error API tidak mengekspos stack trace.
  - Header sheet wajib divalidasi fail-fast.
  - Output string dari Google Sheets disanitasi.
  - CDN dipin versi dan diberi fallback.
  - OpenRouter API key tidak disimpan di frontend.

## Struktur File

```text
.
├── kode.gs                # Backend Google Apps Script
├── index.html             # Layout utama dashboard
├── css.html               # Style dashboard
├── js.html                # Logic frontend dashboard
├── ai.html                # UI dan logic chat AI
├── cloudflare-worker.js   # Proxy OpenRouter untuk Cloudflare Worker
├── appsscript.json        # Manifest Apps Script
└── README.md
```

## Arsitektur

```text
Google Sheets
     ↓
kode.gs
     ↓
index.html + js.html + css.html + ai.html
     ↓
Cloudflare Worker
     ↓
OpenRouter
```

Dashboard membaca data dari Google Sheets melalui Apps Script. AI assistant mengirim konteks dashboard ke Cloudflare Worker. Worker meneruskan request ke OpenRouter menggunakan secret `OPENROUTER_API_KEY`.

API key tidak pernah ditaruh di HTML/browser.

## Setup Apps Script

1. Buat project Google Apps Script.
2. Upload/salin file berikut:
   - `kode.gs`
   - `index.html`
   - `css.html`
   - `js.html`
   - `ai.html`
   - `appsscript.json`
3. Aktifkan manifest di Apps Script:
   - Project Settings
   - Enable `Show "appsscript.json" manifest file in editor`
4. Pastikan manifest berisi scope:

```json
{
  "timeZone": "Asia/Jakarta",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email"
  ]
}
```

5. Sesuaikan `SPREADSHEET_ID` dan nama sheet di `kode.gs` jika diperlukan.
6. Jalankan fungsi test dari editor Apps Script:

```text
getSuperDashboardData
testOpenRouterConnection
```

7. Berikan authorization saat diminta.
8. Deploy sebagai Web App.

## Setup Cloudflare Worker

1. Buat Cloudflare Worker.
2. Salin isi `cloudflare-worker.js`.
3. Set Worker secret:

```text
OPENROUTER_API_KEY = sk-or-v1-xxxxxxxx
```

4. Deploy Worker.
5. Test health endpoint:

```text
https://bps.rahmatyoung10.workers.dev/health
```

Response sukses akan berisi:

```json
{
  "success": true,
  "openrouterKeyConfigured": true
}
```

## Konfigurasi AI

Default worker menggunakan model:

```text
openrouter/auto
```

AI assistant membaca konteks dashboard yang sudah tersedia di browser, termasuk:

- Ringkasan eksekutif.
- Ranking kecamatan.
- Petugas realisasi tertinggi.
- Petugas berhasil terbanyak.
- Petugas realisasi terendah.
- Petugas/SLS open tinggi.
- Petugas/SLS draft tinggi.
- Risk score tertinggi.

Untuk pertanyaan ranking, AI diarahkan menampilkan 5 teratas kecuali diminta lebih.

## Endpoint Apps Script

Web App mendukung endpoint query:

```text
?api=overview
?api=kecamatan
?api=petugas
?api=pml
?api=sls
?api=all
?api=health
```

Frontend dashboard menggunakan `getSuperDashboardData()` sebagai single source of truth.

## Format Sheet

Sheet yang digunakan:

- `Progres`
- `Petugas`

Header wajib pada sheet `Petugas`:

- `No`
- `Identitas PPL`
- `Identitas PML`
- `Kode SLS`
- `Total Target FASIH`
- `Total Berhasil DiData`
- `Persentase Realisasi Total`
- `OPEN`
- `DRAFT`
- `DATETIME`

Jika header wajib tidak ditemukan, proses dihentikan dan error yang jelas ditampilkan.

## Catatan Keamanan

- Jangan taruh OpenRouter API key di file HTML.
- API key hanya disimpan sebagai Cloudflare Worker secret.
- Stack trace tidak dikirim ke response API.
- Detail error teknis dicatat di `Logger` / `console`.
- String dari Google Sheets disanitasi sebelum dirender.

## Troubleshooting

### Data gagal dimuat

Cek Apps Script Executions/Logs. Umumnya disebabkan oleh:

- `SPREADSHEET_ID` salah.
- Sheet `Progres` atau `Petugas` tidak ditemukan.
- Header wajib sheet `Petugas` tidak lengkap.
- Scope Apps Script belum diotorisasi.

### Permission Spreadsheet tidak cukup

Pastikan manifest memakai:

```text
https://www.googleapis.com/auth/spreadsheets
```

Bukan hanya `spreadsheets.readonly`.

### AI tidak menjawab

Cek:

- Worker sudah deploy.
- Secret `OPENROUTER_API_KEY` sudah diset.
- Endpoint `/health` sukses.
- Akun OpenRouter memiliki akses/credit.
- Browser dapat mengakses Worker.

### Jawaban AI terpotong

Worker dan frontend menggunakan `max_tokens: 2200`. Jika masih terpotong, minta AI untuk `lanjutkan` atau persempit pertanyaan.

## Kredit

Dikembangkan oleh Rahmat Mulia untuk mendukung monitoring internal BPS Bireuen.
