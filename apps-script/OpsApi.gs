/**
 * =====================================================================
 *  NVP OPERASIONAL — API aplikasi (Teknisi, Manager Operasional, Direktur)
 * =====================================================================
 *  File ini ditambahkan ke project Apps Script "Portal PT Nuri" (bersama
 *  Code.gs dan Api.gs). Dipanggil dari doPost di Api.gs untuk action "ops...".
 *
 *  - Data aplikasi disimpan di Drive: folder "NVP Operasional" →
 *    NVP_Operasional_Data.json. Foto & laporan PDF tersimpan per klien:
 *    NVP Operasional / <nama klien> / Foto | Laporan.
 *  - Akun dibuat admin di portal (menu Pengguna) dengan peran Teknisi,
 *    Manager Operasional, atau Direktur.
 *  - Pembayaran oleh Direktur otomatis dicatat ke Kas Keluar aplikasi DAN ke
 *    Pengeluaran di portal keuangan.
 *  - Notifikasi HP memakai Web Push (standar browser) dengan kunci VAPID yang
 *    dibuat otomatis — muncul walau HP terkunci/layar mati. Tanpa Firebase.
 *
 *  SEKALI SAJA setelah menempel file ini: pilih fungsi izinkanOps lalu Jalankan,
 *  setujui izin (Drive + koneksi internet untuk mengirim notifikasi).
 */

var OPS_FILE_NAME = 'NVP_Operasional_Data.json';
var OPS_FOLDER = 'NVP Operasional';
var OPS_ROLES = ['teknisi', 'manager', 'direktur'];
var OPS_SESSION_DAYS = 60;
var OPS_VAPID_SUBJECT = 'mailto:admin@viopran.com';
var OPS_COLS = ['tugas', 'pekerjaan', 'aju', 'kasKeluar'];

/** Jalankan SEKALI dari editor untuk memberi izin (Drive & UrlFetch) dan membuat kunci notifikasi. */
function izinkanOps() {
  var folder = opsFolder_();
  opsVapid_();
  try { UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true }); } catch (e) {}
  Logger.log('NVP Operasional siap. Folder: ' + folder.getName() + ' · kunci notifikasi aktif.');
}

// ---------------------------------------------------------------------
// Pintu masuk dari doPost (Api.gs)
// ---------------------------------------------------------------------
function opsHandle_(body) {
  var a = body.action;
  if (a === 'opsPushKey') return { ok: true, key: opsVapid_().pub };
  if (a === 'opsInbox') return nvpWithLock_(function () { return opsInbox_(body); });
  if (a === 'opsSubscribe' && body.pushToken && !body.token) return nvpWithLock_(function () { return opsPerbaruiLangganan_(body); });

  if (a === 'opsLogin') {
    var u = nvpAuth_(body.username, body.password);
    if (!u) return { ok: false, error: 'AUTH' };
    if (OPS_ROLES.indexOf(u.role) < 0) return { ok: false, error: 'BUKAN_AKUN_APLIKASI' };
    return nvpWithLock_(function () {
      var D = opsLoad_();
      var token = opsRandomHex_(32);
      D.sessions = opsPruneSessions_(D.sessions);
      D.sessions[opsHashHex_(token)] = { u: u.username, exp: Date.now() + OPS_SESSION_DAYS * 864e5, h: opsUserStamp_(u.username) };
      opsSave_(D);
      return { ok: true, token: token, user: u, data: opsView_(D, u), pushKey: opsVapid_().pub };
    });
  }

  return nvpWithLock_(function () {
    var D = opsLoad_();
    var user = opsSessionUser_(D, body.token);
    if (!user) return { ok: false, error: 'AUTH' };
    if (a === 'opsSync') {
      var res = opsSync_(D, user, body);
      opsSave_(D);
      opsKirimPush_(D, res.pushes);
      if (res.pushes.length) opsSave_(D); // langganan kedaluwarsa dibersihkan
      return { ok: true, data: opsView_(D, user), idMap: res.idMap, conflicts: res.conflicts };
    }
    if (a === 'opsFile') return opsFile_(D, user, body.fileId);
    if (a === 'opsSubscribe') {
      var s = body.sub || {};
      if (!s.endpoint || !s.keys) return { ok: false, error: 'LANGGANAN_TIDAK_VALID' };
      D.subs = (D.subs || []).filter(function (x) { return x.endpoint !== s.endpoint; });
      var pt = opsRandomHex_(24);
      D.subs.push({ u: user.username, endpoint: s.endpoint, p256dh: s.keys.p256dh || '', auth: s.keys.auth || '', token: pt, t: Date.now(), lastInbox: Date.now() });
      opsSave_(D);
      return { ok: true, pushToken: pt };
    }
    if (a === 'opsUnsubscribe') {
      D.subs = (D.subs || []).filter(function (x) { return x.endpoint !== body.endpoint; });
      if (body.logout) delete D.sessions[opsHashHex_(body.token)];
      opsSave_(D);
      return { ok: true };
    }
    if (a === 'opsTestPush') {
      var n = { id: opsRandomHex_(8), t: new Date().toISOString(), toRole: user.role, toUser: user.username, dari: user.username, title: 'Notifikasi uji', body: 'Jika pesan ini muncul di layar kunci, notifikasi HP sudah berfungsi.', link: '', readBy: [] };
      D.notifs.unshift(n);
      opsSave_(D);
      var r = opsKirimPush_(D, [n], true);
      opsSave_(D);
      return { ok: true, devices: r.terkirim, gagal: r.gagal };
    }
    return { ok: false, error: 'ACTION_TIDAK_DIKENAL' };
  });
}

