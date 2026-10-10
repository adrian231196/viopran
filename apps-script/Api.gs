/**
 * =====================================================================
 *  API untuk website PT Nuri Vira Pratama yang di-hosting di GitHub Pages
 * =====================================================================
 *  Dipakai bersama Code.gs di project Apps Script yang sama ("Portal PT Nuri").
 *
 *  - File data di Google Drive tetap sama (NVP_Finance_Data.json).
 *  - File ini hanya berisi doPost; doGet ada di Code.gs.
 *  - Login dicek di server; password disimpan sebagai hash di Script Properties,
 *    TIDAK ada di kode GitHub.
 *  - Sebelum menyimpan, data lama dicadangkan 1x per hari ke folder Drive
 *    "NVP Backup".
 *
 *  AKUN & HAK AKSES
 *  - Admin mengelola akun dari portal: menu "Pengguna" (tambah akun, atur menu
 *    yang boleh dibuka, reset password, hapus akun).
 *  - Role 'admin' : semua menu + kelola pengguna + backup/pulihkan.
 *  - Role 'staff' : hanya menu yang dicentang admin. Server hanya mengirim data
 *    yang dibutuhkan menu tersebut, dan hanya menerima perubahan pada data yang
 *    boleh diubah — data lain dipertahankan apa adanya.
 *
 *  APLIKASI NVP OPERASIONAL (viopran.com/app)
 *  - Akun peran Teknisi / Manager Operasional / Direktur dibuat di menu Pengguna
 *    yang sama, khusus untuk aplikasi (tidak bisa masuk portal keuangan).
 *  - Semua action "ops..." ditangani OpsApi.gs.
 *
 *  LUPA PASSWORD ADMIN?
 *   Isi password di setupNvpUsers() lalu Run sekali. Akun lain (dan menu yang
 *   sudah diatur) tidak berubah. Setelah itu kembalikan teks GANTI-PASSWORD-...
 *
 *  Setiap mengubah file ini: Terapkan > Kelola deployment > (pilih deployment
 *  yang URL-nya ada di config.js) > Edit > Versi: Versi baru > Terapkan.
 */

var NVP_TIMEZONE = 'Asia/Jakarta';
var NVP_ROLES = ['admin', 'staff', 'teknisi', 'manager', 'direktur'];
var NVP_ROLES_APLIKASI = ['teknisi', 'manager', 'direktur'];
var NVP_BACKUP_FOLDER = 'NVP Backup';

// ---- Daftar menu & data yang dipakai tiap menu (harus sama dengan index.html)
var NVP_MENUS = ['kalender', 'penawaran', 'invoice', 'suratjalan', 'kwitansi', 'pengeluaran', 'labarugi', 'neraca', 'pajak', 'datakeu'];
var NVP_STAFF_DEFAULT = ['kalender', 'penawaran', 'invoice', 'suratjalan', 'kwitansi', 'pengeluaran'];
var NVP_DATA_KEYS = ['penawaran', 'invoices', 'expenses', 'suratJalan', 'kwitansi', 'assets', 'cashTx', 'ledger'];
var NVP_LAPORAN_READ = ['invoices', 'expenses', 'assets', 'cashTx', 'ledger'];
var NVP_MENU_DATA = {
  kalender:    { read: ['invoices'],                           write: [] },
  penawaran:   { read: ['penawaran'],                          write: ['penawaran'] },
  invoice:     { read: ['invoices', 'suratJalan', 'kwitansi'], write: ['invoices', 'suratJalan', 'kwitansi'] }, // SJ & kwitansi otomatis
  suratjalan:  { read: ['suratJalan'],                         write: ['suratJalan'] },
  kwitansi:    { read: ['kwitansi'],                           write: ['kwitansi'] },
  pengeluaran: { read: ['expenses'],                           write: ['expenses'] },
  labarugi:    { read: NVP_LAPORAN_READ,                       write: [] },
  neraca:      { read: NVP_LAPORAN_READ,                       write: [] },
  pajak:       { read: NVP_LAPORAN_READ,                       write: [] },
  datakeu:     { read: NVP_LAPORAN_READ,                       write: ['ledger', 'assets', 'cashTx', 'invoices'] }
};

/**
 * Darurat / pertama kali: isi password lalu Run SEKALI.
 * Hanya akun yang password-nya diisi yang diperbarui; akun lain tetap.
 */
