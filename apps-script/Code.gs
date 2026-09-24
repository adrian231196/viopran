/**
 * =====================================================================
 *  PT NURI VIRA PRATAMA — Server Google Apps Script
 *  (pengganti Code.gs lama; file data di Drive TETAP SAMA)
 * =====================================================================
 *  Perubahan dari versi lama:
 *  1. Fungsi baca/tulis data diberi akhiran "_" (private) sehingga TIDAK bisa
 *     dipanggil langsung dari browser lewat google.script.run. Akses data
 *     hanya lewat doPost di Api.gs yang memeriksa username & password.
 *  2. File data dikunci berdasarkan ID (bukan hanya nama) dan file di
 *     Sampah (trash) diabaikan — mencegah salah baca bila ada file bernama sama.
 *  3. doGet() kini mengarahkan pengunjung ke website di GitHub Pages.
 */

const FILE_NAME = 'NVP_Finance_Data.json';

// Isi dengan alamat GitHub Pages Anda, mis. 'https://username.github.io/nvp-website/'
const SITE_URL = '';

/** Dipanggil saat URL Web App dibuka di browser. */
function doGet(e) {
  const portal = SITE_URL ? SITE_URL.replace(/\/?$/, '/') + '#portal' : '';
  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<style>body{font-family:Arial,sans-serif;background:#0b0f14;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center;padding:16px}' +
    'a{display:inline-block;margin-top:18px;background:#dc2626;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold}</style></head><body><div>' +
    '<h2 style="margin:0">PT NURI VIRA PRATAMA</h2>' +
    '<p style="color:#94a3b8">Server data Finance &amp; Admin aktif.</p>' +
    (portal ? '<a href="' + portal + '" target="_top">Buka Portal Finance &amp; Admin</a>' : '<p style="color:#f87171">SITE_URL belum diisi di Code.gs.</p>') +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('PT Nuri Vira Pratama | Viopran Fire Extinguisher')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Mencari file data. Mengutamakan ID yang sudah tersimpan, abaikan file di Sampah. */
function getDataFile_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty('NVP_FILE_ID');
  if (savedId) {
    try {
      const f = DriveApp.getFileById(savedId);
      if (!f.isTrashed()) return f;
    } catch (err) { /* file terhapus / tidak bisa diakses → cari ulang */ }
  }
  const files = DriveApp.getFilesByName(FILE_NAME);
  let best = null;
  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed()) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  if (best) props.setProperty('NVP_FILE_ID', best.getId());
  return best;
}

/** Membaca data (string JSON) dari Google Drive. */
function loadDataFromDrive_() {
  try {
    const file = getDataFile_();
    return file ? file.getBlob().getDataAsString() : null;
  } catch (e) {
    throw new Error('Gagal membaca dari Drive: ' + e.message);
  }
}

/** Menyimpan seluruh data (string JSON) ke Google Drive. */
function saveDataToDrive_(dataString) {
  try {
    const file = getDataFile_();
    if (file) {
      file.setContent(dataString);
    } else {
      const created = DriveApp.createFile(FILE_NAME, dataString, MimeType.PLAIN_TEXT);
      PropertiesService.getScriptProperties().setProperty('NVP_FILE_ID', created.getId());
    }
    return true;
  } catch (e) {
    throw new Error('Gagal menyimpan ke Drive: ' + e.message);
  }
}

/**
 * Jalankan SEKALI sebelum migrasi (Run → lihat Execution log).
 * Menampilkan semua file bernama NVP_Finance_Data.json dan file mana yang dipakai.
 */
function cekFileData() {
  const files = DriveApp.getFilesByName(FILE_NAME);
  let n = 0;
  while (files.hasNext()) {
    const f = files.next(); n++;
    Logger.log('%s | id=%s | %s byte | diubah=%s | di Sampah=%s',
      f.getName(), f.getId(), f.getSize(), f.getLastUpdated(), f.isTrashed());
  }
  const used = getDataFile_();
  Logger.log('Jumlah file: %s. Yang DIPAKAI: %s', n, used ? used.getId() + ' (' + used.getLastUpdated() + ')' : 'belum ada');
  if (used) {
    try {
      const d = JSON.parse(used.getBlob().getDataAsString());
      ['penawaran', 'invoices', 'expenses', 'suratJalan', 'kwitansi'].forEach(function (k) {
        Logger.log('  %s: %s data', k, Array.isArray(d[k]) ? d[k].length : 0);
      });
    } catch (err) { Logger.log('  Isi file bukan JSON valid: ' + err.message); }
  }
}