// ---------------------------------------------------------------------
// Penyimpanan
// ---------------------------------------------------------------------
function opsFolder_() {
  var it = DriveApp.getFoldersByName(OPS_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(OPS_FOLDER);
}
function opsSubFolder_(parent, name) {
  var nm = String(name || 'Lainnya').replace(/[\\\/:*?"<>|#%]+/g, ' ').trim().slice(0, 80) || 'Lainnya';
  var it = parent.getFoldersByName(nm);
  return it.hasNext() ? it.next() : parent.createFolder(nm);
}
function opsFile_get_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('NVP_OPS_FILE_ID');
  if (id) { try { var f = DriveApp.getFileById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  var folder = opsFolder_();
  var it = folder.getFilesByName(OPS_FILE_NAME);
  var f2 = it.hasNext() ? it.next() : folder.createFile(OPS_FILE_NAME, '{}', MimeType.PLAIN_TEXT);
  props.setProperty('NVP_OPS_FILE_ID', f2.getId());
  return f2;
}
function opsLoad_() {
  var raw = opsFile_get_().getBlob().getDataAsString();
  var D = {};
  try { D = raw ? JSON.parse(raw) : {}; } catch (e) { throw new Error('Data aplikasi tidak dapat dibaca.'); }
  OPS_COLS.concat(['notifs', 'subs']).forEach(function (k) { if (!Array.isArray(D[k])) D[k] = []; });
  D.seq = D.seq || {}; D.sessions = D.sessions || {};
  return D;
}
function opsSave_(D) {
  D.notifs = D.notifs.slice(0, 1500);
  opsFile_get_().setContent(JSON.stringify(D));
}

// ---------------------------------------------------------------------
// Sesi & pengguna
// ---------------------------------------------------------------------
function opsUsers_() {
  return nvpLoadUsers_(true).map(nvpPublicUser_).filter(function (u) { return OPS_ROLES.indexOf(u.role) >= 0; });
}
function opsUserStamp_(username) {
  var list = nvpLoadUsers_(true);
  for (var i = 0; i < list.length; i++) if (list[i].username === username) return String(list[i].hash || '').slice(0, 12);
  return '';
}
function opsSessionUser_(D, token) {
  if (!token) return null;
  var s = D.sessions[opsHashHex_(token)];
  if (!s || s.exp < Date.now()) return null;
  var users = nvpLoadUsers_(true);
  for (var i = 0; i < users.length; i++) {
    if (users[i].username === s.u) {
      if (String(users[i].hash || '').slice(0, 12) !== s.h) return null; // password diganti → sesi lama berakhir
      var pu = nvpPublicUser_(users[i]);
      return OPS_ROLES.indexOf(pu.role) >= 0 ? pu : null;
    }
  }
  return null;
}
function opsPruneSessions_(sessions) {
  var out = {}, now = Date.now();
  Object.keys(sessions || {}).forEach(function (k) { if (sessions[k].exp > now) out[k] = sessions[k]; });
  return out;
}

// ---------------------------------------------------------------------
// Tampilan data per peran
// ---------------------------------------------------------------------
function opsView_(D, user) {
  var me = user.username, role = user.role;
  var tugas = D.tugas, pekerjaan = D.pekerjaan, aju = D.aju;
  if (role === 'teknisi') {
    tugas = tugas.filter(function (t) { return (t.teknisiIds || []).indexOf(me) >= 0; });
    pekerjaan = pekerjaan.filter(function (p) { return p.teknisiId === me; });
    aju = aju.filter(function (a) { return a.pemohonId === me; });
  }
  var notifs = D.notifs.filter(function (n) { return n.toRole === role && (!n.toUser || n.toUser === me); }).slice(0, 150)
    .map(function (n) { return { id: n.id, t: n.t, toRole: n.toRole, toUser: n.toUser, dari: n.dari, title: n.title, body: n.body, link: n.link, read: (n.readBy || []).indexOf(me) >= 0 }; });
  return {
    tugas: tugas, pekerjaan: pekerjaan, aju: aju,
    kasKeluar: role === 'direktur' ? D.kasKeluar : [],
    notifs: notifs,
    users: opsUsers_().map(function (u) { return { id: u.username, username: u.username, name: u.name, role: u.role }; }),
  };
}

// ---------------------------------------------------------------------
// Sinkronisasi: terima perubahan per catatan sesuai hak peran
// ---------------------------------------------------------------------
var OPS_URUT_TUGAS = { baru: 0, dikerjakan: 1, selesai: 2 };
var OPS_TRANSISI_AJU = {
  teknisi: { dikembalikan: ['cek_manager'] },
  manager: { cek_manager: ['menunggu_direktur', 'dikembalikan'], dikembalikan: ['menunggu_direktur'] },
  direktur: { menunggu_direktur: ['dibayar', 'ditolak', 'dikembalikan'] },
};

function opsSync_(D, user, body) {
  var me = user.username, role = user.role, now = new Date().toISOString();
  var ch = body.changes || {};
  var idMap = {}, conflicts = [], events = [];
  var map = function (id) { return idMap[id] || id; };
  var cari = function (col, id) { for (var i = 0; i < D[col].length; i++) if (D[col][i].id === id) return D[col][i]; return null; };
  var gabungRiwayat = function (srv, inc) {
    var key = function (h) { return h.t + '|' + h.by + '|' + h.action; };
    var ada = {}; (srv.history || []).forEach(function (h) { ada[key(h)] = 1; });
    (inc.history || []).forEach(function (h) { if (h && h.by === me && !ada[key(h)]) { srv.history = (srv.history || []).concat([{ t: String(h.t), by: me, action: String(h.action).slice(0, 200), note: String(h.note || '').slice(0, 500) }]); } });
  };
  var str = function (v, n) { return String(v == null ? '' : v).slice(0, n || 300); };

  // ---- pekerjaan (refilling / pengadaan)
  (ch.pekerjaan || []).forEach(function (p) {
    var srv = cari('pekerjaan', p.id);
    if (!srv) {
      if (role !== 'teknisi' || String(p.id).indexOf('tmp-') !== 0) return;
      var tgl = /^\d{4}-\d{2}-\d{2}$/.test(p.tanggal) ? p.tanggal : now.slice(0, 10);
      var rec = { id: opsNextNo_(D, 'PKJ', tgl), tanggal: tgl, jenis: p.jenis === 'Pengadaan' ? 'Pengadaan' : 'Refilling', konsumen: str(p.konsumen, 120), alamat: str(p.alamat, 200),
        rows: opsRows_(p.rows), teknisiId: me, createdAt: now, taskId: null, rev: 1 };
      rec.foto = opsSimpanFoto_(p.foto, rec.konsumen, 6);
      idMap[p.id] = rec.id;
      D.pekerjaan.unshift(rec);
      events.push({ jenis: 'pdfPekerjaan', id: rec.id });
    } else if (role === 'manager' && p.taskId && !srv.taskId && String(p.taskId).indexOf('tmp-') !== 0) {
      srv.taskId = String(p.taskId); srv.rev = (srv.rev || 0) + 1;   // tautan dari tugas baru diatur saat tugas dibuat
    }
  });

  // ---- tugas pemeriksaan
  (ch.tugas || []).forEach(function (t) {
    var srv = cari('tugas', t.id);
    if (!srv) {
      if (role !== 'manager' || String(t.id).indexOf('tmp-') !== 0) return;
      var teknisi = opsUsers_().filter(function (u) { return u.role === 'teknisi'; }).map(function (u) { return u.username; });
      var ids = (t.teknisiIds || []).filter(function (x) { return teknisi.indexOf(x) >= 0; });
      var mulai = /^\d{4}-\d{2}-\d{2}$/.test(t.tglMulai) ? t.tglMulai : now.slice(0, 10);
      var units = (t.units || []).slice(0, 300).map(function (u, i) { return opsUnit_(u, i + 1); });
      var rec = { id: opsNextNo_(D, 'TP', mulai), tempat: str(t.tempat, 120), alamat: str(t.alamat, 200), tglMulai: mulai, tglSelesai: /^\d{4}-\d{2}-\d{2}$/.test(t.tglSelesai) ? t.tglSelesai : mulai,
        jumlah: units.length, type: str(t.type, 60), berat: str(t.berat, 30), rows: opsRows_(t.rows), teknisiIds: ids, catatan: str(t.catatan, 500), units: units,
        sumber: t.sumber ? map(t.sumber) : null, status: 'baru', dibuatOleh: me, history: [], rev: 1 };
      gabungRiwayat(rec, t);
      idMap[t.id] = rec.id;
      D.tugas.unshift(rec);
      if (rec.sumber) { var pk = cari('pekerjaan', rec.sumber); if (pk && (!pk.taskId || String(pk.taskId).indexOf('tmp-') === 0)) { pk.taskId = rec.id; pk.rev = (pk.rev || 0) + 1; } }
      return;
    }
    if (role !== 'teknisi' || (srv.teknisiIds || []).indexOf(me) < 0) return;
    var berubah = false;
    // unit: terima per unit yang diubah lebih baru (dua teknisi bisa mengisi bersamaan)
    (t.units || []).forEach(function (u, i) {
      if (!srv.units[i] || !u) return;
      if ((Number(u.t) || 0) > (Number(srv.units[i].t) || 0) && srv.status !== 'selesai') {
        var nu = opsUnit_(u, srv.units[i].no);
        nu.foto = opsSimpanFoto_(u.foto, srv.tempat, 2);
        nu.t = Number(u.t); nu.by = me;
        srv.units[i] = nu; berubah = true;
      }
    });
    var st = t.status;
    if (OPS_URUT_TUGAS[st] > OPS_URUT_TUGAS[srv.status]) {
      var semua = srv.units.every(function (u) { return u.tekanan && u.kedaluwarsa && u.selang && u.handle && u.pin; });
      if (st === 'dikerjakan' || (st === 'selesai' && semua)) {
        srv.status = st; berubah = true;
        if (st === 'selesai') { srv.selesaiAt = now; events.push({ jenis: 'pdfTugas', id: srv.id }); }
      } else conflicts.push({ col: 'tugas', id: srv.id, pesan: 'Belum semua APAR diperiksa.' });
    }
    gabungRiwayat(srv, t);
    if (berubah) srv.rev = (srv.rev || 0) + 1;
  });

  // ---- pengajuan gaji / pembayaran
  (ch.aju || []).forEach(function (a) {
    var srv = cari('aju', a.id);
    if (!srv) {
      if (String(a.id).indexOf('tmp-') !== 0 || (role !== 'teknisi' && role !== 'manager')) return;
      var rinc = opsRincian_(a.rincian);
      if (!rinc.length) return;
      var gaji = role === 'teknisi' || a.jenis === 'gaji';
      var rec = { id: opsNextNo_(D, 'PGJ', now.slice(0, 10)), jenis: gaji ? 'gaji' : 'pembayaran', pemohonId: me, periode: str(a.periode, 7), keperluan: str(a.keperluan, 160),
        kategori: a.kategori === 'HPP' ? 'HPP' : 'Operasional', jenisBiaya: gaji ? 'Gaji & upah karyawan' : str(a.jenisBiaya, 80), rincian: rinc, total: opsJumlah_(rinc),
        bank: str(a.bank, 40), rekening: str(a.rekening, 40), atasNama: str(a.atasNama, 80), catatan: str(a.catatan, 500),
        status: role === 'teknisi' ? 'cek_manager' : 'menunggu_direktur', createdAt: now, history: [], rev: 1 };
      rec.lampiran = opsSimpanFoto_(a.lampiran, 'Pengajuan', 4);
      gabungRiwayat(rec, a);
      idMap[a.id] = rec.id;
      D.aju.unshift(rec);
      return;
    }
    if (Number(a._base || 0) !== Number(srv.rev || 0)) { conflicts.push({ col: 'aju', id: srv.id, pesan: 'Pengajuan sudah diubah orang lain — data dimuat ulang.' }); return; }
    var boleh = ((OPS_TRANSISI_AJU[role] || {})[srv.status] || []);
    var pemilik = srv.pemohonId === me;
    if (srv.status === 'dikembalikan' && !pemilik) boleh = [];
    if (role === 'manager' && srv.status === 'dikembalikan' && pemilik) boleh = ['menunggu_direktur'];
    if (a.status === srv.status || boleh.indexOf(a.status) < 0) return;
    if (srv.status === 'dikembalikan') {
      var r2 = opsRincian_(a.rincian);
      if (r2.length) { srv.rincian = r2; srv.total = opsJumlah_(r2); }
      ['keperluan', 'periode', 'bank', 'rekening', 'atasNama', 'catatan'].forEach(function (k) { if (a[k] != null) srv[k] = str(a[k], 160); });
      if (role === 'manager' && a.jenisBiaya) { srv.jenisBiaya = str(a.jenisBiaya, 80); srv.kategori = a.kategori === 'HPP' ? 'HPP' : 'Operasional'; }
      srv.lampiran = (srv.lampiran || []).concat(opsSimpanFoto_((a.lampiran || []).filter(function (x) { return x && x.dataUrl; }), 'Pengajuan', 4)).slice(0, 4);
    }
    if (a.status === 'dibayar') {
      var b = a.bayar || {};
      var bukti = opsSimpanFoto_(b.bukti, 'Bukti Pembayaran', 2);
      if (!bukti.length) { conflicts.push({ col: 'aju', id: srv.id, pesan: 'Bukti pembayaran wajib.' }); return; }
      srv.bayar = { tgl: /^\d{4}-\d{2}-\d{2}$/.test(b.tgl) ? b.tgl : now.slice(0, 10), metode: b.metode === 'Tunai' ? 'Tunai' : 'Transfer bank', ref: str(b.ref, 60), bukti: bukti, oleh: me };
      events.push({ jenis: 'bayar', id: srv.id });
    }
    srv.status = a.status;
    gabungRiwayat(srv, a);
    srv.rev = (srv.rev || 0) + 1;
  });

  // ---- notifikasi baru dari perangkat ini (pengirim = akun ini)
  var pushes = [];
  (body.notifs || []).slice(0, 30).forEach(function (n) {
    if (!n || OPS_ROLES.indexOf(n.toRole) < 0) return;
    var link = String(n.link || '').replace(/(tmp-[a-z0-9]+)/g, function (m) { return map(m); });
    var rec = { id: opsRandomHex_(8), t: now, toRole: n.toRole, toUser: n.toUser ? String(n.toUser) : '', dari: me, title: str(n.title, 120).replace(/tmp-[a-z0-9]+/g, function (m) { return map(m); }),
      body: str(n.body, 300).replace(/tmp-[a-z0-9]+/g, function (m) { return map(m); }), link: link, readBy: [] };
    D.notifs.unshift(rec); pushes.push(rec);
  });
  // ---- tanda sudah dibaca
  var dibaca = {}; (body.dibaca || []).forEach(function (id) { dibaca[id] = 1; });
  if (body.dibaca && body.dibaca.length) D.notifs.forEach(function (n) { if (dibaca[n.id] && (n.readBy || []).indexOf(me) < 0) n.readBy = (n.readBy || []).concat([me]); });

  // ---- efek samping: pembayaran → Kas Keluar + Pengeluaran portal; laporan PDF ke Drive
  events.forEach(function (ev) {
    try {
      if (ev.jenis === 'bayar') opsCatatPembayaran_(D, cari('aju', ev.id), user);
      if (ev.jenis === 'pdfTugas') { var tg = cari('tugas', ev.id); tg.pdf = opsPdfTugas_(tg); }
      if (ev.jenis === 'pdfPekerjaan') { var pk = cari('pekerjaan', ev.id); pk.pdf = opsPdfPekerjaan_(pk); }
    } catch (e) { conflicts.push({ id: ev.id, pesan: 'Proses lanjutan gagal: ' + e.message }); }
  });
  return { idMap: idMap, conflicts: conflicts, pushes: pushes };
}

function opsNextNo_(D, kind, date) {
  var y = String(date || new Date().toISOString()).slice(0, 4);
  D.seq[kind] = D.seq[kind] || {};
  var n = (D.seq[kind][y] || 0) + 1;
  D.seq[kind][y] = n;
  return ('000' + n).slice(-4) + '/' + kind + '/NVP/' + y;
}
function opsRows_(rows) {
  return (rows || []).slice(0, 20).map(function (r) { return { type: String(r.type || '').slice(0, 60), berat: String(r.berat || '').slice(0, 30), jumlah: Math.max(0, Math.min(500, Math.round(Number(r.jumlah) || 0))) }; })
    .filter(function (r) { return r.type && r.berat && r.jumlah > 0; });
}
function opsRincian_(r) {
  return (r || []).slice(0, 20).map(function (x) { return { desc: String(x.desc || '').slice(0, 120), jumlah: Math.round(Number(x.jumlah) || 0) }; })
    .filter(function (x) { return x.desc && x.jumlah > 0 && x.jumlah < 1e11; });
}
function opsJumlah_(r) { return r.reduce(function (s, x) { return s + x.jumlah; }, 0); }
function opsUnit_(u, no) {
  var pick = function (v, opsi) { return opsi.indexOf(v) >= 0 ? v : ''; };
  return { no: no, lokasi: String(u.lokasi || '').slice(0, 80), type: String(u.type || '').slice(0, 60), berat: String(u.berat || '').slice(0, 30),
    tekanan: pick(u.tekanan, ['Normal', 'Kurang', 'Lebih']), kedaluwarsa: /^\d{4}-\d{2}-\d{2}$/.test(u.kedaluwarsa) ? u.kedaluwarsa : '',
    selang: pick(u.selang, ['Baik', 'Retak/bocor', 'Tidak ada']), handle: pick(u.handle, ['Baik', 'Rusak']), pin: pick(u.pin, ['Ada & tersegel', 'Hilang/rusak']),
    ket: String(u.ket || '').slice(0, 200), foto: [] };
}

// ---------------------------------------------------------------------
// Foto & berkas di Drive
// ---------------------------------------------------------------------
/** Foto baru (dataUrl) disimpan ke Drive; foto lama (fileId) dipertahankan. */
function opsSimpanFoto_(list, klien, max) {
  var out = [], folder = null;
  (list || []).slice(0, max || 6).forEach(function (f, i) {
    if (!f) return;
    if (f.fileId) { out.push({ fileId: String(f.fileId), name: String(f.name || ''), waktu: f.waktu || '' }); return; }
    var m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(String(f.dataUrl || ''));
    if (!m || m[3].length > 4e6) return;
    folder = folder || opsSubFolder_(opsSubFolder_(opsFolder_(), klien), 'Foto');
    var nama = String(f.name || ('foto-' + Date.now() + '-' + i + '.jpg')).replace(/[^\w.\-]+/g, '-');
    var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(m[3]), m[1], nama));
    out.push({ fileId: file.getId(), name: nama, waktu: f.waktu || '' });
  });
  return out;
}
/** Mengirim isi berkas (foto/PDF) ke aplikasi — hanya berkas yang memang terlihat oleh akun ini. */
function opsFile_(D, user, fileId) {
  if (!fileId || JSON.stringify(opsView_(D, user)).indexOf('"' + fileId + '"') < 0) return { ok: false, error: 'TIDAK_DIIZINKAN' };
  var blob = DriveApp.getFileById(fileId).getBlob();
  return { ok: true, mime: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()), name: blob.getName() };
}
function opsDataUri_(fileId) {
  try { var b = DriveApp.getFileById(fileId).getBlob(); return 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()); } catch (e) { return ''; }
}
function opsEsc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function opsTgl_(s) {
  if (!s) return '';
  var b = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  var p = String(s).slice(0, 10).split('-');
  return Number(p[2]) + ' ' + b[Number(p[1]) - 1] + ' ' + p[0];
}
function opsNamaUser_(u) { var x = opsUsers_().filter(function (v) { return v.username === u; })[0]; return x ? x.name : u; }
function opsKop_(judul, nomor) {
  return '<table style="width:100%;border-bottom:3px solid #0b0f14;margin-bottom:12px"><tr><td><div style="font-size:16px;font-weight:bold">PT NURI VIRA PRATAMA</div>' +
    '<div style="font-size:9px;color:#555">Viopran Fire Extinguisher · Jakarta · 0856-7725-758</div></td>' +
    '<td style="text-align:right"><div style="font-size:13px;font-weight:bold">' + opsEsc_(judul) + '</div><div style="font-size:9px;color:#555">' + opsEsc_(nomor) + '</div></td></tr></table>';
}
function opsSimpanPdf_(html, klien, nama) {
  var doc = '<html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:10px;color:#111}table.g{border-collapse:collapse;width:100%}table.g th,table.g td{border:1px solid #999;padding:3px 4px;text-align:left;vertical-align:top}table.g th{background:#eee}.ok{color:#047857;font-weight:bold}.no{color:#b91c1c;font-weight:bold}</style></head><body>' + html + '</body></html>';
  var pdf = Utilities.newBlob(doc, 'text/html', 'laporan.html').getAs('application/pdf').setName(nama);
  var folder = opsSubFolder_(opsSubFolder_(opsFolder_(), klien), 'Laporan');
  var lama = folder.getFilesByName(nama);
  while (lama.hasNext()) lama.next().setTrashed(true);
  var f = folder.createFile(pdf);
  return { fileId: f.getId(), name: nama };
}
function opsLayak_(u) {
  var isi = u.tekanan && u.kedaluwarsa && u.selang && u.handle && u.pin;
  var today = Utilities.formatDate(new Date(), NVP_TIMEZONE, 'yyyy-MM-dd');
  return isi && u.tekanan === 'Normal' && u.kedaluwarsa >= today && u.selang !== 'Retak/bocor' && u.handle === 'Baik' && u.pin === 'Ada & tersegel';
}
function opsPdfTugas_(t) {
  var lay = t.units.filter(opsLayak_).length;
  var h = opsKop_('LAPORAN PEMERIKSAAN APAR', t.id) +
    '<table style="font-size:10px;margin-bottom:8px"><tr><td style="width:120px;color:#555">Tempat pemeriksaan</td><td><b>' + opsEsc_(t.tempat) + (t.alamat ? ' — ' + opsEsc_(t.alamat) : '') + '</b></td></tr>' +
    '<tr><td style="color:#555">Tanggal</td><td><b>' + opsTgl_(t.tglMulai) + ' s.d. ' + opsTgl_(t.tglSelesai) + '</b></td></tr>' +
    '<tr><td style="color:#555">Teknisi</td><td><b>' + opsEsc_(t.teknisiIds.map(opsNamaUser_).join(', ')) + '</b></td></tr>' +
    '<tr><td style="color:#555">Hasil</td><td><b>' + t.units.length + ' APAR · ' + lay + ' layak · ' + (t.units.length - lay) + ' tidak layak</b></td></tr></table>' +
    '<table class="g"><tr><th>No</th><th>Lokasi</th><th>Type</th><th>Berat</th><th>Tekanan</th><th>Masa berlaku</th><th>Selang</th><th>Handle</th><th>Pin &amp; segel</th><th>Hasil</th><th>Keterangan</th></tr>' +
    t.units.map(function (u) {
      var ok = opsLayak_(u);
      return '<tr><td>' + u.no + '</td><td>' + opsEsc_(u.lokasi) + '</td><td>' + opsEsc_(String(u.type).split(' (')[0]) + '</td><td>' + opsEsc_(u.berat) + '</td><td>' + opsEsc_(u.tekanan) + '</td><td>' + opsTgl_(u.kedaluwarsa) +
        '</td><td>' + opsEsc_(u.selang) + '</td><td>' + opsEsc_(u.handle) + '</td><td>' + opsEsc_(u.pin) + '</td><td class="' + (ok ? 'ok' : 'no') + '">' + (ok ? 'Layak' : 'Tidak layak') + '</td><td>' + opsEsc_(u.ket) + '</td></tr>';
    }).join('') + '</table>' +
    '<p style="font-size:8px;color:#666">Kriteria layak: tekanan normal, masa berlaku isi belum lewat, selang/horn tidak retak, handle baik, pin pengaman &amp; segel ada.</p>';
  var foto = [];
  t.units.forEach(function (u) { (u.foto || []).forEach(function (f) { if (f.fileId) foto.push({ no: u.no, src: opsDataUri_(f.fileId) }); }); });
  if (foto.length) {
    h += '<p style="font-weight:bold;margin-top:12px">Dokumentasi</p><table style="width:100%">';
    for (var i = 0; i < foto.length; i += 3) {
      h += '<tr>' + foto.slice(i, i + 3).map(function (f) { return '<td style="width:33%;padding:3px;vertical-align:top"><img src="' + f.src + '" style="width:100%"><div style="font-size:8px;text-align:center">APAR no. ' + f.no + '</div></td>'; }).join('') + '</tr>';
    }
    h += '</table>';
  }
  h += '<table style="width:100%;margin-top:24px"><tr><td></td><td style="width:200px;text-align:center;font-size:10px">Jakarta, ' + opsTgl_(Utilities.formatDate(new Date(), NVP_TIMEZONE, 'yyyy-MM-dd')) + '<br><br><br><br>________________________<br><b>Manager Operasional</b></td></tr></table>';
  return opsSimpanPdf_(h, t.tempat, 'Laporan Pemeriksaan ' + t.id.replace(/\//g, '-') + '.pdf');
}
function opsPdfPekerjaan_(p) {
  var h = opsKop_('DOKUMENTASI ' + String(p.jenis).toUpperCase() + ' APAR', p.id) +
    '<table style="font-size:10px;margin-bottom:8px"><tr><td style="width:120px;color:#555">Konsumen</td><td><b>' + opsEsc_(p.konsumen) + (p.alamat ? ' — ' + opsEsc_(p.alamat) : '') + '</b></td></tr>' +
    '<tr><td style="color:#555">Tanggal pengerjaan</td><td><b>' + opsTgl_(p.tanggal) + '</b></td></tr><tr><td style="color:#555">Teknisi</td><td><b>' + opsEsc_(opsNamaUser_(p.teknisiId)) + '</b></td></tr></table>' +
    '<table class="g"><tr><th>No</th><th>Type APAR</th><th>Berat</th><th>Jumlah</th></tr>' +
    p.rows.map(function (r, i) { return '<tr><td>' + (i + 1) + '</td><td>' + opsEsc_(r.type) + '</td><td>' + opsEsc_(r.berat) + '</td><td>' + r.jumlah + ' unit</td></tr>'; }).join('') + '</table>';
  var foto = (p.foto || []).filter(function (f) { return f.fileId; }).map(function (f) { return opsDataUri_(f.fileId); });
  if (foto.length) {
    h += '<p style="font-weight:bold;margin-top:12px">Foto pengerjaan</p><table style="width:100%">';
    for (var i = 0; i < foto.length; i += 2) h += '<tr>' + foto.slice(i, i + 2).map(function (src) { return '<td style="width:50%;padding:3px"><img src="' + src + '" style="width:100%"></td>'; }).join('') + '</tr>';
    h += '</table>';
  }
  return opsSimpanPdf_(h, p.konsumen, 'Dokumentasi ' + p.jenis + ' ' + p.id.replace(/\//g, '-') + '.pdf');
}

// ---------------------------------------------------------------------
// Pembayaran → Kas Keluar aplikasi + Pengeluaran di portal keuangan
// ---------------------------------------------------------------------
function opsCatatPembayaran_(D, a, user) {
  D.seq.KK = (D.seq.KK || 0) + 1;
  var kkId = 'KK-' + ('000' + D.seq.KK).slice(-4);
  var penerima = a.jenis === 'gaji' ? opsNamaUser_(a.pemohonId) : a.atasNama;
  var bukti = (a.bayar.bukti || [])[0];
  var kk = { id: kkId, tgl: a.bayar.tgl, deskripsi: a.keperluan + ' — ' + penerima, kategori: a.kategori, jenisBiaya: a.jenisBiaya, nominal: a.total, ref: a.bayar.ref,
    pengajuanId: a.id, buktiFileId: bukti ? bukti.fileId : '', sinkron: false };
  D.kasKeluar.unshift(kk);
  a.kasKeluarId = kkId;
  // catat ke portal (file data keuangan yang sama dengan website)
  var raw = loadDataFromDrive_();
  var data = raw ? JSON.parse(raw) : {};
  data.expenses = Array.isArray(data.expenses) ? data.expenses : [];
  var expId = 'EXP-OPS-' + kkId.slice(3);
  if (!data.expenses.some(function (e) { return e && e.opsRef === a.id; })) {
    data.expenses.unshift({ id: expId, date: kk.tgl, desc: kk.deskripsi + ' (' + a.id + ')', category: a.kategori === 'HPP' ? 'HPP' : 'Operasional', jenis: a.jenisBiaya,
      amount: a.total, ppnMasukan: 0, paymentStatus: 'lunas', paidDate: '', nonDeductible: false,
      sumber: 'NVP Operasional', opsRef: a.id, opsKasKeluar: kkId, buktiUrl: bukti ? 'https://drive.google.com/file/d/' + bukti.fileId + '/view' : '' });
    saveDataToDrive_(JSON.stringify(data));
  }
  kk.sinkron = true; kk.expenseId = expId;
}

/** Portal tidak boleh menghapus/mengubah pengeluaran yang berasal dari aplikasi (dipanggil dari Api.gs saat menyimpan). */
function opsJagaPengeluaran_(incoming, currentRaw) {
  var cur = {};
  try { cur = currentRaw ? JSON.parse(currentRaw) : {}; } catch (e) { return incoming; }
  var dariOps = (cur.expenses || []).filter(function (e) { return e && e.sumber === 'NVP Operasional'; });
  if (!dariOps.length || !incoming || !Array.isArray(incoming.expenses)) return incoming;
  var out = {}; Object.keys(incoming).forEach(function (k) { out[k] = incoming[k]; });
  out.expenses = incoming.expenses.filter(function (e) { return !(e && e.sumber === 'NVP Operasional'); }).concat(dariOps);
  return out;
}

// ---------------------------------------------------------------------
// Notifikasi HP (Web Push + VAPID) — tanpa isi pesan; HP mengambil isinya lewat opsInbox
// ---------------------------------------------------------------------
function opsKirimPush_(D, notifs, termasukPengirim) {
  var users = opsUsers_();
  var target = {};
  notifs.forEach(function (n) {
    users.forEach(function (u) {
      if (u.role !== n.toRole) return;
      if (n.toUser && n.toUser !== u.username) return;
      if (u.username === n.dari && !termasukPengirim) return;
      target[u.username] = 1;
    });
  });
  var subs = (D.subs || []).filter(function (s) { return target[s.u]; });
  if (!subs.length) return { terkirim: 0, gagal: 0 };
  var v = opsVapid_();
  var reqs = subs.map(function (s) {
    var aud = s.endpoint.match(/^https:\/\/[^\/]+/)[0];
    var jwt = opsVapidJwt_(v, aud);
    return { url: s.endpoint, method: 'post', muteHttpExceptions: true, payload: '', contentType: 'application/octet-stream',
      headers: { Authorization: 'vapid t=' + jwt + ', k=' + v.pub, TTL: '86400', Urgency: 'high' } };
  });
  var res = UrlFetchApp.fetchAll(reqs);
  var hapus = {}, ok = 0, gagal = 0;
  res.forEach(function (r, i) {
    var c = r.getResponseCode();
    if (c >= 200 && c < 300) ok++; else { gagal++; if (c === 404 || c === 410) hapus[subs[i].endpoint] = 1; }
  });
  if (gagal) D.subs = D.subs.filter(function (s) { return !hapus[s.endpoint]; });
  return { terkirim: ok, gagal: gagal };
}
/** Dipanggil service worker di HP saat push masuk: ambil pesan yang belum ditampilkan. */
function opsInbox_(body) {
  var D = opsLoad_();
  var s = (D.subs || []).filter(function (x) { return x.token && x.token === body.pushToken; })[0];
  if (!s) return { ok: false, error: 'AUTH' };
  var u = opsUsers_().filter(function (x) { return x.username === s.u; })[0];
  if (!u) return { ok: false, error: 'AUTH' };
  var mine = D.notifs.filter(function (n) { return n.toRole === u.role && (!n.toUser || n.toUser === u.username) && (n.readBy || []).indexOf(u.username) < 0; });
  var baru = mine.filter(function (n) { return Date.parse(n.t) > (s.lastInbox || 0); });
  var items = (baru.length ? baru : mine.slice(0, 1)).slice(0, 4).map(function (n) { return { id: n.id, title: n.title, body: n.body, link: n.link }; });
  s.lastInbox = Date.now();
  opsSave_(D);
  return { ok: true, items: items, unread: mine.length };
}

// Browser memperbarui langganan push sendiri (pushsubscriptionchange) → ganti endpoint, kode perangkat tetap
function opsPerbaruiLangganan_(body) {
  var D = opsLoad_();
  var s = body.sub || {};
  var lama = (D.subs || []).filter(function (x) { return x.token && x.token === body.pushToken; })[0];
  if (!lama) return { ok: false, error: 'AUTH' };
  if (!s.endpoint || !s.keys) return { ok: false, error: 'LANGGANAN_TIDAK_VALID' };
  D.subs = D.subs.filter(function (x) { return x === lama || x.endpoint !== s.endpoint; });
  lama.endpoint = s.endpoint; lama.p256dh = s.keys.p256dh || ''; lama.auth = s.keys.auth || ''; lama.t = Date.now();
  opsSave_(D);
  return { ok: true, pushToken: lama.token };
}

// ---- kunci VAPID (P-256), dibuat sekali & disimpan di Script Properties
function opsVapid_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('NVP_OPS_VAPID');
  if (raw) return JSON.parse(raw);
  var seed = [];
  for (var i = 0; i < 4; i++) seed = seed.concat(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + ':' + Date.now() + ':' + i));
  var d = (opsBytesToBig_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed)) % (P256.n - BN1_)) + BN1_;
  var Q = p256Mul_(d, P256.G);
  var pub = [4].concat(opsBigToBytes_(Q[0], 32), opsBigToBytes_(Q[1], 32));
  var v = { d: d.toString(16), pub: opsB64u_(pub) };
  props.setProperty('NVP_OPS_VAPID', JSON.stringify(v));
  return v;
}
function opsVapidJwt_(v, aud) {
  var enc = function (o) { return opsB64u_(Utilities.newBlob(JSON.stringify(o)).getBytes()); };
  var input = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: OPS_VAPID_SUBJECT });
  var sig = p256Sign_(BigInt('0x' + v.d), Utilities.newBlob(input).getBytes());
  return input + '.' + opsB64u_(sig);
}