function setupNvpUsers() {
  var users = [
    { username: 'admin', password: 'GANTI-PASSWORD-ADMIN', name: 'Administrator', role: 'admin' },
    { username: 'staff', password: 'GANTI-PASSWORD-STAFF', name: 'Staff Finance', role: 'staff' }
  ];
  var list = nvpLoadUsers_(true);
  var changed = [];
  users.forEach(function (u) {
    if (!u.password || u.password.indexOf('GANTI-') === 0) return; // dilewati
    nvpCheckPassword_(u.password);
    var i = nvpFindUser_(list, u.username);
    var rec = i >= 0 ? list[i] : { username: u.username, menus: u.role === 'admin' ? [] : NVP_STAFF_DEFAULT.slice() };
    rec.hash = nvpHash_(u.password);
    rec.name = rec.name || u.name;
    rec.initial = String(rec.name || u.username).charAt(0).toUpperCase();
    rec.role = u.role === 'admin' ? 'admin' : (rec.role || 'staff');
    if (i >= 0) list[i] = rec; else list.push(rec);
    changed.push(u.username);
  });
  if (!changed.length) throw new Error('Ganti minimal satu password GANTI-PASSWORD-... terlebih dahulu.');
  nvpSaveUsers_(list);
  Logger.log('Akun portal tersimpan: ' + changed.join(', '));
}

/** Endpoint API. Body (text/plain JSON): { action, username, password, ... } */
function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (String(body.action || '').indexOf('ops') === 0) return nvpJson_(opsHandle_(body));
    var user = nvpAuth_(body.username, body.password);
    if (!user) return nvpJson_({ ok: false, error: 'AUTH' });
    if (NVP_ROLES_APLIKASI.indexOf(user.role) >= 0) return nvpJson_({ ok: false, error: 'AKUN_APLIKASI' });
    var access = nvpAccess_(user);

    if (body.action === 'load') {
      var raw = loadDataFromDrive_() || null;
      out = { ok: true, user: user, data: user.role === 'admin' ? raw : nvpFilterRead_(raw, access.read) };

    } else if (body.action === 'save') {
      if (!body.data || typeof body.data !== 'object') return nvpJson_({ ok: false, error: 'DATA_TIDAK_VALID' });
      nvpWithLock_(function () {
        var data = body.data;
        var current = loadDataFromDrive_();
        if (user.role !== 'admin') data = nvpMergeWrite_(data, current, access.write);
        data = opsJagaPengeluaran_(data, current); // pengeluaran dari aplikasi tidak ikut terhapus/terubah
        nvpDailyBackup_();
        saveDataToDrive_(JSON.stringify(data));
      });
      out = { ok: true, savedAt: new Date().toISOString() };

    } else if (body.action === 'changePassword') {
      nvpCheckPassword_(body.newPassword);
      nvpWithLock_(function () {
        var list = nvpLoadUsers_();
        var i = nvpFindUser_(list, user.username);
        list[i].hash = nvpHash_(body.newPassword);
        nvpSaveUsers_(list);
      });
      out = { ok: true };

    } else if (body.action === 'listUsers' || body.action === 'saveUser' || body.action === 'deleteUser') {
      if (user.role !== 'admin') return nvpJson_({ ok: false, error: 'TIDAK_DIIZINKAN' });
      if (body.action === 'saveUser') nvpWithLock_(function () { nvpSaveUserAction_(body.user, !!body.isNew, user.username); });
      if (body.action === 'deleteUser') nvpWithLock_(function () { nvpDeleteUserAction_(body.target, user.username); });
      out = { ok: true, users: nvpLoadUsers_().map(nvpPublicUser_) };

    } else {
      out = { ok: false, error: 'ACTION_TIDAK_DIKENAL' };
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return nvpJson_(out);
}

// ---------------------------------------------------------------------
// Pengguna
// ---------------------------------------------------------------------
function nvpLoadUsers_(allowEmpty) {
  var raw = PropertiesService.getScriptProperties().getProperty('NVP_USERS');
  if (!raw) {
    if (allowEmpty) return [];
    throw new Error('Akun belum diatur. Jalankan setupNvpUsers() di Apps Script.');
  }
  return JSON.parse(raw);
}
function nvpSaveUsers_(list) {
  PropertiesService.getScriptProperties().setProperty('NVP_USERS', JSON.stringify(list));
}
function nvpFindUser_(list, username) {
  for (var i = 0; i < list.length; i++) if (list[i].username === String(username)) return i;
  return -1;
}
function nvpRole_(u) { return u.role || (u.username === 'admin' ? 'admin' : 'staff'); }
function nvpMenus_(u) {
  if (nvpRole_(u) === 'admin') return NVP_MENUS.slice();
  if (nvpRole_(u) !== 'staff') return [];
  var m = Array.isArray(u.menus) ? u.menus : NVP_STAFF_DEFAULT;
  return NVP_MENUS.filter(function (k) { return m.indexOf(k) >= 0; });
}
function nvpPublicUser_(u) {
  return { username: u.username, name: u.name, initial: u.initial, role: nvpRole_(u), menus: nvpMenus_(u) };
}
function nvpCheckPassword_(p) {
  if (typeof p !== 'string' || p.length < 8) throw new Error('Password minimal 8 karakter.');
}

