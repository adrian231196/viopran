# PT Nuri Vira Pratama | Viopran Fire Extinguisher

Website perusahaan + **Portal Finance & Admin** (penawaran, invoice, surat jalan, kwitansi, pengeluaran, laporan laba rugi & pajak) dalam satu `index.html`, siap di-hosting di **GitHub Pages**.

Data keuangan **tidak disimpan di GitHub**. Data tetap berada di file Google Drive yang sama seperti sebelumnya dan diakses lewat Google Apps Script.

```
nvp-website/
├── index.html          ← website + portal (satu file)
├── config.js           ← isi API_URL di sini
├── .nojekyll           ← agar GitHub Pages menyajikan file apa adanya
├── .gitignore          ← mencegah file backup .json ikut ter-commit
├── assets/             ← (opsional) logo.png
└── apps-script/
    ├── Code.gs         ← GANTI isi Code.gs lama dengan file ini
    └── Api.gs          ← file baru di project Apps Script yang sama
```

---

## Cara kerja data

| Dibuka dari | Sumber data |
|---|---|
| **GitHub Pages** + `API_URL` terisi | File Drive yang sama: **`NVP_Finance_Data.json`** (lewat `Api.gs` → `Code.gs`) |
| GitHub Pages **tanpa** `API_URL` | Mode lokal: `localStorage` browser (`nvp_data_fallback`) |
| URL Web App Apps Script dibuka langsung | Hanya halaman pengalih dengan tombol "Buka Portal", tanpa data |

Format data tidak berubah: `{ penawaran, invoices, expenses, suratJalan, kwitansi }`. Semua data lama tetap terbaca.

---

## Langkah 1: Perbarui Google Apps Script

> **Penting (keamanan):** di `Code.gs` lama, `loadDataFromDrive()` dan `saveDataToDrive()` adalah fungsi publik. Siapa pun yang bisa membuka URL Web App dapat memanggilnya dari Console browser (`google.script.run.loadDataFromDrive()`), tanpa login. Password di halaman portal lama hanya dicek di browser. `Code.gs` baru menjadikan kedua fungsi itu *private* (berakhiran `_`), sehingga data hanya bisa diakses lewat `Api.gs` yang memeriksa password di server.

1. Buka project Apps Script portal Anda. **Buat cadangan dulu:** salin isi `Code.gs` lama ke Notepad.
2. **Ganti seluruh isi `Code.gs`** dengan `apps-script/Code.gs`. Isi `SITE_URL` dengan alamat GitHub Pages (bisa diisi belakangan).
3. **File → + → Script**, beri nama `Api`, lalu tempel isi `apps-script/Api.gs`.
4. File HTML `index` lama boleh dihapus atau dibiarkan. File itu tidak dipakai lagi.
5. Pilih fungsi **`cekFileData`** di toolbar, klik **Run**, dan izinkan akses (Authorize). Buka **Execution log** dan pastikan:
   - hanya ada satu file `NVP_Finance_Data.json` yang tidak di Sampah, dan
   - jumlah invoice, kwitansi, dan lainnya sesuai data Anda.
   Jika ada lebih dari satu file, script memakai file yang tidak di Sampah dan paling baru diubah, lalu menguncinya berdasarkan ID. Cek di log apakah itu file yang benar.
6. Di fungsi `setupNvpUsers()` (di `Api.gs`), ganti `GANTI-PASSWORD-ADMIN` dan `GANTI-PASSWORD-STAFF` dengan password baru yang kuat. Pilih `setupNvpUsers`, lalu klik **Run**.
7. Setelah berhasil, kembalikan password di kode menjadi `GANTI-...`. Password sudah tersimpan sebagai hash di *Script Properties*.
8. **Deploy → Manage deployments → ✏️ Edit** pada deployment yang sekarang dipakai:
   - *Version*: **New version**
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - **Deploy**, lalu salin **Web app URL** (berakhiran `/exec`).

   Jika ada deployment lain, **Archive** semuanya. Deployment lama tetap menjalankan kode lama yang fungsinya masih publik.

> Setiap kali file `.gs` diubah, ulangi poin 8 (Edit → New version). URL tetap sama.

## Langkah 2: Isi `config.js`

```js
window.NVP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
  LOGO_URL: ''   // atau 'assets/logo.png' jika logo diunggah ke folder assets
};
```

## Langkah 3: Upload ke GitHub

**Lewat browser (tanpa git):**
1. Buat repository baru di github.com, misalnya `nvp-website`.
2. **Add file → Upload files**, lalu seret *isi* folder ini (termasuk `.nojekyll`). Klik **Commit changes**.