// ---- ECDSA P-256 (ES256) — implementasi kecil dengan BigInt, tanda tangan deterministik RFC 6979
// Catatan: Apps Script tidak menerima penulisan angka BigInt seperti 0n, jadi dipakai BigInt('...')
var BN0_ = BigInt(0), BN1_ = BigInt(1), BN2_ = BigInt(2), BN3_ = BigInt(3);
var P256 = {
  p: BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
  a: BigInt('0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc'),
  n: BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
  G: [BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'), BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')],
};
function p256Mod_(x, m) { var r = x % m; return r < BN0_ ? r + m : r; }
function p256Inv_(x, m) {
  var a = p256Mod_(x, m), b = m, x0 = BN1_, x1 = BN0_;
  while (b) { var q = a / b, t = a - q * b; a = b; b = t; t = x0 - q * x1; x0 = x1; x1 = t; }
  return p256Mod_(x0, m);
}
function p256Add_(P, Q) {
  if (!P) return Q; if (!Q) return P;
  var p = P256.p, l;
  if (P[0] === Q[0]) {
    if (p256Mod_(P[1] + Q[1], p) === BN0_) return null;
    l = p256Mod_((BN3_ * P[0] * P[0] + P256.a) * p256Inv_(BN2_ * P[1], p), p);
  } else l = p256Mod_((Q[1] - P[1]) * p256Inv_(Q[0] - P[0], p), p);
  var x = p256Mod_(l * l - P[0] - Q[0], p);
  return [x, p256Mod_(l * (P[0] - x) - P[1], p)];
}
function p256Mul_(k, P) {
  var R = null, A = P;
  while (k > BN0_) { if (k & BN1_) R = p256Add_(R, A); A = p256Add_(A, A); k >>= BN1_; }
  return R;
}
function p256Hmac_(key, msg) { return Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, msg, key); }
function p256Sign_(d, msgBytes) {
  var n = P256.n;
  var h1 = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, msgBytes);
  var e = opsBytesToBig_(h1) % n;
  var x = opsBigToBytes_(d, 32), hb = opsBigToBytes_(e, 32);
  var V = [], K = [];
  for (var i = 0; i < 32; i++) { V.push(1); K.push(0); }
  K = p256Hmac_(K, V.concat([0], x, hb)); V = p256Hmac_(K, V);
  K = p256Hmac_(K, V.concat([1], x, hb)); V = p256Hmac_(K, V);
  while (true) {
    V = p256Hmac_(K, V);
    var k = opsBytesToBig_(V);
    if (k > BN0_ && k < n) {
      var R = p256Mul_(k, P256.G), r = R[0] % n;
      if (r !== BN0_) {
        var s = p256Mod_(p256Inv_(k, n) * (e + r * d), n);
        if (s !== BN0_) return opsBigToBytes_(r, 32).concat(opsBigToBytes_(s, 32));
      }
    }
    K = p256Hmac_(K, V.concat([0])); V = p256Hmac_(K, V);
  }
}

// ---- bantuan byte / base64url / acak
function opsBytesToBig_(b) { var h = ''; for (var i = 0; i < b.length; i++) h += ('0' + (b[i] & 255).toString(16)).slice(-2); return BigInt('0x' + (h || '0')); }
function opsBigToBytes_(x, len) { var h = x.toString(16); while (h.length < len * 2) h = '0' + h; var out = []; for (var i = 0; i < len; i++) { var v = parseInt(h.substr(i * 2, 2), 16); out.push(v > 127 ? v - 256 : v); } return out; }
function opsB64u_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function opsRandomHex_(n) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now());
  var h = b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
  return h.slice(0, n * 2);
}
function opsHashHex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'ops:' + String(s || ''), Utilities.Charset.UTF_8).map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
}