function nvpSaveUserAction_(u, isNew, actor) {
  if (!u || typeof u !== 'object') throw new Error('Data akun tidak valid.');
  var username = String(u.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('Username 3–30 karakter: huruf kecil, angka, titik, - atau _.');
  var name = String(u.name || '').trim().slice(0, 60);
  if (!name) throw new Error('Nama wajib diisi.');
  var role = NVP_ROLES.indexOf(u.role) >= 0 ? u.role : 'staff';
  var menus = NVP_MENUS.filter(function (k) { return Array.isArray(u.menus) && u.menus.indexOf(k) >= 0; });

  var list = nvpLoadUsers_();
  var i = nvpFindUser_(list, username);
  if (isNew && i >= 0) throw new Error('Username "' + username + '" sudah dipakai.');
  if (!isNew && i < 0) throw new Error('Akun tidak ditemukan.');
  if (isNew || u.password) nvpCheckPassword_(u.password);
  if (!isNew && username === actor && role !== 'admin') throw new Error('Anda tidak bisa menurunkan peran akun Anda sendiri.');

  var rec = i >= 0 ? list[i] : { username: username };
  rec.name = name;
  rec.initial = name.charAt(0).toUpperCase();
  rec.role = role;
  rec.menus = role === 'staff' ? menus : [];
  if (u.password) rec.hash = nvpHash_(u.password);
  if (i >= 0) list[i] = rec; else list.push(rec);
  if (!list.some(function (x) { return nvpRole_(x) === 'admin'; })) throw new Error('Minimal harus ada satu admin.');
  nvpSaveUsers_(list);
}

function nvpDeleteUserAction_(target, actor) {
  var list = nvpLoadUsers_();
  var i = nvpFindUser_(list, target);
  if (i < 0) throw new Error('Akun tidak ditemukan.');
  if (list[i].username === actor) throw new Error('Anda tidak bisa menghapus akun Anda sendiri.');
  list.splice(i, 1);
  if (!list.some(function (x) { return nvpRole_(x) === 'admin'; })) throw new Error('Minimal harus ada satu admin.');
  nvpSaveUsers_(list);
}

function nvpAuth_(username, password) {
  if (!username || !password) return null;
  var users = nvpLoadUsers_();
  var hash = nvpHash_(password);
  for (var i = 0; i < users.length; i++) {
    if (users[i].username === String(username) && users[i].hash === hash) return nvpPublicUser_(users[i]);
  }
  Utilities.sleep(1000); // perlambat percobaan tebak password
  return null;
}

// ---------------------------------------------------------------------
// Hak akses data
// ---------------------------------------------------------------------
function nvpAccess_(user) {
  if (user.role === 'admin') return { read: NVP_DATA_KEYS.slice(), write: NVP_DATA_KEYS.slice() };
  var read = {}, write = {};
  user.menus.forEach(function (m) {
    var d = NVP_MENU_DATA[m]; if (!d) return;
    d.read.forEach(function (k) { read[k] = true; });
    d.write.forEach(function (k) { write[k] = true; read[k] = true; });
  });
  return { read: Object.keys(read), write: Object.keys(write) };
}

/** Kirim ke browser hanya data yang boleh dibaca. */
function nvpFilterRead_(raw, readKeys) {
  if (!raw) return raw;
  var d;
  try { d = JSON.parse(raw); } catch (e) { return raw; }
  NVP_DATA_KEYS.forEach(function (k) { if (readKeys.indexOf(k) < 0) delete d[k]; });
  return JSON.stringify(d);
}

/** Terima perubahan hanya pada data yang boleh diubah; sisanya tetap dari Drive. */
function nvpMergeWrite_(incoming, currentRaw, writeKeys) {
  var cur = {};
  try { cur = currentRaw ? JSON.parse(currentRaw) : {}; } catch (e) { throw new Error('Data di Drive tidak dapat dibaca; penyimpanan dibatalkan.'); }
  var out = {};
  Object.keys(cur).forEach(function (k) { out[k] = cur[k]; });
  writeKeys.forEach(function (k) { if (incoming[k] !== undefined) out[k] = incoming[k]; });
  return out;
}

// ---------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------
function nvpWithLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
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
