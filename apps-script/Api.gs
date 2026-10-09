/**
 * =====================================================================
 *  API untuk website PT Nuri Vira Pratama yang di-hosting di GitHub Pages
 * =====================================================================
 *  Dipakai bersama Code.gs (versi baru) di project Apps Script yang sama.
 *
 *  - File data di Google Drive tetap sama (NVP_Finance_Data.json).
 *  - File ini hanya berisi doPost; doGet ada di Code.gs.
 *  - Login dicek di server; password disimpan sebagai hash di Script Properties,
 *    TIDAK ada di kode GitHub.
 *  - Sebelum menyimpan, data lama dicadangkan 1x per hari ke folder Drive
 *    "NVP Backup".
 *  - Hak akses: role 'admin' melihat semua data. Role 'staff' TIDAK menerima
 *    data saldo awal, aset tetap, dan transaksi kas (laporan keuangan), dan
 *    tidak bisa mengubahnya — server mempertahankan nilai yang tersimpan.
 *    Akun lama tanpa role: username 'admin' = admin, lainnya = staff.
 *
 *  Langkah:
 *   1. Ubah password di setupNvpUsers() lalu jalankan fungsi itu SEKALI (Run).
 *   2. Hapus lagi password dari kode setelah berhasil (opsional, disarankan).
 *   3. Deploy > New deployment > Web app
 *        Execute as     : Me
 *        Who has access : Anyone
 *      Salin URL yang berakhiran /exec ke config.js (API_URL).
 *   4. Setiap mengubah file ini: Deploy > Manage deployments > Edit > Version: New version.
 */

var NVP_TIMEZONE = 'Asia/Jakarta';
var NVP_BACKUP_FOLDER = 'NVP Backup';
var NVP_ADMIN_ONLY_KEYS = ['ledger', 'assets', 'cashTx'];

/** Jalankan SEKALI untuk mengatur akun portal. Ganti password sebelum Run. */
function setupNvpUsers() {
  var users = [
    { username: 'admin', password: 'GANTI-PASSWORD-ADMIN', name: 'Administrator', initial: 'A', role: 'admin' },
    { username: 'staff', password: 'GANTI-PASSWORD-STAFF', name: 'Staff Finance', initial: 'S', role: 'staff' }
  ];
  var stored = users.map(function (u) {
    if (!u.password || u.password.indexOf('GANTI-') === 0) {
      throw new Error('Ganti password untuk "' + u.username + '" terlebih dahulu.');
    }
    return { username: u.username, hash: nvpHash_(u.password), name: u.name, initial: u.initial, role: u.role === 'admin' ? 'admin' : 'staff' };
  });
  PropertiesService.getScriptProperties().setProperty('NVP_USERS', JSON.stringify(stored));
  Logger.log('Akun portal tersimpan: ' + stored.map(function (u) { return u.username; }).join(', '));
}

/** Endpoint API. Body (text/plain JSON): { action: 'load'|'save', username, password, data? } */
function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var user = nvpAuth_(body.username, body.password);
    if (!user) return nvpJson_({ ok: false, error: 'AUTH' });

    if (body.action === 'load') {
      // loadDataFromDrive_() mengembalikan string JSON (atau null jika belum ada data)
      var raw = loadDataFromDrive_() || null;
      out = { ok: true, user: user, data: user.role === 'admin' ? raw : nvpStripAdminOnly_(raw) };

    } else if (body.action === 'save') {
      if (!body.data || typeof body.data !== 'object') {
        return nvpJson_({ ok: false, error: 'DATA_TIDAK_VALID' });
      }
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        var data = body.data;
        if (user.role !== 'admin') data = nvpKeepAdminOnly_(data, loadDataFromDrive_());
        nvpDailyBackup_();
        saveDataToDrive_(JSON.stringify(data));
      } finally {
        lock.releaseLock();
      }
      out = { ok: true, savedAt: new Date().toISOString() };

    } else {
      out = { ok: false, error: 'ACTION_TIDAK_DIKENAL' };
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return nvpJson_(out);
}

// ---------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------
function nvpAuth_(username, password) {
  if (!username || !password) return null;
  var raw = PropertiesService.getScriptProperties().getProperty('NVP_USERS');
  if (!raw) throw new Error('Akun belum diatur. Jalankan setupNvpUsers() di Apps Script.');
  var users = JSON.parse(raw);
  var hash = nvpHash_(password);
  for (var i = 0; i < users.length; i++) {
    if (users[i].username === String(username) && users[i].hash === hash) {
      var role = users[i].role || (users[i].username === 'admin' ? 'admin' : 'staff');
      return { username: users[i].username, name: users[i].name, initial: users[i].initial, role: role };
    }
  }
  Utilities.sleep(1000); // perlambat percobaan tebak password
  return null;
}

/** Staff: buang data khusus admin dari data yang dikirim ke browser. */
function nvpStripAdminOnly_(raw) {
  if (!raw) return raw;
  var d;
  try { d = JSON.parse(raw); } catch (e) { return raw; }
  NVP_ADMIN_ONLY_KEYS.forEach(function (k) { delete d[k]; });
  return JSON.stringify(d);
}

/** Staff menyimpan: pertahankan data khusus admin yang sudah ada di Drive. */
function nvpKeepAdminOnly_(incoming, currentRaw) {
  var cur = {};
  try { cur = currentRaw ? JSON.parse(currentRaw) : {}; } catch (e) { throw new Error('Data di Drive tidak dapat dibaca; penyimpanan dibatalkan.'); }
  var out = {};
  Object.keys(incoming).forEach(function (k) { out[k] = incoming[k]; });
  NVP_ADMIN_ONLY_KEYS.forEach(function (k) {
    if (cur[k] !== undefined) out[k] = cur[k]; else delete out[k];
  });
  return out;
}

function nvpHash_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'nvp:' + text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function nvpDailyBackup_() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), NVP_TIMEZONE, 'yyyy-MM-dd');
  if (props.getProperty('NVP_LAST_BACKUP') === today) return;
  var current = loadDataFromDrive_();
  if (!current) return;
  var folders = DriveApp.getFoldersByName(NVP_BACKUP_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(NVP_BACKUP_FOLDER);
  folder.createFile('nvp-backup-' + today + '.json', current, MimeType.PLAIN_TEXT);
  props.setProperty('NVP_LAST_BACKUP', today);
}

function nvpJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