**Lewat terminal:**
```bash
cd nvp-website
git init
git add .
git commit -m "Website PT Nuri Vira Pratama + portal finance"
git branch -M main
git remote add origin https://github.com/USERNAME/nvp-website.git
git push -u origin main
```

## Langkah 4: Aktifkan GitHub Pages

**Settings → Pages → Build and deployment**
- Source: **Deploy from a branch**
- Branch: **main** / **(root)** → **Save**

Setelah 1–2 menit, website aktif di `https://USERNAME.github.io/nvp-website/`.
- Portal langsung: `https://USERNAME.github.io/nvp-website/#portal`
- Domain sendiri (opsional): isi *Custom domain* di halaman yang sama, lalu arahkan DNS (CNAME) ke `USERNAME.github.io`.

## Langkah 5: Uji

1. Buka `…/#portal` lalu login dengan password baru dari Langkah 1.
2. Data lama dari Google Drive harus langsung muncul di dasbor dan tabel.
3. Buat satu data uji, tunggu label **Menyimpan...** hilang, lalu muat ulang halaman. Data harus tetap ada.

---

## Memindahkan data lama

**A. Data sudah di Google Drive** (file `NVP_Finance_Data.json`, portal lama dibuka dari Apps Script): tidak perlu dipindahkan. Setelah Langkah 1–2, data langsung muncul.

**B. Data hanya ada di browser** (portal lama pernah dibuka sebagai file lokal atau dari hosting lain, jadi tersimpan di `localStorage`):
1. Di browser dan komputer yang menyimpan data itu, buka halaman portal lama.
2. Tekan `F12` → tab **Console**, tempel perintah ini, lalu tekan Enter:
   ```js
   (() => { const d = localStorage.getItem('nvp_data_fallback'); if (!d) return alert('Tidak ada data di browser ini');
     const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([d], {type:'application/json'}));
     a.download = 'nvp-data-lama.json'; a.click(); })();
   ```
3. Buka portal baru di GitHub Pages, login, klik **Pulihkan** (ikon upload di header), lalu pilih `nvp-data-lama.json`.
4. Cek jumlah data di layar konfirmasi, lalu klik **Ganti Data**. Data saat ini diunduh otomatis dulu sebagai cadangan.

---

## Backup

- **Otomatis (server):** sebelum menyimpan, `Api.gs` menyalin data lama 1x per hari ke folder Google Drive **NVP Backup**.
- **Manual:** tombol **Backup** di header portal mengunduh semua data sebagai file `.json`.
- **Pulihkan:** tombol **Pulihkan** mengganti semua data dengan isi file backup.

> ⚠️ Jangan commit file backup `.json` ke GitHub. `.gitignore` sudah memblokirnya.

---

## Keamanan: wajib dibaca

- Repository GitHub Pages gratis bersifat **publik**, jadi semua isi `index.html` dan `config.js` bisa dilihat orang.
  - Tidak ada password di kode GitHub. Login diperiksa di Apps Script, dan password tersimpan sebagai hash.
  - `API_URL` terlihat publik, tetapi tidak bisa membaca atau mengubah data tanpa username dan password yang benar.
  - Akun demo `admin/admin123` dan `staff/staff123` hanya berlaku di mode lokal. Dengan `API_URL` terisi, akun demo tidak berfungsi dan kotak demo disembunyikan.
- Template invoice berisi **nomor rekening BCA & DKI** (dicetak di invoice). Karena repo publik, nomor ini ikut terlihat di kode. Jika tidak diinginkan, pakai repo **private** (GitHub Pages untuk repo private memerlukan paket GitHub berbayar) atau pindahkan data rekening ke `Api.gs`.
- Pakai password yang kuat dan berbeda untuk admin dan staff. Untuk mengganti password, ulangi Langkah 1 poin 6–7 (tidak perlu deploy ulang).
- Jika admin dan staff mengedit di waktu yang sama, penyimpanan terakhir yang berlaku. Hindari mengedit bersamaan.

---

## Catatan teknis

- React 18, Tailwind (CDN), dan Babel Standalone dimuat dari CDN, sama seperti versi sebelumnya, jadi tidak perlu proses build.
- Permintaan ke Apps Script dikirim sebagai `POST` `text/plain` agar tidak memicu *CORS preflight*.
- Uji lokal: `python3 -m http.server 8000` di folder ini, lalu buka `http://localhost:8000/#portal`.
