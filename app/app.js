"use strict";

/* NVP Operasional — aplikasi operasional & alur kas PT Nuri Vira Pratama (viopran.com/app).
   Peran: Teknisi, Manager Operasional, Direktur. Data tersimpan di server (Google Drive lewat Apps Script),
   akun dibuat admin di portal viopran.com. Perubahan disimpan dulu di HP lalu dikirim otomatis (bisa offline). */
const {
  useState,
  useEffect,
  useRef
} = React;

// ================================================================== konstanta
const API_URL = window.NVP_CONFIG && window.NVP_CONFIG.API_URL || '';
const CACHE_KEY = 'nvp_ops_v1';
const PREF_KEY = 'nvp_ops_pref';
const ROLES = {
  teknisi: 'Teknisi',
  manager: 'Manager Operasional',
  direktur: 'Direktur'
};
let USERS = []; // diisi dari server: [{ id: username, username, name, role }]
let TOKEN = ''; // sesi aktif (dipakai komponen foto/berkas)
// Daftar type & berat APAR (bisa disesuaikan dengan produk yang dijual)
const TYPE_APAR = ['Powder (Dry Chemical ABC)', 'CO2 (Karbon Dioksida)', 'Foam AFFF', 'Clean Agent / Liquid Gas (HCFC-123)', 'Air (Water Mist)', 'Wet Chemical (Kelas K)'];
const BERAT_APAR = ['1 kg', '2 kg', '3 kg', '3,5 kg', '4,5 kg', '5 kg', '6 kg', '6,8 kg', '9 kg', '12 kg', '25 kg (troli)', '50 kg (troli)', '70 kg (troli)'];
const OPSI = {
  tekanan: ['Normal', 'Kurang', 'Lebih'],
  selang: ['Baik', 'Retak/bocor', 'Tidak ada'],
  handle: ['Baik', 'Rusak'],
  pin: ['Ada & tersegel', 'Hilang/rusak']
};
const JENIS_BIAYA = {
  Operasional: ['Gaji & upah karyawan', 'Transportasi & BBM', 'Pengiriman / ekspedisi', 'ATK & perlengkapan kantor', 'Perawatan & perbaikan', 'Konsumsi & jamuan', 'Lain-lain'],
  HPP: ['Pembelian tabung APAR', 'Pembelian media pemadam (powder/CO2/foam)', 'Sparepart & aksesoris', 'Jasa uji / sertifikasi pihak ketiga', 'Lain-lain']
};
const ST_TUGAS = {
  baru: ['Tugas baru', 'amber'],
  dikerjakan: ['Dikerjakan', 'blue'],
  selesai: ['Selesai', 'green']
};
const ST_AJU = {
  cek_manager: ['Diperiksa Manager', 'amber'],
  menunggu_direktur: ['Menunggu pembayaran', 'blue'],
  dibayar: ['Dibayar', 'green'],
  dikembalikan: ['Dikembalikan', 'rose'],
  ditolak: ['Ditolak', 'slate']
};
const TONE = {
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200'
};
const COMPANY = {
  name: 'PT NURI VIRA PRATAMA',
  brand: 'Viopran Fire Extinguisher',
  address: 'Jakarta',
  phone: '0856-7725-758'
};

// ================================================================== util
const fmt = n => 'Rp' + new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0));
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => ymd(new Date());
const addDays = (s, n) => {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const addMonths = (s, n) => {
  const d = new Date(s + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return ymd(d);
};
const nowIso = () => new Date().toISOString();
const fmtTime = iso => new Date(iso).toLocaleString('id-ID', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
});
const fmtDate = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
}) : '—';
const fmtBulan = s => s ? new Date(s + '-01T00:00:00').toLocaleDateString('id-ID', {
  month: 'long',
  year: 'numeric'
}) : '—';
const userById = id => USERS.find(u => u.id === id) || {
  id,
  name: id || '?',
  role: 'teknisi'
};
const noDok = id => String(id || '').indexOf('tmp-') === 0 ? 'Menunggu nomor…' : id;
const tmpId = () => 'tmp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const uid = () => Math.random().toString(36).slice(2, 10);
const unitTerisi = u => !!(u.tekanan && u.kedaluwarsa && u.selang && u.handle && u.pin);
const unitLayak = u => unitTerisi(u) && u.tekanan === 'Normal' && u.kedaluwarsa >= todayStr() && u.selang !== 'Retak/bocor' && u.handle === 'Baik' && u.pin === 'Ada & tersegel';
const progres = t => {
  const n = t.units.length;
  const d = t.units.filter(unitTerisi).length;
  return {
    n,
    d,
    pct: n ? Math.round(d / n * 100) : 0
  };
};
function buatUnit(rows) {
  const out = [];
  rows.forEach(r => {
    for (let i = 0; i < (Number(r.jumlah) || 0); i++) out.push({
      no: out.length + 1,
      lokasi: '',
      type: r.type,
      berat: r.berat,
      tekanan: '',
      kedaluwarsa: '',
      selang: '',
      handle: '',
      pin: '',
      ket: '',
      foto: []
    });
  });
  return out;
}
function resizeImage(file) {
  let max = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 900;
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve({
          name: file.name,
          dataUrl: c.toDataURL('image/jpeg', 0.6)
        });
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

// ================================================================== kamera + watermark dokumentasi
const waktuSekarang = () => new Date().toLocaleString('id-ID', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short'
});
// Gambar dari kamera diberi pita watermark: konsumen, teknisi, hari/tanggal/jam. Teks dibakar ke gambar (tidak bisa dihapus).
function bubuhkanWatermark(sumber, w, h, info) {
  const max = 1280,
    s = Math.min(1, max / Math.max(w, h));
  const W = Math.round(w * s),
    H = Math.round(h * s);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.drawImage(sumber, 0, 0, W, H);
  const fs = Math.max(13, Math.round(Math.min(W, H * 1.4) / 30)),
    lh = Math.round(fs * 1.38),
    pad = Math.round(fs * 0.75),
    judul = Math.round(fs * 0.72);
  const baris = [['Konsumen', info.konsumen], ['Teknisi', info.teknisi], ['Waktu', info.waktu]];
  if (info.keterangan) baris.push(['Ket.', info.keterangan]);
  const tinggi = pad * 2 + judul + Math.round(fs * 0.45) + lh * baris.length;
  g.fillStyle = 'rgba(0,0,0,0.58)';
  g.fillRect(0, H - tinggi, W, tinggi);
  g.fillStyle = '#dc2626';
  g.fillRect(0, H - tinggi, Math.max(4, Math.round(fs * 0.3)), tinggi);
  g.textBaseline = 'top';
  let y = H - tinggi + pad;
  const x = pad * 1.6,
    lebar = W - x - pad;
  g.font = `700 ${judul}px system-ui, -apple-system, Roboto, sans-serif`;
  g.fillStyle = '#fca5a5';
  g.fillText('PT NURI VIRA PRATAMA · VIOPRAN', x, y, lebar);
  y += judul + Math.round(fs * 0.45);
  baris.forEach(_ref => {
    let [k, v] = _ref;
    g.font = `600 ${fs}px system-ui, -apple-system, Roboto, sans-serif`;
    g.fillStyle = '#ffffff';
    g.fillText(`${k}: ${v || '-'}`, x, y, lebar);
    y += lh;
  });
  return c.toDataURL('image/jpeg', 0.68);
}
function muatGambar(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
function Kamera(_ref2) {
  let {
    info,
    onPakai,
    onTutup
  } = _ref2;
  const vid = useRef(null),
    stream = useRef(null),
    cadangan = useRef(null);
  const [arah, setArah] = useState('environment');
  const [siap, setSiap] = useState(false);
  const [gagal, setGagal] = useState('');
  const [hasil, setHasil] = useState(null);
  useEffect(() => {
    let batal = false;
    setSiap(false);
    (async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('tidak didukung');
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: {
              ideal: arah
            },
            width: {
              ideal: 1920
            },
            height: {
              ideal: 1080
            }
          },
          audio: false
        });
        if (batal) {
          s.getTracks().forEach(t => t.stop());
          return;
        }
        stream.current = s;
        vid.current.srcObject = s;
        await vid.current.play();
        setSiap(true);
        setGagal('');
      } catch (e) {
        setGagal('Kamera tidak bisa dibuka langsung di sini. Ketuk "Buka kamera HP" — foto tetap diberi watermark.');
      }
    })();
    return () => {
      batal = true;
      if (stream.current) stream.current.getTracks().forEach(t => t.stop());
      stream.current = null;
    };
  }, [arah]);
  const jepret = () => {
    const v = vid.current;
    if (!v || !v.videoWidth) return;
    setHasil({
      dataUrl: bubuhkanWatermark(v, v.videoWidth, v.videoHeight, {
        ...info,
        waktu: waktuSekarang()
      }),
      waktu: nowIso()
    });
  };
  const dariKameraHP = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const img = await muatGambar(f);
      setHasil({
        dataUrl: bubuhkanWatermark(img, img.naturalWidth, img.naturalHeight, {
          ...info,
          waktu: waktuSekarang()
        }),
        waktu: nowIso()
      });
    } catch (err) {
      setGagal('Foto tidak bisa dibaca.');
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-50 bg-black text-white flex flex-col",
    style: {
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between px-4 h-12 shrink-0"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onTutup,
    className: "text-sm font-bold"
  }, "Batal"), /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-bold text-slate-300"
  }, "Kamera dokumentasi"), !hasil && siap ? /*#__PURE__*/React.createElement("button", {
    onClick: () => setArah(arah === 'environment' ? 'user' : 'environment'),
    className: "text-sm font-bold"
  }, "Balik") : /*#__PURE__*/React.createElement("span", {
    className: "w-10"
  })), /*#__PURE__*/React.createElement("div", {
    className: "relative flex-1 min-h-0 bg-black"
  }, hasil ? /*#__PURE__*/React.createElement("img", {
    src: hasil.dataUrl,
    alt: "Hasil foto",
    className: "absolute inset-0 w-full h-full object-contain"
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("video", {
    ref: vid,
    playsInline: true,
    muted: true,
    className: "absolute inset-0 w-full h-full object-contain"
  }), siap && /*#__PURE__*/React.createElement("div", {
    className: "absolute left-0 right-0 bottom-0 bg-black/55 border-l-4 border-red-600 px-3 py-2 text-[12px] leading-snug pointer-events-none"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] font-bold text-red-300"
  }, "PT NURI VIRA PRATAMA \xB7 VIOPRAN"), /*#__PURE__*/React.createElement("div", null, "Konsumen: ", info.konsumen), /*#__PURE__*/React.createElement("div", null, "Teknisi: ", info.teknisi), /*#__PURE__*/React.createElement("div", null, "Waktu: tercatat saat foto diambil")), gagal && /*#__PURE__*/React.createElement("div", {
    className: "absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-300"
  }, gagal))), /*#__PURE__*/React.createElement("div", {
    className: "shrink-0 px-4 py-4 flex items-center justify-center gap-4"
  }, hasil ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: () => setHasil(null),
    className: "flex-1 py-3 rounded-2xl border border-white/30 font-bold"
  }, "Ulangi"), /*#__PURE__*/React.createElement("button", {
    onClick: () => onPakai(hasil),
    className: "flex-1 py-3 rounded-2xl bg-red-600 font-black"
  }, "Pakai foto")) : siap ? /*#__PURE__*/React.createElement("button", {
    "aria-label": "Ambil foto",
    onClick: jepret,
    className: "w-[72px] h-[72px] rounded-full border-4 border-white flex items-center justify-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-[56px] h-[56px] rounded-full bg-white"
  })) : gagal ? /*#__PURE__*/React.createElement("button", {
    onClick: () => cadangan.current && cadangan.current.click(),
    className: "w-full py-3 rounded-2xl bg-red-600 font-black"
  }, "Buka kamera HP") : /*#__PURE__*/React.createElement("span", {
    className: "text-sm text-slate-400"
  }, "Membuka kamera\u2026")), /*#__PURE__*/React.createElement("input", {
    ref: cadangan,
    type: "file",
    accept: "image/*",
    capture: "environment",
    className: "hidden",
    onChange: dariKameraHP
  }));
}

// Foto dokumentasi: hanya dari kamera, otomatis ber-watermark
function FotoKamera(_ref3) {
  let {
    label,
    list,
    setList,
    max = 6,
    info,
    syarat
  } = _ref3;
  const [buka, setBuka] = useState(false);
  const [pesan, setPesan] = useState('');
  const mulai = () => {
    if (syarat) {
      setPesan(syarat);
      return;
    }
    setPesan('');
    setBuka(true);
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-600 mb-1.5"
  }, label, " ", /*#__PURE__*/React.createElement("span", {
    className: "font-medium text-slate-400"
  }, "(kamera, maks. ", max, " foto, ber-watermark)")), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-3 gap-2"
  }, list.map((a, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "relative aspect-[4/3] rounded-xl overflow-hidden border border-slate-200 bg-slate-900"
  }, /*#__PURE__*/React.createElement(Foto, {
    f: a,
    className: "w-full h-full object-cover"
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Hapus foto",
    onClick: () => setList(list.filter((_, j) => j !== i)),
    className: "absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.x,
    size: 14
  })))), list.length < max && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: mulai,
    className: "aspect-[4/3] rounded-xl border-2 border-dashed border-red-300 text-red-600 flex flex-col items-center justify-center text-[11px] font-bold bg-red-50/40"
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.cam
  }), "Ambil foto")), pesan && /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-rose-600 font-semibold mt-1.5"
  }, pesan), buka && /*#__PURE__*/React.createElement(Kamera, {
    info: info,
    onTutup: () => setBuka(false),
    onPakai: h => {
      setList([...list, {
        name: `dok-${h.waktu.replace(/[:.]/g, '-')}.jpg`,
        dataUrl: h.dataUrl,
        waktu: h.waktu
      }].slice(0, max));
      setBuka(false);
    }
  }));
}

// ================================================================== server, cache & berkas
const KOSONG = {
  tugas: [],
  pekerjaan: [],
  aju: [],
  kasKeluar: [],
  notifs: [],
  users: []
};
async function api(payload) {
  if (!API_URL) throw new Error('API_URL belum diatur (config.js)');
  const res = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
function bacaCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || null;
  } catch (e) {
    return null;
  }
}
function bacaPref() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY)) || {};
  } catch (e) {
    return {};
  }
}
const salin = x => JSON.parse(JSON.stringify(x));
const gantiTmp = (x, idMap) => JSON.parse(JSON.stringify(x).replace(/tmp-[a-z0-9]+/g, m => idMap && idMap[m] || m));

// Gabungkan beberapa batch perubahan menjadi satu kiriman
function gabungBatch(list) {
  const out = {
    changes: {},
    notifs: [],
    dibaca: []
  };
  list.forEach(b => {
    Object.keys(b.changes || {}).forEach(col => {
      out.changes[col] = out.changes[col] || [];
      b.changes[col].forEach(rec => {
        const i = out.changes[col].findIndex(x => x.id === rec.id);
        if (i < 0) out.changes[col].push(rec);else out.changes[col][i] = {
          ...rec,
          _base: out.changes[col][i]._base
        };
      });
    });
    out.notifs = out.notifs.concat(b.notifs || []);
    out.dibaca = out.dibaca.concat(b.dibaca || []);
  });
  return out;
}
// Terapkan perubahan yang belum terkirim di atas data terbaru dari server
function terapkanAntrian(data, antrian) {
  const d = salin(data);
  antrian.forEach(b => {
    Object.keys(b.changes || {}).forEach(col => (b.changes[col] || []).forEach(rec => {
      const r = {
        ...rec
      };
      delete r._base;
      const i = d[col].findIndex(x => x.id === r.id);
      if (i >= 0) d[col][i] = {
        ...r,
        rev: d[col][i].rev
      };else d[col].unshift(r);
    }));
    (b.dibaca || []).forEach(id => {
      const n = d.notifs.find(x => x.id === id);
      if (n) n.read = true;
    });
  });
  return d;
}

// Foto & berkas dari Drive (lewat server), disimpan sementara di HP
const _berkas = new Map();
async function ambilBerkas(fileId) {
  if (_berkas.has(fileId)) return _berkas.get(fileId);
  const p = (async () => {
    const key = new Request('/__nvp_berkas/' + fileId);
    try {
      const c = await caches.open('nvp-ops-berkas');
      const hit = await c.match(key);
      if (hit) return URL.createObjectURL(await hit.blob());
    } catch (e) {}
    const r = await api({
      action: 'opsFile',
      token: TOKEN,
      fileId
    });
    if (!r.ok) throw new Error(r.error);
    const bin = atob(r.b64),
      arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], {
      type: r.mime
    });
    try {
      const c = await caches.open('nvp-ops-berkas');
      await c.put(key, new Response(blob));
    } catch (e) {}
    return URL.createObjectURL(blob);
  })();
  _berkas.set(fileId, p);
  p.catch(() => _berkas.delete(fileId));
  return p;
}
function Foto(_ref4) {
  let {
    f,
    className = '',
    alt = ''
  } = _ref4;
  const [src, setSrc] = useState(f && f.dataUrl ? f.dataUrl : '');
  const [gagal, setGagal] = useState(false);
  useEffect(() => {
    let hidup = true;
    if (f && f.dataUrl) setSrc(f.dataUrl);else if (f && f.fileId) ambilBerkas(f.fileId).then(u => {
      if (hidup) setSrc(u);
    }).catch(() => {
      if (hidup) setGagal(true);
    });
    return () => {
      hidup = false;
    };
  }, [f && (f.fileId || f.dataUrl)]);
  if (!src) return /*#__PURE__*/React.createElement("div", {
    className: `${className} bg-slate-200 flex items-center justify-center text-[10px] text-slate-500`
  }, gagal ? 'Foto belum bisa dimuat' : 'Memuat…');
  return /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: alt || f && f.name || '',
    className: className
  });
}
async function bukaBerkas(fileId, nama, setToast) {
  const w = window.open('', '_blank');
  try {
    if (setToast) setToast('Membuka PDF…');
    const url = await ambilBerkas(fileId);
    if (w) w.location.href = url;else {
      const a = document.createElement('a');
      a.href = url;
      a.download = nama || 'laporan.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } catch (e) {
    if (w) w.close();
    if (setToast) setToast('PDF belum bisa dibuka — periksa koneksi internet.');
  }
}

// Notifikasi HP: daftarkan perangkat ini ke server (Web Push)
const b64ToBytes = s => {
  const p = '='.repeat((4 - s.length % 4) % 4);
  const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};
const bytesToB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function daftarPush(sesi) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'tidak-didukung';
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return 'belum-izin';
  const reg = await navigator.serviceWorker.ready;
  const key = sesi.pushKey || (await api({
    action: 'opsPushKey'
  })).key;
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options && sub.options.applicationServerKey && bytesToB64(sub.options.applicationServerKey) !== key) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64ToBytes(key)
  });
  const r = await api({
    action: 'opsSubscribe',
    token: sesi.token,
    sub: sub.toJSON()
  });
  if (!r.ok) return 'gagal';
  const c = await caches.open('nvp-ops-meta');
  await c.put(new Request('/__nvp_meta'), new Response(JSON.stringify({
    api: API_URL,
    pushToken: r.pushToken,
    key
  })));
  return 'ok';
}
async function lepasPush(sesi) {
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    const sub = reg && reg.pushManager && (await reg.pushManager.getSubscription());
    await api({
      action: 'opsUnsubscribe',
      token: sesi.token,
      endpoint: sub ? sub.endpoint : '',
      logout: true
    });
    if (sub) await sub.unsubscribe();
    const c = await caches.open('nvp-ops-meta');
    await c.delete(new Request('/__nvp_meta'));
  } catch (e) {}
}

// ================================================================== ikon & komponen kecil
const Ico = _ref5 => {
  let {
    d,
    size = 20,
    className = ''
  } = _ref5;
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, d);
};
const I = {
  home: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M3 10.5 12 3l9 7.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5 9.5V21h14V9.5"
  })),
  clip: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "5",
    y: "4",
    width: "14",
    height: "17",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 4h6v3H9zM9 12l2 2 4-4"
  })),
  plus: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  })),
  wallet: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "6",
    width: "18",
    height: "14",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3 10h18M16 15h2"
  })),
  user: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "8",
    r: "4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M4 21a8 8 0 0 1 16 0"
  })),
  bell: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M10.3 21a1.9 1.9 0 0 0 3.4 0"
  })),
  back: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M15 18l-6-6 6-6"
  })),
  check: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  })),
  x: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  })),
  cam: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 7h3l2-3h6l2 3h3v13H4z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "13",
    r: "4"
  })),
  folder: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M3 6h6l2 2h10v11H3z"
  })),
  file: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M6 2h9l5 5v15H6z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M14 2v6h6"
  })),
  wrench: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"
  })),
  send: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M22 2 11 13"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M22 2 15 22l-4-9-9-4z"
  })),
  trash: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"
  })),
  cash: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "2",
    y: "6",
    width: "20",
    height: "12",
    rx: "2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  })),
  chev: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M9 18l6-6-6-6"
  })),
  inbox: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M22 12h-6l-2 3h-4l-2-3H2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5.5 5h13L22 12v7H2v-7z"
  })),
  history: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M3 3v5h5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3.05 13A9 9 0 1 0 6 5.3L3 8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 7v5l3 3"
  })),
  calendar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "4",
    width: "18",
    height: "18",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 2v4M8 2v4M3 10h18"
  })),
  approve: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M9 11l3 3L22 4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
  })),
  help: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 17h.01"
  })),
  alert: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 9v4M12 17h.01"
  })),
  team: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "7",
    r: "4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M2 21a7 7 0 0 1 14 0"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4-6.3"
  }))
};
const Badge = _ref6 => {
  let {
    map,
    status
  } = _ref6;
  const s = map[status] || ['?', 'slate'];
  return /*#__PURE__*/React.createElement("span", {
    className: `inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${TONE[s[1]]}`
  }, s[0]);
};
const Kosong = _ref7 => {
  let {
    teks
  } = _ref7;
  return /*#__PURE__*/React.createElement("div", {
    className: "bg-white/60 border border-dashed border-slate-300 rounded-2xl p-6 text-center text-sm text-slate-500"
  }, teks);
};
const Seksi = _ref8 => {
  let {
    judul,
    children,
    aksi
  } = _ref8;
  return /*#__PURE__*/React.createElement("section", {
    className: "bg-white rounded-2xl border border-slate-200 p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-2"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "text-xs font-black uppercase tracking-widest text-slate-500"
  }, judul), aksi), children);
};
const Baris = _ref9 => {
  let {
    k,
    v
  } = _ref9;
  return /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between gap-4 py-1.5 text-sm border-b border-slate-100 last:border-0"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-500 shrink-0"
  }, k), /*#__PURE__*/React.createElement("span", {
    className: "text-right font-semibold break-words min-w-0"
  }, v));
};
const Bar = _ref10 => {
  let {
    pct,
    tone = 'bg-red-600'
  } = _ref10;
  return /*#__PURE__*/React.createElement("div", {
    className: "h-2 rounded-full bg-slate-200 overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: `h-2 rounded-full ${pct === 100 ? 'bg-emerald-500' : tone}`,
    style: {
      width: `${pct}%`
    }
  }));
};
const Kembali = _ref11 => {
  let {
    onClick,
    teks = 'Kembali'
  } = _ref11;
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    className: "inline-flex items-center gap-2 pl-1.5 pr-3.5 py-1.5 rounded-full bg-white border border-slate-200 text-sm font-bold text-slate-600 shadow-sm active:bg-slate-50"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center"
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.back,
    size: 16
  })), teks);
};
const inp = 'w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-red-500';
const Lab = _ref12 => {
  let {
    t,
    hint,
    children
  } = _ref12;
  return /*#__PURE__*/React.createElement("label", {
    className: "block"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-bold text-slate-600"
  }, t), hint && /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] text-slate-400"
  }, " \u2014 ", hint), /*#__PURE__*/React.createElement("div", {
    className: "mt-1"
  }, children));
};
const btnUtama = 'w-full py-3.5 rounded-2xl bg-red-600 text-white font-black flex items-center justify-center gap-2 disabled:opacity-40';
const btnGaris = 'w-full py-3 rounded-2xl border border-slate-300 text-slate-700 font-bold text-sm';
function Segmen(_ref13) {
  let {
    value,
    options,
    onChange,
    label
  } = _ref13;
  return /*#__PURE__*/React.createElement("div", {
    role: "group",
    "aria-label": label,
    className: "flex flex-wrap gap-1.5"
  }, options.map(o => {
    const on = value === o,
      buruk = !['Normal', 'Baik', 'Ada & tersegel'].includes(o);
    return /*#__PURE__*/React.createElement("button", {
      key: o,
      type: "button",
      onClick: () => onChange(o),
      className: `px-3 py-2 rounded-lg text-xs font-bold border ${on ? buruk ? 'bg-rose-600 text-white border-rose-600' : 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200'}`
    }, o);
  }));
}
function FotoInput(_ref14) {
  let {
    label,
    list,
    setList,
    max = 6
  } = _ref14;
  const ref = useRef(null);
  const pilih = async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const hasil = [];
    for (const f of files.slice(0, max)) {
      try {
        hasil.push(await resizeImage(f));
      } catch (err) {}
    }
    setList([...list, ...hasil].slice(0, max));
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-600 mb-1.5"
  }, label, " ", /*#__PURE__*/React.createElement("span", {
    className: "font-medium text-slate-400"
  }, "(maks. ", max, " foto)")), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-4 gap-2"
  }, list.map((a, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "relative aspect-square rounded-xl overflow-hidden border border-slate-200"
  }, /*#__PURE__*/React.createElement(Foto, {
    f: a,
    className: "w-full h-full object-cover"
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Hapus foto",
    onClick: () => setList(list.filter((_, j) => j !== i)),
    className: "absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.x,
    size: 14
  })))), list.length < max && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => ref.current && ref.current.click(),
    className: "aspect-square rounded-xl border-2 border-dashed border-slate-300 text-slate-500 flex flex-col items-center justify-center text-[11px] font-bold"
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.cam
  }), "Foto")), /*#__PURE__*/React.createElement("input", {
    ref: ref,
    type: "file",
    accept: "image/*",
    capture: "environment",
    multiple: true,
    className: "hidden",
    onChange: pilih
  }));
}
function BarisApar(_ref15) {
  let {
    rows,
    setRows
  } = _ref15;
  const set = (i, k, v) => setRows(rows.map((r, j) => j === i ? {
    ...r,
    [k]: v
  } : r));
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-2.5"
  }, rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "bg-slate-50 rounded-xl p-2.5 space-y-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex gap-2"
  }, /*#__PURE__*/React.createElement("select", {
    "aria-label": `Type APAR ${i + 1}`,
    value: r.type,
    onChange: e => set(i, 'type', e.target.value),
    className: inp
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u2014 Type APAR \u2014"), TYPE_APAR.map(t => /*#__PURE__*/React.createElement("option", {
    key: t
  }, t))), rows.length > 1 && /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Hapus baris",
    onClick: () => setRows(rows.filter((_, j) => j !== i)),
    className: "px-2 text-slate-400"
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.trash,
    size: 18
  }))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-[1fr_96px] gap-2"
  }, /*#__PURE__*/React.createElement("select", {
    "aria-label": `Berat ${i + 1}`,
    value: r.berat,
    onChange: e => set(i, 'berat', e.target.value),
    className: inp
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u2014 Berat \u2014"), BERAT_APAR.map(b => /*#__PURE__*/React.createElement("option", {
    key: b
  }, b))), /*#__PURE__*/React.createElement("input", {
    "aria-label": `Jumlah ${i + 1}`,
    type: "number",
    inputMode: "numeric",
    min: "1",
    value: r.jumlah,
    onChange: e => set(i, 'jumlah', e.target.value),
    placeholder: "Jumlah",
    className: inp
  })))), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => setRows([...rows, {
      type: '',
      berat: '',
      jumlah: ''
    }]),
    className: "text-sm font-bold text-red-600"
  }, "+ Tambah type/berat lain"));
}

// ================================================================== App
function App() {
  const cache0 = useRef(bacaCache()).current || {};
  const [sesi, setSesi] = useState(cache0.sesi || null);
  const [st, setSt] = useState(cache0.data || KOSONG);
  const [pref, setPref] = useState(bacaPref);
  const [sinkron, setSinkron] = useState({
    status: 'ok',
    antri: (cache0.antrian || []).length
  });
  const [view, setView] = useState({
    name: 'home'
  });
  const [laporan, setLaporan] = useState(null);
  const [toast, setToast] = useState('');
  const [installEvt, setInstallEvt] = useState(null);
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const dataRef = useRef(st),
    sesiRef = useRef(sesi),
    antriRef = useRef(cache0.antrian || []),
    sibukRef = useRef(false),
    ulangRef = useRef(null);
  dataRef.current = st;
  sesiRef.current = sesi;
  USERS = st.users || [];
  TOKEN = sesi ? sesi.token : '';
  const me = sesi ? {
    ...sesi.user,
    id: sesi.user.username
  } : null;
  const simpanCache = () => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        sesi: sesiRef.current,
        data: dataRef.current,
        antrian: antriRef.current
      }));
    } catch (e) {
      setToast('Memori HP penuh — sambungkan internet agar foto segera terkirim.');
    }
  };
  useEffect(simpanCache, [st, sesi, sinkron]);
  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(pref));
    } catch (e) {}
  }, [pref]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const go = (name, extra) => {
    setView({
      name,
      ...(extra || {})
    });
    if (location.hash) history.replaceState(null, '', location.pathname);
    window.scrollTo(0, 0);
  };

  // ---- kirim antrian perubahan ke server & ambil data terbaru
  const kirim = async paksa => {
    if (sibukRef.current || !sesiRef.current) return;
    if (!antriRef.current.length && !paksa) return;
    sibukRef.current = true;
    const batch = antriRef.current.splice(0);
    setSinkron({
      status: 'sync',
      antri: batch.length
    });
    try {
      const r = await api({
        action: 'opsSync',
        token: sesiRef.current.token,
        ...gabungBatch(batch)
      });
      if (!r.ok) {
        if (r.error === 'AUTH') {
          antriRef.current = batch.concat(antriRef.current);
          keluarPaksa();
          return;
        }
        throw new Error(r.error || 'respon tidak valid');
      }
      const idMap = r.idMap || {};
      antriRef.current = antriRef.current.map(b => gantiTmp(b, idMap));
      const data = terapkanAntrian(r.data, antriRef.current);
      dataRef.current = data;
      setSt(data);
      setView(v => v.id && idMap[v.id] ? {
        ...v,
        id: idMap[v.id]
      } : v.dari && idMap[v.dari] ? {
        ...v,
        dari: idMap[v.dari]
      } : v);
      if (r.conflicts && r.conflicts.length) setToast(r.conflicts[0].pesan);
      setSinkron({
        status: 'ok',
        antri: antriRef.current.length,
        waktu: Date.now()
      });
    } catch (e) {
      antriRef.current = batch.concat(antriRef.current);
      setSinkron({
        status: 'offline',
        antri: antriRef.current.length
      });
      clearTimeout(ulangRef.current);
      ulangRef.current = setTimeout(() => kirim(true), 20000);
    } finally {
      sibukRef.current = false;
      if (antriRef.current.length && sinkronOk()) setTimeout(() => kirim(), 200);
    }
  };
  const sinkronOk = () => navigator.onLine !== false;
  useEffect(() => {
    const onPrompt = e => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    const openHash = () => {
      const m = /^#\/(tugas|aju|pekerjaan)\/(.+)$/.exec(location.hash);
      if (m) setView({
        name: m[1],
        id: decodeURIComponent(m[2])
      });
    };
    openHash();
    window.addEventListener('hashchange', openHash);
    const onMsg = e => {
      if (e.data && e.data.type === 'refresh') kirim(true);
      if (e.data && e.data.open) {
        const h = e.data.open.replace(/^.*#/, '#');
        if (location.hash !== h) location.hash = h;else openHash();
        kirim(true);
      }
    };
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', onMsg);
    const onOnline = () => kirim(true);
    const onVis = () => {
      if (document.visibilityState === 'visible') kirim(true);
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVis);
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') kirim(true);
    }, 45000);
    if (sesiRef.current) {
      kirim(true);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') daftarPush(sesiRef.current).catch(() => {});
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('hashchange', openHash);
      if (navigator.serviceWorker) navigator.serviceWorker.removeEventListener('message', onMsg);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(iv);
    };
  }, []);

  // ---- ubah data: langsung tampil di HP, lalu dikirim ke server
  const ubah = (fn, pesan) => {
    const prev = dataRef.current;
    const d = salin(prev);
    const n = fn(d) || [];
    const changes = {};
    ['tugas', 'pekerjaan', 'aju'].forEach(col => {
      const lama = new Map(prev[col].map(x => [x.id, x]));
      const out = d[col].filter(x => JSON.stringify(lama.get(x.id)) !== JSON.stringify(x)).map(x => ({
        ...x,
        _base: (lama.get(x.id) || {}).rev || 0
      }));
      if (out.length) changes[col] = out;
    });
    antriRef.current.push({
      changes,
      notifs: n.map(x => ({
        ...x,
        dari: me.id
      })),
      dibaca: []
    });
    dataRef.current = d;
    setSt(d);
    setSinkron(sv => ({
      ...sv,
      antri: antriRef.current.length
    }));
    kirim();
    if (pesan) setToast(pesan);
  };
  const tandaiDibaca = ids => {
    if (!ids.length) return;
    antriRef.current.push({
      changes: {},
      notifs: [],
      dibaca: ids
    });
    const d = {
      ...dataRef.current,
      notifs: dataRef.current.notifs.map(x => ids.includes(x.id) ? {
        ...x,
        read: true
      } : x)
    };
    dataRef.current = d;
    setSt(d);
    kirim();
  };
  const log = (obj, action, note) => {
    obj.history = [...(obj.history || []), {
      t: nowIso(),
      by: me.id,
      action,
      note: note || ''
    }];
  };

  // ---------------- aksi: pekerjaan refilling/pengadaan (Teknisi)
  const simpanPekerjaan = f => ubah(d => {
    const id = tmpId();
    d.pekerjaan.unshift({
      ...f,
      id,
      teknisiId: me.id,
      createdAt: nowIso(),
      taskId: null
    });
    setTimeout(() => go('pekerjaan', {
      id
    }), 0);
    const jml = sum(f.rows, x => x.jumlah);
    return [{
      toRole: 'manager',
      title: `Pekerjaan ${f.jenis.toLowerCase()} baru`,
      body: `${me.name}: ${f.konsumen} · ${jml} APAR — siap dijadwalkan pemeriksaan`,
      link: 'pekerjaan/' + id
    }];
  }, 'Laporan kerja dikirim — PDF dokumentasi dibuat otomatis di Drive');

  // ---------------- aksi: tugas pemeriksaan
  const simpanTugas = f => ubah(d => {
    const id = tmpId();
    d.tugas.unshift({
      ...f,
      id,
      status: 'baru',
      dibuatOleh: me.id,
      history: [{
        t: nowIso(),
        by: me.id,
        action: f.sumber ? 'Tugas dibuat dari ' + f.sumber : 'Tugas dibuat',
        note: ''
      }]
    });
    if (f.sumber) {
      const p = d.pekerjaan.find(x => x.id === f.sumber);
      if (p) p.taskId = id;
    }
    setTimeout(() => go('tugas', {
      id
    }), 0);
    return f.teknisiIds.map(tid => ({
      toRole: 'teknisi',
      toUser: tid,
      title: 'Tugas pemeriksaan baru',
      body: `${f.tempat} · ${f.jumlah} APAR · mulai ${fmtDate(f.tglMulai)}`,
      link: 'tugas/' + id
    }));
  }, 'Tugas dikirim ke teknisi');
  const terimaTugas = id => ubah(d => {
    const t = d.tugas.find(x => x.id === id);
    t.status = 'dikerjakan';
    log(t, 'Tugas diterima');
    return [{
      toRole: 'manager',
      title: 'Tugas diterima',
      body: `${me.name}: ${t.tempat}`,
      link: 'tugas/' + id
    }];
  }, 'Tugas diterima');
  const simpanUnit = (id, idx, unit) => ubah(d => {
    const t = d.tugas.find(x => x.id === id);
    t.units[idx] = {
      ...unit,
      t: Date.now(),
      by: me.id
    };
    return [];
  });
  const selesaiTugas = id => ubah(d => {
    const t = d.tugas.find(x => x.id === id);
    t.status = 'selesai';
    t.selesaiAt = nowIso();
    const lay = t.units.filter(unitLayak).length;
    log(t, 'Pemeriksaan selesai, laporan PDF dibuat', `${lay} layak, ${t.units.length - lay} tidak layak`);
    const body = `${t.tempat}: ${lay} layak, ${t.units.length - lay} tidak layak — PDF tersimpan di Drive`;
    return [{
      toRole: 'manager',
      title: 'Pemeriksaan selesai',
      body,
      link: 'tugas/' + id
    }, {
      toRole: 'direktur',
      title: 'Pemeriksaan selesai',
      body,
      link: 'tugas/' + id
    }];
  }, 'Pemeriksaan selesai — laporan PDF dibuat di Drive');

  // ---------------- aksi: pengajuan gaji / pembayaran
  const simpanAju = (f, editId) => ubah(d => {
    const total = sum(f.rincian, r => r.jumlah);
    if (editId) {
      const a = d.aju.find(x => x.id === editId);
      Object.assign(a, f, {
        total,
        status: me.role === 'teknisi' ? 'cek_manager' : 'menunggu_direktur'
      });
      log(a, 'Direvisi & diajukan ulang');
      setTimeout(() => go('aju', {
        id: editId
      }), 0);
      return [me.role === 'teknisi' ? {
        toRole: 'manager',
        title: 'Revisi pengajuan gaji',
        body: `${me.name} · ${fmt(total)}`,
        link: 'aju/' + editId
      } : {
        toRole: 'direktur',
        title: 'Revisi pengajuan pembayaran',
        body: `${a.keperluan} · ${fmt(total)}`,
        link: 'aju/' + editId
      }];
    }
    const id = tmpId();
    const a = {
      ...f,
      id,
      total,
      pemohonId: me.id,
      createdAt: nowIso(),
      status: me.role === 'teknisi' ? 'cek_manager' : 'menunggu_direktur',
      history: [{
        t: nowIso(),
        by: me.id,
        action: f.jenis === 'gaji' ? 'Mengajukan gaji' : 'Mengajukan pembayaran',
        note: ''
      }]
    };
    d.aju.unshift(a);
    setTimeout(() => go('aju', {
      id
    }), 0);
    if (me.role === 'teknisi') return [{
      toRole: 'manager',
      title: 'Pengajuan gaji perlu diperiksa',
      body: `${me.name} · ${a.keperluan} · ${fmt(total)}`,
      link: 'aju/' + id
    }];
    return [{
      toRole: 'direktur',
      title: 'Pengajuan pembayaran baru',
      body: `${a.keperluan} · ${fmt(total)}`,
      link: 'aju/' + id
    }];
  }, 'Pengajuan terkirim');
  const teruskan = (id, note) => ubah(d => {
    const a = d.aju.find(x => x.id === id);
    a.status = 'menunggu_direktur';
    log(a, 'Diperiksa Manager, diteruskan ke Direktur', note);
    return [{
      toRole: 'direktur',
      title: 'Pengajuan gaji menunggu pembayaran',
      body: `${userById(a.pemohonId).name} · ${a.keperluan} · ${fmt(a.total)}`,
      link: 'aju/' + id
    }, {
      toRole: 'teknisi',
      toUser: a.pemohonId,
      title: 'Gaji diteruskan ke Direktur',
      body: a.keperluan,
      link: 'aju/' + id
    }];
  }, 'Diteruskan ke Direktur');
  const kembalikan = (id, note) => ubah(d => {
    const a = d.aju.find(x => x.id === id);
    a.status = 'dikembalikan';
    log(a, `Dikembalikan ${ROLES[me.role]}`, note);
    return [{
      toRole: userById(a.pemohonId).role,
      toUser: a.pemohonId,
      title: 'Pengajuan dikembalikan',
      body: `${a.keperluan}: ${note}`,
      link: 'aju/' + id
    }];
  }, 'Dikembalikan ke pemohon');
  const tolak = (id, note) => ubah(d => {
    const a = d.aju.find(x => x.id === id);
    a.status = 'ditolak';
    log(a, 'Ditolak Direktur', note);
    const n = [{
      toRole: userById(a.pemohonId).role,
      toUser: a.pemohonId,
      title: 'Pengajuan ditolak',
      body: `${a.keperluan}: ${note}`,
      link: 'aju/' + id
    }];
    if (userById(a.pemohonId).role !== 'manager') n.push({
      toRole: 'manager',
      title: 'Pengajuan ditolak Direktur',
      body: `${a.keperluan}: ${note}`,
      link: 'aju/' + id
    });
    return n;
  }, 'Pengajuan ditolak');
  const bayar = (id, b) => ubah(d => {
    const a = d.aju.find(x => x.id === id);
    a.status = 'dibayar';
    a.bayar = b;
    log(a, 'Dibayar Direktur', `${b.metode}${b.ref ? ' · ref ' + b.ref : ''}`);
    const n = [{
      toRole: userById(a.pemohonId).role,
      toUser: a.pemohonId,
      title: 'Pembayaran sudah dilakukan',
      body: `${a.keperluan} · ${fmt(a.total)}`,
      link: 'aju/' + id
    }];
    if (userById(a.pemohonId).role !== 'manager') n.push({
      toRole: 'manager',
      title: 'Pengajuan dibayar',
      body: `${a.keperluan} · ${fmt(a.total)}`,
      link: 'aju/' + id
    });
    return n;
  }, 'Dibayar — otomatis tercatat di Kas Keluar & Pengeluaran portal');
  const ingatkanDirektur = () => {
    const tunggu = st.aju.filter(a => a.status === 'menunggu_direktur');
    if (!tunggu.length) {
      setToast('Tidak ada pengajuan yang menunggu Direktur.');
      return;
    }
    ubah(() => [{
      toRole: 'direktur',
      title: `Pengingat: ${tunggu.length} pengajuan menunggu pembayaran`,
      body: `Total ${fmt(sum(tunggu, a => a.total))} — mohon segera ditindaklanjuti (dari ${me.name})`,
      link: 'aju/' + tunggu[0].id
    }], 'Pengingat dikirim ke HP Direktur');
  };

  // ---------------- masuk / keluar
  const masuk = async (username, password) => {
    let r;
    try {
      r = await api({
        action: 'opsLogin',
        username,
        password
      });
    } catch (e) {
      return 'Tidak dapat terhubung ke server. Periksa koneksi internet.';
    }
    if (!r.ok) return r.error === 'AUTH' ? 'Username atau password salah.' : r.error === 'BUKAN_AKUN_APLIKASI' ? 'Akun ini untuk portal keuangan di website, bukan untuk aplikasi.' : 'Server: ' + r.error;
    const s2 = {
      token: r.token,
      user: r.user,
      pushKey: r.pushKey
    };
    antriRef.current = [];
    sesiRef.current = s2;
    dataRef.current = r.data;
    setSesi(s2);
    setSt(r.data);
    setView({
      name: 'home'
    });
    setSinkron({
      status: 'ok',
      antri: 0,
      waktu: Date.now()
    });
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') daftarPush(s2).catch(() => {});
    return '';
  };
  const bersihkan = () => {
    antriRef.current = [];
    sesiRef.current = null;
    dataRef.current = KOSONG;
    setSesi(null);
    setSt(KOSONG);
    setView({
      name: 'home'
    });
    try {
      caches.delete('nvp-ops-berkas');
    } catch (e) {}
    _berkas.clear();
    if (location.hash) history.replaceState(null, '', location.pathname);
  };
  const keluar = async () => {
    if (sesiRef.current) await lepasPush(sesiRef.current);
    bersihkan();
  };
  const keluarPaksa = () => {
    setToast('Sesi berakhir (password diganti atau akun dihapus). Silakan masuk lagi.');
    bersihkan();
  };
  if (!me) return /*#__PURE__*/React.createElement(Login, {
    onMasuk: masuk
  });
  if (laporan) return /*#__PURE__*/React.createElement(Laporan, {
    doc: laporan,
    st: st,
    onTutup: () => setLaporan(null)
  });
  const notifSaya = (st.notifs || []).filter(n => n.toRole === me.role && (!n.toUser || n.toUser === me.id));
  const belumDibaca = notifSaya.filter(n => !n.read).length;
  const pasang = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    try {
      await installEvt.userChoice;
    } catch (e) {}
    setInstallEvt(null);
  };
  const mintaIzin = async () => {
    if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) {
      setToast('HP/browser ini belum mendukung notifikasi. Di iPhone, pasang aplikasi ke Layar Utama dulu.');
      return;
    }
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p !== 'granted') {
      setToast('Notifikasi tidak diizinkan.');
      return;
    }
    try {
      const h = await daftarPush(sesiRef.current);
      setToast(h === 'ok' ? 'Notifikasi HP aktif — muncul juga saat layar terkunci' : 'Notifikasi belum bisa didaftarkan (' + h + ').');
    } catch (e) {
      setToast('Gagal mendaftarkan notifikasi: ' + e.message);
    }
  };
  const tesNotif = async () => {
    try {
      if (Notification.permission !== 'granted') {
        await mintaIzin();
      }
      const r = await api({
        action: 'opsTestPush',
        token: sesiRef.current.token
      });
      setToast(r.ok ? r.devices ? `Notifikasi uji dikirim ke ${r.devices} perangkat — kunci layar HP untuk melihatnya` : 'Belum ada HP terdaftar untuk akun ini — tekan Izinkan notifikasi dulu' : 'Gagal: ' + r.error);
    } catch (e) {
      setToast('Tidak dapat terhubung ke server.');
    }
  };
  const panduanTampil = !(pref.panduanTutup || {})[me.id];
  const tutupPanduan = () => setPref(p2 => ({
    ...p2,
    panduanTutup: {
      ...(p2.panduanTutup || {}),
      [me.id]: true
    }
  }));
  const ctx = {
    sinkron,
    kirim,
    tesNotif,
    panduanTampil,
    tutupPanduan,
    st,
    me,
    go,
    setLaporan,
    setToast,
    simpanPekerjaan,
    simpanTugas,
    terimaTugas,
    simpanUnit,
    selesaiTugas,
    simpanAju,
    teruskan,
    kembalikan,
    tolak,
    bayar,
    ingatkanDirektur,
    perm,
    mintaIzin,
    installEvt,
    pasang
  };
  let body;
  const v = view.name;
  if (v === 'tugas' && view.id) body = /*#__PURE__*/React.createElement(DetailTugas, {
    ctx: ctx,
    id: view.id
  });else if (v === 'tugas') body = /*#__PURE__*/React.createElement(DaftarTugas, {
    ctx: ctx
  });else if (v === 'buatTugas') body = /*#__PURE__*/React.createElement(FormTugas, {
    ctx: ctx,
    dari: view.dari
  });else if (v === 'pekerjaan' && view.id) body = /*#__PURE__*/React.createElement(DetailPekerjaan, {
    ctx: ctx,
    id: view.id
  });else if (v === 'pekerjaan') body = /*#__PURE__*/React.createElement(DaftarPekerjaan, {
    ctx: ctx
  });else if (v === 'uploadPekerjaan') body = /*#__PURE__*/React.createElement(FormPekerjaan, {
    ctx: ctx
  });else if (v === 'aju' && view.id) body = /*#__PURE__*/React.createElement(DetailAju, {
    ctx: ctx,
    id: view.id
  });else if (v === 'aju') body = /*#__PURE__*/React.createElement(DaftarAju, {
    ctx: ctx
  });else if (v === 'formAju') body = /*#__PURE__*/React.createElement(FormAju, {
    ctx: ctx,
    jenis: view.jenis,
    editId: view.editId
  });else if (v === 'kas') body = /*#__PURE__*/React.createElement(KasKeluar, {
    ctx: ctx
  });else if (v === 'arsip') body = /*#__PURE__*/React.createElement(Arsip, {
    ctx: ctx
  });else if (v === 'notif') body = /*#__PURE__*/React.createElement(Notifikasi, {
    list: notifSaya,
    buka: n => {
      if (!n.read) tandaiDibaca([n.id]);
      const m = /^(tugas|aju|pekerjaan)\/(.+)$/.exec(n.link || '');
      if (m) go(m[1], {
        id: m[2]
      });
    },
    bacaSemua: () => tandaiDibaca(notifSaya.filter(x => !x.read).map(x => x.id))
  });else if (v === 'profil') body = /*#__PURE__*/React.createElement(Profil, {
    ctx: ctx,
    keluar: keluar
  });else body = me.role === 'teknisi' ? /*#__PURE__*/React.createElement(BerandaTeknisi, {
    ctx: ctx
  }) : me.role === 'manager' ? /*#__PURE__*/React.createElement(BerandaManager, {
    ctx: ctx
  }) : /*#__PURE__*/React.createElement(BerandaDirektur, {
    ctx: ctx
  });
  const NAV = {
    teknisi: [['home', 'Beranda', I.home], ['tugas', 'Tugas Saya', I.clip], ['uploadPekerjaan', 'Lapor Kerja', I.plus, true], ['aju', 'Gaji', I.wallet], ['profil', 'Akun', I.user]],
    manager: [['home', 'Beranda', I.home], ['tugas', 'Pemeriksaan', I.clip], ['buatTugas', 'Buat Tugas', I.plus, true], ['aju', 'Persetujuan', I.approve], ['profil', 'Akun', I.user]],
    direktur: [['home', 'Beranda', I.home], ['aju', 'Pembayaran', I.wallet], ['tugas', 'Pemeriksaan', I.clip], ['kas', 'Kas Keluar', I.cash], ['profil', 'Akun', I.user]]
  }[me.role];
  const JUDUL = {
    home: 'Beranda',
    tugas: view.id ? 'Detail pemeriksaan' : me.role === 'teknisi' ? 'Tugas Saya' : 'Pemeriksaan',
    buatTugas: 'Buat Tugas',
    pekerjaan: view.id ? 'Detail pekerjaan' : me.role === 'teknisi' ? 'Riwayat Kerja' : 'Pekerjaan Teknisi',
    uploadPekerjaan: 'Lapor Kerja',
    aju: view.id ? 'Detail pengajuan' : {
      teknisi: 'Pengajuan Gaji',
      manager: 'Persetujuan',
      direktur: 'Pembayaran'
    }[me.role],
    formAju: 'Formulir pengajuan',
    kas: 'Kas Keluar',
    arsip: 'Arsip PDF',
    notif: 'Notifikasi',
    profil: 'Akun Saya'
  };
  const tunggu = me.role === 'direktur' ? st.aju.filter(a => a.status === 'menunggu_direktur').length : 0;
  return /*#__PURE__*/React.createElement("div", {
    className: "min-h-screen bg-slate-100 text-slate-800"
  }, /*#__PURE__*/React.createElement("header", {
    className: "sticky top-0 z-30 bg-ink text-white",
    style: {
      paddingTop: 'env(safe-area-inset-top)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "max-w-lg mx-auto flex items-center justify-between px-4 h-14"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => go('home'),
    className: "flex items-center gap-2.5 text-left"
  }, /*#__PURE__*/React.createElement("img", {
    src: "icons/icon-192.png",
    alt: "",
    className: "w-8 h-8 rounded-lg"
  }), /*#__PURE__*/React.createElement("div", {
    className: "leading-tight"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[15px] font-black"
  }, JUDUL[v] || 'NVP Operasional'), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-red-300"
  }, ROLES[me.role]), sinkron.status === 'sync' ? /*#__PURE__*/React.createElement("span", {
    className: "text-amber-300 normal-case tracking-normal"
  }, "\xB7 menyimpan\u2026") : sinkron.antri > 0 ? /*#__PURE__*/React.createElement("span", {
    className: "text-amber-300 normal-case tracking-normal"
  }, "\xB7 ", sinkron.antri, " belum terkirim") : null))), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => go('notif'),
    "aria-label": "Notifikasi",
    className: "relative p-2 rounded-full hover:bg-white/10"
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.bell,
    size: 22
  }), belumDibaca > 0 && /*#__PURE__*/React.createElement("span", {
    className: "absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] leading-[18px] text-center font-bold"
  }, belumDibaca)), /*#__PURE__*/React.createElement("button", {
    onClick: () => go('profil'),
    className: "w-8 h-8 rounded-full bg-red-600 font-black text-sm"
  }, me.name[0]))), /*#__PURE__*/React.createElement("div", {
    className: "hazard h-1"
  })), /*#__PURE__*/React.createElement("main", {
    className: "max-w-lg mx-auto px-4 pt-4 pb-28"
  }, body), /*#__PURE__*/React.createElement("nav", {
    className: "fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200",
    style: {
      paddingBottom: 'env(safe-area-inset-bottom)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "max-w-lg mx-auto grid grid-cols-5"
  }, NAV.map(_ref16 => {
    let [k, l, ic, fab] = _ref16;
    const aktif = v === k || k === 'aju' && v === 'formAju' || k === 'tugas' && me.role !== 'teknisi' && v === 'buatTugas' && !NAV.some(n => n[0] === 'buatTugas');
    if (fab) return /*#__PURE__*/React.createElement("button", {
      key: k,
      "aria-label": l,
      onClick: () => go(k),
      className: "flex flex-col items-center justify-center -mt-5"
    }, /*#__PURE__*/React.createElement("span", {
      className: "w-14 h-14 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg shadow-red-600/30 border-4 border-white"
    }, /*#__PURE__*/React.createElement(Ico, {
      d: ic,
      size: 26
    })), /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] font-bold text-slate-700 mt-0.5 whitespace-nowrap"
    }, l));
    return /*#__PURE__*/React.createElement("button", {
      key: k,
      onClick: () => go(k),
      "aria-current": aktif ? 'page' : undefined,
      className: `relative flex flex-col items-center justify-center pt-2 pb-2.5 text-[10px] font-bold ${aktif ? 'text-red-700' : 'text-slate-500'}`
    }, /*#__PURE__*/React.createElement("span", {
      className: `w-12 h-7 rounded-full flex items-center justify-center ${aktif ? 'bg-red-100' : ''}`
    }, /*#__PURE__*/React.createElement(Ico, {
      d: ic,
      size: 21
    })), /*#__PURE__*/React.createElement("span", {
      className: "mt-0.5 whitespace-nowrap"
    }, l), k === 'aju' && tunggu > 0 && /*#__PURE__*/React.createElement("span", {
      className: "absolute top-1.5 right-[20%] min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] leading-[18px] text-center"
    }, tunggu));
  }))), toast && /*#__PURE__*/React.createElement("div", {
    role: "status",
    className: "fixed left-1/2 -translate-x-1/2 bottom-24 z-40 bg-slate-900 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-xl max-w-[90vw] text-center"
  }, toast));
}

// ================================================================== masuk
function Login(_ref17) {
  let {
    onMasuk
  } = _ref17;
  const [f, setF] = useState({
    username: '',
    password: ''
  });
  const [err, setErr] = useState('');
  const [lihat, setLihat] = useState(false);
  const [proses, setProses] = useState(false);
  const kirim = async e => {
    e.preventDefault();
    if (!f.username.trim() || !f.password) {
      setErr('Isi username dan password.');
      return;
    }
    setErr('');
    setProses(true);
    const pesan = await onMasuk(f.username.trim().toLowerCase(), f.password);
    setProses(false);
    if (pesan) setErr(pesan);
  };
  const fi = 'w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-red-500';
  return /*#__PURE__*/React.createElement("div", {
    className: "min-h-screen bg-ink text-white flex flex-col"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hazard h-1.5"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 max-w-sm w-full mx-auto px-5 py-12"
  }, /*#__PURE__*/React.createElement("img", {
    src: "icons/icon-192.png",
    alt: "",
    className: "w-16 h-16 rounded-2xl"
  }), /*#__PURE__*/React.createElement("h1", {
    className: "text-3xl font-black mt-5 leading-tight"
  }, "NVP Operasional"), /*#__PURE__*/React.createElement("p", {
    className: "text-slate-400 mt-1 text-sm"
  }, "PT Nuri Vira Pratama \xB7 Viopran Fire Extinguisher"), /*#__PURE__*/React.createElement("form", {
    onSubmit: kirim,
    className: "mt-8 space-y-3"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-bold text-slate-300"
  }, "Username"), /*#__PURE__*/React.createElement("input", {
    name: "username",
    autoComplete: "username",
    autoCapitalize: "none",
    value: f.username,
    onChange: e => setF({
      ...f,
      username: e.target.value
    }),
    className: fi + ' mt-1'
  })), /*#__PURE__*/React.createElement("label", {
    className: "block"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-bold text-slate-300"
  }, "Password"), /*#__PURE__*/React.createElement("div", {
    className: "relative mt-1"
  }, /*#__PURE__*/React.createElement("input", {
    name: "password",
    type: lihat ? 'text' : 'password',
    autoComplete: "current-password",
    value: f.password,
    onChange: e => setF({
      ...f,
      password: e.target.value
    }),
    className: fi + ' pr-16'
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => setLihat(!lihat),
    className: "absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400"
  }, lihat ? 'Sembunyi' : 'Lihat'))), err && /*#__PURE__*/React.createElement("p", {
    role: "alert",
    className: "text-sm text-rose-300 font-semibold"
  }, err), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    disabled: proses,
    className: "w-full py-3.5 rounded-xl bg-red-600 font-black disabled:opacity-60"
  }, proses ? 'Memeriksa…' : 'Masuk')), /*#__PURE__*/React.createElement("p", {
    className: "mt-4 text-xs text-slate-500"
  }, "Akun dibuat oleh admin di portal viopran.com (menu Pengguna). Lupa password? Hubungi admin.")));
}

// ================================================================== beranda per peran
const salamWaktu = () => {
  const h = new Date().getHours();
  return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
};
const hariIni = () => new Date().toLocaleDateString('id-ID', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric'
});
const WARNA = {
  red: 'bg-red-50 text-red-600',
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  violet: 'bg-violet-50 text-violet-600',
  slate: 'bg-slate-100 text-slate-600'
};
function Sambutan(_ref18) {
  let {
    me,
    angka
  } = _ref18;
  return /*#__PURE__*/React.createElement("section", {
    className: "rounded-3xl bg-ink text-white p-5 relative overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "absolute -right-10 -top-10 w-40 h-40 rounded-full bg-red-600/25"
  }), /*#__PURE__*/React.createElement("div", {
    className: "relative"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-400"
  }, hariIni()), /*#__PURE__*/React.createElement("h2", {
    className: "text-2xl font-black mt-1 leading-tight"
  }, salamWaktu(), ", ", me.name.split(' ')[0]), /*#__PURE__*/React.createElement("span", {
    className: "inline-block mt-2 px-2.5 py-1 rounded-full bg-white/10 text-[11px] font-bold tracking-wide"
  }, ROLES[me.role]), angka && angka.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: `grid gap-3 mt-4 ${angka.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`
  }, angka.map(_ref19 => {
    let [l, v] = _ref19;
    return /*#__PURE__*/React.createElement("div", {
      key: l,
      className: "bg-white/5 border border-white/10 rounded-2xl px-3 py-2.5"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-lg font-black tabular-nums leading-tight"
    }, v), /*#__PURE__*/React.createElement("div", {
      className: "text-[10px] font-semibold text-slate-400 leading-tight mt-0.5"
    }, l));
  }))));
}

// Daftar "Perlu tindakan": kalimat jelas + satu ketukan menuju layarnya
function Tindakan(_ref20) {
  let {
    items
  } = _ref20;
  const [lebih, setLebih] = useState(false);
  return /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("h3", {
    className: "text-sm font-black text-slate-800 mb-2"
  }, "Perlu tindakan Anda"), items.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center"
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.check
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", {
    className: "text-sm block"
  }, "Semua beres"), /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-slate-500"
  }, "Tidak ada yang menunggu Anda saat ini."))) : /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden"
  }, items.slice(0, lebih ? items.length : 5).map((t, k) => /*#__PURE__*/React.createElement("button", {
    key: k,
    onClick: t.onClick,
    className: "w-full flex items-center gap-3 p-3.5 text-left active:bg-slate-50"
  }, /*#__PURE__*/React.createElement("span", {
    className: `w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${WARNA[t.warna || 'red']}`
  }, /*#__PURE__*/React.createElement(Ico, {
    d: t.ikon || I.alert,
    size: 20
  })), /*#__PURE__*/React.createElement("span", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("b", {
    className: "block text-sm leading-snug"
  }, t.judul), t.sub && /*#__PURE__*/React.createElement("span", {
    className: "block text-xs text-slate-500 truncate"
  }, t.sub)), /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-bold text-red-600 shrink-0"
  }, t.aksi || 'Buka'), /*#__PURE__*/React.createElement(Ico, {
    d: I.chev,
    size: 16,
    className: "text-slate-300 shrink-0"
  }))), items.length > 5 && /*#__PURE__*/React.createElement("button", {
    onClick: () => setLebih(!lebih),
    className: "w-full p-3 text-center text-xs font-bold text-slate-600"
  }, lebih ? 'Tampilkan lebih sedikit' : `Tampilkan ${items.length - 5} lainnya`)));
}

// Menu utama: ubin besar ber-ikon dengan penjelasan singkat
function MenuUtama(_ref21) {
  let {
    items
  } = _ref21;
  return /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("h3", {
    className: "text-sm font-black text-slate-800 mb-2"
  }, "Menu"), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-3"
  }, items.map(m => /*#__PURE__*/React.createElement("button", {
    key: m.judul,
    onClick: m.onClick,
    className: "relative text-left bg-white rounded-2xl border border-slate-200 p-4 active:bg-slate-50 shadow-sm"
  }, /*#__PURE__*/React.createElement("span", {
    className: `w-11 h-11 rounded-xl flex items-center justify-center ${WARNA[m.warna]}`
  }, /*#__PURE__*/React.createElement(Ico, {
    d: m.ikon,
    size: 22
  })), /*#__PURE__*/React.createElement("b", {
    className: "block text-[15px] mt-3 leading-tight"
  }, m.judul), /*#__PURE__*/React.createElement("span", {
    className: "block text-[11px] text-slate-500 mt-1 leading-snug"
  }, m.ket), m.badge > 0 && /*#__PURE__*/React.createElement("span", {
    className: "absolute top-3 right-3 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold leading-[22px] text-center"
  }, m.badge)))));
}
const PANDUAN = {
  teknisi: [['Terima tugas', 'Buka Tugas Saya, pilih tugas baru, tekan “Terima tugas”.'], ['Periksa tiap APAR', 'Isi tekanan, masa berlaku, selang, handle, pin, lalu ambil foto. Aplikasi memberi tanda Layak/Tidak layak.'], ['Selesaikan', 'Setelah semua APAR terisi, tekan “Selesai & buat laporan PDF”.'], ['Lapor kerja', 'Selesai refilling/pengadaan? Tekan tombol merah “Lapor Kerja” di bawah, isi data dan foto.'], ['Ajukan gaji', 'Tiap bulan lewat menu Gaji. Status bisa dipantau sampai dibayar.']],
  manager: [['Jadwalkan', 'Laporan kerja teknisi masuk ke “Pekerjaan Teknisi”. Tekan “Jadwalkan” untuk membuat tugas pemeriksaan.'], ['Buat tugas', 'Atau tekan tombol merah “Buat Tugas”: isi tempat, tanggal, APAR, dan pilih teknisi.'], ['Pantau', 'Progres tiap pemeriksaan terlihat di menu Pemeriksaan (jumlah APAR yang sudah diperiksa).'], ['Periksa gaji', 'Di menu Persetujuan, periksa gaji teknisi lalu “Teruskan ke Direktur” atau “Kembalikan”.'], ['Ingatkan Direktur', 'Jika pembayaran tertunda, tekan “Ingatkan Direktur” — HP Direktur berbunyi.']],
  direktur: [['Cek pembayaran', 'Menu Pembayaran berisi gaji dan pembayaran yang sudah diperiksa Manager.'], ['Bayar', 'Buka pengajuan, isi tanggal & referensi, foto bukti, lalu “Tandai dibayar”.'], ['Otomatis tercatat', 'Pembayaran langsung masuk Kas Keluar dan dikirim ke portal viopran.com.'], ['Pantau', 'Progres pemeriksaan dan arsip laporan PDF per klien bisa dilihat kapan saja.']]
};
function Panduan(_ref22) {
  let {
    role,
    onTutup
  } = _ref22;
  return /*#__PURE__*/React.createElement("section", {
    className: "bg-white rounded-2xl border-2 border-red-100 p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-8 h-8 rounded-lg bg-red-600 text-white flex items-center justify-center"
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.help,
    size: 18
  })), /*#__PURE__*/React.createElement("b", {
    className: "text-sm"
  }, "Cara memakai aplikasi (", ROLES[role], ")")), /*#__PURE__*/React.createElement("ol", {
    className: "mt-3 space-y-2.5"
  }, PANDUAN[role].map((_ref23, i) => {
    let [j, k] = _ref23;
    return /*#__PURE__*/React.createElement("li", {
      key: j,
      className: "flex gap-3"
    }, /*#__PURE__*/React.createElement("span", {
      className: "w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-black flex items-center justify-center shrink-0"
    }, i + 1), /*#__PURE__*/React.createElement("span", {
      className: "text-sm leading-snug"
    }, /*#__PURE__*/React.createElement("b", null, j, "."), " ", /*#__PURE__*/React.createElement("span", {
      className: "text-slate-600"
    }, k)));
  })), onTutup && /*#__PURE__*/React.createElement("button", {
    onClick: onTutup,
    className: "mt-4 w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold"
  }, "Mengerti, sembunyikan panduan"));
}
function AjakNotif(_ref24) {
  let {
    ctx
  } = _ref24;
  if (!(ctx.perm === 'default' || ctx.installEvt)) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "bg-white border border-slate-200 rounded-2xl p-4 flex gap-3 items-start"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0"
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.bell
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 text-sm"
  }, /*#__PURE__*/React.createElement("b", null, "Aktifkan pemberitahuan"), /*#__PURE__*/React.createElement("p", {
    className: "text-slate-500 text-xs mt-0.5"
  }, "Agar HP berbunyi saat ada tugas, pengajuan, atau pembayaran baru."), /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-2 mt-2.5"
  }, ctx.perm === 'default' && /*#__PURE__*/React.createElement("button", {
    onClick: ctx.mintaIzin,
    className: "px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold"
  }, "Izinkan notifikasi"), ctx.installEvt && /*#__PURE__*/React.createElement("button", {
    onClick: ctx.pasang,
    className: "px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold"
  }, "Pasang aplikasi"))));
}
const Kartu = _ref25 => {
  let {
    judul,
    nilai,
    sub,
    onClick,
    tone
  } = _ref25;
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    className: "text-left bg-white rounded-2xl border border-slate-200 p-4 active:bg-slate-50"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold uppercase tracking-wide text-slate-500"
  }, judul), /*#__PURE__*/React.createElement("div", {
    className: `text-xl font-black mt-1.5 tabular-nums ${tone || ''}`
  }, nilai), sub && /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] text-slate-500 mt-0.5"
  }, sub));
};
const PanduanBeranda = _ref26 => {
  let {
    ctx
  } = _ref26;
  return ctx.panduanTampil ? /*#__PURE__*/React.createElement(Panduan, {
    role: ctx.me.role,
    onTutup: ctx.tutupPanduan
  }) : null;
};
const Bagian = _ref27 => {
  let {
    judul,
    aksi,
    children
  } = _ref27;
  return /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-2"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "text-sm font-black text-slate-800"
  }, judul), aksi), children);
};
const LinkKecil = _ref28 => {
  let {
    onClick,
    children
  } = _ref28;
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    className: "text-xs font-bold text-red-600"
  }, children);
};
function BerandaTeknisi(_ref29) {
  let {
    ctx
  } = _ref29;
  const {
    st,
    me,
    go
  } = ctx;
  const mine = st.tugas.filter(t => t.teknisiIds.includes(me.id));
  const baru = mine.filter(t => t.status === 'baru'),
    jalan = mine.filter(t => t.status === 'dikerjakan');
  const ajuSaya = st.aju.filter(a => a.pemohonId === me.id);
  const kembali = ajuSaya.filter(a => a.status === 'dikembalikan');
  const pkj = st.pekerjaan.filter(p => p.teknisiId === me.id);
  const tindakan = [...baru.map(t => ({
    judul: `Tugas baru: ${t.tempat}`,
    sub: `${t.jumlah} APAR · mulai ${fmtDate(t.tglMulai)}`,
    aksi: 'Terima',
    warna: 'amber',
    ikon: I.inbox,
    onClick: () => go('tugas', {
      id: t.id
    })
  })), ...jalan.map(t => {
    const p = progres(t);
    return {
      judul: `Lanjutkan: ${t.tempat}`,
      sub: `${p.d} dari ${p.n} APAR sudah diperiksa · selesai ${fmtDate(t.tglSelesai)}`,
      aksi: 'Lanjut',
      warna: 'blue',
      ikon: I.clip,
      onClick: () => go('tugas', {
        id: t.id
      })
    };
  }), ...kembali.map(a => ({
    judul: 'Pengajuan gaji dikembalikan',
    sub: a.keperluan,
    aksi: 'Perbaiki',
    warna: 'red',
    ikon: I.wallet,
    onClick: () => go('aju', {
      id: a.id
    })
  }))];
  const prosesGaji = ajuSaya.filter(a => ['cek_manager', 'menunggu_direktur'].includes(a.status)).length;
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-5"
  }, /*#__PURE__*/React.createElement(Sambutan, {
    me: me,
    angka: [['Tugas baru', baru.length], ['Sedang dikerjakan', jalan.length], ['Gaji diproses', prosesGaji]]
  }), /*#__PURE__*/React.createElement(AjakNotif, {
    ctx: ctx
  }), /*#__PURE__*/React.createElement(Tindakan, {
    items: tindakan
  }), /*#__PURE__*/React.createElement(MenuUtama, {
    items: [{
      judul: 'Tugas Saya',
      ket: 'Tugas pemeriksaan APAR dari Manager',
      ikon: I.clip,
      warna: 'blue',
      badge: baru.length,
      onClick: () => go('tugas')
    }, {
      judul: 'Lapor Kerja',
      ket: 'Refilling / pengadaan + foto',
      ikon: I.wrench,
      warna: 'red',
      onClick: () => go('uploadPekerjaan')
    }, {
      judul: 'Riwayat Kerja',
      ket: `${pkj.length} laporan pekerjaan Anda`,
      ikon: I.history,
      warna: 'slate',
      onClick: () => go('pekerjaan')
    }, {
      judul: 'Pengajuan Gaji',
      ket: 'Ajukan & pantau status gaji',
      ikon: I.wallet,
      warna: 'green',
      badge: kembali.length,
      onClick: () => go('aju')
    }]
  }), /*#__PURE__*/React.createElement(PanduanBeranda, {
    ctx: ctx
  }));
}
function BerandaManager(_ref30) {
  let {
    ctx
  } = _ref30;
  const {
    st,
    me,
    go
  } = ctx;
  const aktif = st.tugas.filter(t => t.status !== 'selesai');
  const telat = aktif.filter(t => t.tglSelesai < todayStr());
  const belumJadwal = st.pekerjaan.filter(p => !p.taskId);
  const cek = st.aju.filter(a => a.status === 'cek_manager');
  const tunggu = st.aju.filter(a => a.status === 'menunggu_direktur');
  const tindakan = [...cek.map(a => ({
    judul: `Periksa gaji ${userById(a.pemohonId).name}`,
    sub: `${a.keperluan} · ${fmt(a.total)}`,
    aksi: 'Periksa',
    warna: 'amber',
    ikon: I.approve,
    onClick: () => go('aju', {
      id: a.id
    })
  })), ...belumJadwal.map(p => ({
    judul: `Jadwalkan pemeriksaan: ${p.konsumen}`,
    sub: `${p.jenis} ${sum(p.rows, r => r.jumlah)} APAR · oleh ${userById(p.teknisiId).name}`,
    aksi: 'Jadwalkan',
    warna: 'red',
    ikon: I.calendar,
    onClick: () => go('buatTugas', {
      dari: p.id
    })
  })), ...telat.map(t => ({
    judul: `Lewat jadwal: ${t.tempat}`,
    sub: `Target ${fmtDate(t.tglSelesai)} · ${progres(t).d}/${progres(t).n} APAR`,
    aksi: 'Lihat',
    warna: 'red',
    ikon: I.alert,
    onClick: () => go('tugas', {
      id: t.id
    })
  }))];
  if (tunggu.length) tindakan.push({
    judul: `${tunggu.length} pengajuan menunggu Direktur`,
    sub: `Total ${fmt(sum(tunggu, a => a.total))} — kirim pengingat ke HP Direktur`,
    aksi: 'Ingatkan',
    warna: 'violet',
    ikon: I.send,
    onClick: ctx.ingatkanDirektur
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-5"
  }, /*#__PURE__*/React.createElement(Sambutan, {
    me: me,
    angka: [['Pemeriksaan aktif', aktif.length], ['Gaji perlu diperiksa', cek.length], ['Belum dijadwalkan', belumJadwal.length]]
  }), /*#__PURE__*/React.createElement(AjakNotif, {
    ctx: ctx
  }), /*#__PURE__*/React.createElement(Tindakan, {
    items: tindakan
  }), /*#__PURE__*/React.createElement(MenuUtama, {
    items: [{
      judul: 'Buat Tugas',
      ket: 'Tugas pemeriksaan untuk teknisi',
      ikon: I.plus,
      warna: 'red',
      onClick: () => go('buatTugas')
    }, {
      judul: 'Pemeriksaan',
      ket: 'Pantau progres tiap lokasi',
      ikon: I.clip,
      warna: 'blue',
      badge: telat.length,
      onClick: () => go('tugas')
    }, {
      judul: 'Pekerjaan Teknisi',
      ket: 'Laporan refilling & pengadaan',
      ikon: I.wrench,
      warna: 'amber',
      badge: belumJadwal.length,
      onClick: () => go('pekerjaan')
    }, {
      judul: 'Persetujuan',
      ket: 'Gaji teknisi & pengajuan bayar',
      ikon: I.approve,
      warna: 'green',
      badge: cek.length,
      onClick: () => go('aju')
    }, {
      judul: 'Ajukan Pembayaran',
      ket: 'Pengadaan & biaya operasional',
      ikon: I.cash,
      warna: 'violet',
      onClick: () => go('formAju', {
        jenis: 'pembayaran'
      })
    }, {
      judul: 'Arsip PDF',
      ket: 'Laporan per klien (Google Drive)',
      ikon: I.folder,
      warna: 'slate',
      onClick: () => go('arsip')
    }]
  }), /*#__PURE__*/React.createElement(PanduanBeranda, {
    ctx: ctx
  }), /*#__PURE__*/React.createElement(Bagian, {
    judul: "Progres pemeriksaan",
    aksi: /*#__PURE__*/React.createElement(LinkKecil, {
      onClick: () => go('tugas')
    }, "Lihat semua")
  }, aktif.length === 0 ? /*#__PURE__*/React.createElement(Kosong, {
    teks: "Tidak ada pemeriksaan aktif."
  }) : /*#__PURE__*/React.createElement("div", {
    className: "space-y-2.5"
  }, aktif.slice(0, 3).map(t => /*#__PURE__*/React.createElement(KartuTugas, {
    key: t.id,
    t: t,
    onClick: () => go('tugas', {
      id: t.id
    })
  })))));
}
function BerandaDirektur(_ref31) {
  let {
    ctx
  } = _ref31;
  const {
    st,
    me,
    go
  } = ctx;
  const tunggu = st.aju.filter(a => a.status === 'menunggu_direktur');
  const bln = todayStr().slice(0, 7);
  const kasBulan = st.kasKeluar.filter(k => k.tgl.startsWith(bln));
  const aktif = st.tugas.filter(t => t.status !== 'selesai');
  const tindakan = tunggu.map(a => ({
    judul: `Bayar: ${a.keperluan}`,
    sub: `${userById(a.pemohonId).name} · ${fmt(a.total)}`,
    aksi: 'Bayar',
    warna: 'red',
    ikon: I.cash,
    onClick: () => go('aju', {
      id: a.id
    })
  }));
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-5"
  }, /*#__PURE__*/React.createElement(Sambutan, {
    me: me,
    angka: [['Perlu dibayar', fmt(sum(tunggu, a => a.total))], ['Kas keluar bulan ini', fmt(sum(kasBulan, k => k.nominal))]]
  }), /*#__PURE__*/React.createElement(AjakNotif, {
    ctx: ctx
  }), /*#__PURE__*/React.createElement(Tindakan, {
    items: tindakan
  }), /*#__PURE__*/React.createElement(MenuUtama, {
    items: [{
      judul: 'Pembayaran',
      ket: 'Gaji & pengajuan yang perlu dibayar',
      ikon: I.wallet,
      warna: 'red',
      badge: tunggu.length,
      onClick: () => go('aju')
    }, {
      judul: 'Kas Keluar',
      ket: 'Tercatat otomatis ke portal',
      ikon: I.cash,
      warna: 'green',
      onClick: () => go('kas')
    }, {
      judul: 'Pemeriksaan',
      ket: 'Progres pemeriksaan APAR',
      ikon: I.clip,
      warna: 'blue',
      onClick: () => go('tugas')
    }, {
      judul: 'Arsip PDF',
      ket: 'Laporan per klien (Google Drive)',
      ikon: I.folder,
      warna: 'slate',
      onClick: () => go('arsip')
    }]
  }), /*#__PURE__*/React.createElement(PanduanBeranda, {
    ctx: ctx
  }), /*#__PURE__*/React.createElement(Bagian, {
    judul: "Progres pemeriksaan",
    aksi: /*#__PURE__*/React.createElement(LinkKecil, {
      onClick: () => go('tugas')
    }, "Lihat semua")
  }, aktif.length === 0 ? /*#__PURE__*/React.createElement(Kosong, {
    teks: "Tidak ada pemeriksaan aktif."
  }) : /*#__PURE__*/React.createElement("div", {
    className: "space-y-2.5"
  }, aktif.slice(0, 3).map(t => /*#__PURE__*/React.createElement(KartuTugas, {
    key: t.id,
    t: t,
    onClick: () => go('tugas', {
      id: t.id
    })
  })))));
}

// ================================================================== kartu
const KartuTugas = _ref32 => {
  let {
    t,
    onClick
  } = _ref32;
  const p = progres(t);
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    className: "w-full text-left bg-white rounded-2xl border border-slate-200 p-4 active:bg-slate-50"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-start justify-between gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold text-slate-400"
  }, noDok(t.id)), /*#__PURE__*/React.createElement("div", {
    className: "font-bold leading-snug truncate"
  }, t.tempat), /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] text-slate-500"
  }, fmtDate(t.tglMulai), " \u2013 ", fmtDate(t.tglSelesai), " \xB7 ", t.teknisiIds.map(i => userById(i).name.split(' ')[0]).join(', '))), /*#__PURE__*/React.createElement(Badge, {
    map: ST_TUGAS,
    status: t.status
  })), /*#__PURE__*/React.createElement("div", {
    className: "mt-3 flex items-center gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex-1"
  }, /*#__PURE__*/React.createElement(Bar, {
    pct: p.pct
  })), /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-bold tabular-nums text-slate-600"
  }, p.d, "/", p.n, " APAR")));
};
const KartuPekerjaan = _ref33 => {
  let {
    p,
    onClick
  } = _ref33;
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    className: "w-full text-left bg-white rounded-2xl border border-slate-200 p-4 active:bg-slate-50"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-start justify-between gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold text-slate-400"
  }, noDok(p.id), " \xB7 ", userById(p.teknisiId).name), /*#__PURE__*/React.createElement("div", {
    className: "font-bold truncate"
  }, p.konsumen), /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] text-slate-500"
  }, p.jenis, " \xB7 ", fmtDate(p.tanggal), " \xB7 ", sum(p.rows, r => r.jumlah), " APAR")), p.taskId ? /*#__PURE__*/React.createElement("span", {
    className: `px-2 py-0.5 rounded-full text-[11px] font-bold border ${TONE.green}`
  }, "Dijadwalkan") : /*#__PURE__*/React.createElement("span", {
    className: `px-2 py-0.5 rounded-full text-[11px] font-bold border ${TONE.rose}`
  }, "Belum dijadwalkan")));
};
const KartuAju = _ref34 => {
  let {
    a,
    onClick
  } = _ref34;
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    className: "w-full text-left bg-white rounded-2xl border border-slate-200 p-4 active:bg-slate-50"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-start justify-between gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold text-slate-400"
  }, noDok(a.id), " \xB7 ", a.jenis === 'gaji' ? 'Gaji' : 'Pembayaran', " \xB7 ", userById(a.pemohonId).name), /*#__PURE__*/React.createElement("div", {
    className: "font-bold truncate"
  }, a.keperluan)), /*#__PURE__*/React.createElement("div", {
    className: "font-black tabular-nums shrink-0"
  }, fmt(a.total))), /*#__PURE__*/React.createElement("div", {
    className: "mt-2"
  }, /*#__PURE__*/React.createElement(Badge, {
    map: ST_AJU,
    status: a.status
  })));
};

// ================================================================== tugas pemeriksaan
function DaftarTugas(_ref35) {
  let {
    ctx
  } = _ref35;
  const {
    st,
    me,
    go
  } = ctx;
  const [tab, setTab] = useState('aktif');
  const semua = me.role === 'teknisi' ? st.tugas.filter(t => t.teknisiIds.includes(me.id)) : st.tugas;
  const list = semua.filter(t => tab === 'aktif' ? t.status !== 'selesai' : t.status === 'selesai');
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-start justify-between gap-3"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    className: "text-xl font-black"
  }, me.role === 'teknisi' ? 'Tugas Saya' : 'Pemeriksaan'), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-500"
  }, me.role === 'teknisi' ? 'Ketuk tugas untuk menerima dan mengisi tabel pemeriksaan.' : 'Progres pemeriksaan APAR di setiap lokasi.')), me.role === 'manager' && /*#__PURE__*/React.createElement("button", {
    onClick: () => go('buatTugas'),
    className: "px-3 py-2 rounded-xl bg-red-600 text-white text-xs font-bold shrink-0"
  }, "+ Buat tugas")), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 bg-slate-200 rounded-xl p-1 text-sm font-bold"
  }, [['aktif', 'Aktif'], ['selesai', 'Selesai']].map(_ref36 => {
    let [k, l] = _ref36;
    return /*#__PURE__*/React.createElement("button", {
      key: k,
      onClick: () => setTab(k),
      className: `py-1.5 rounded-lg ${tab === k ? 'bg-white shadow-sm' : 'text-slate-500'}`
    }, l);
  })), list.length === 0 ? /*#__PURE__*/React.createElement(Kosong, {
    teks: "Tidak ada tugas."
  }) : /*#__PURE__*/React.createElement("div", {
    className: "space-y-2.5"
  }, list.map(t => /*#__PURE__*/React.createElement(KartuTugas, {
    key: t.id,
    t: t,
    onClick: () => go('tugas', {
      id: t.id
    })
  }))), me.role === 'manager' && /*#__PURE__*/React.createElement("button", {
    onClick: () => go('pekerjaan'),
    className: btnGaris
  }, "Lihat pekerjaan refilling/pengadaan teknisi"));
}
function FormTugas(_ref37) {
  let {
    ctx,
    dari
  } = _ref37;
  const {
    st,
    go
  } = ctx;
  const sumber = dari ? st.pekerjaan.find(p => p.id === dari) : null;
  const awalRows = sumber ? sumber.rows.map(r => ({
    ...r
  })) : [{
    type: '',
    berat: '',
    jumlah: ''
  }];
  const [f, setF] = useState({
    tempat: sumber ? sumber.konsumen : '',
    alamat: sumber ? sumber.alamat || '' : '',
    tglMulai: addDays(todayStr(), 1),
    tglSelesai: addDays(todayStr(), 1),
    teknisiIds: sumber ? [sumber.teknisiId] : [],
    catatan: ''
  });
  const [rows, setRows] = useState(awalRows);
  const [err, setErr] = useState('');
  const set = (k, v) => setF(p => ({
    ...p,
    [k]: v
  }));
  const teknisi = USERS.filter(u => u.role === 'teknisi');
  const jumlah = sum(rows, r => r.jumlah);
  const kirim = () => {
    const rr = rows.filter(r => r.type || r.berat || r.jumlah).map(r => ({
      ...r,
      jumlah: Number(r.jumlah) || 0
    }));
    if (!f.tempat.trim()) return setErr('Isi tempat pemeriksaan.');
    if (!f.tglMulai || !f.tglSelesai || f.tglSelesai < f.tglMulai) return setErr('Tanggal selesai tidak boleh sebelum tanggal mulai.');
    if (!rr.length || rr.some(r => !r.type || !r.berat || r.jumlah < 1)) return setErr('Lengkapi type, berat, dan jumlah APAR.');
    if (jumlah > 300) return setErr('Maksimal 300 APAR per tugas — pecah menjadi beberapa tugas.');
    if (!f.teknisiIds.length) return setErr('Pilih minimal satu teknisi.');
    setErr('');
    ctx.simpanTugas({
      ...f,
      tempat: f.tempat.trim(),
      jumlah,
      type: rr[0].type,
      berat: rr[0].berat,
      rows: rr,
      units: buatUnit(rr),
      sumber: sumber ? sumber.id : null
    });
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement(Kembali, {
    onClick: () => go(sumber ? 'pekerjaan' : 'tugas', sumber ? {
      id: sumber.id
    } : {}),
    teks: "Batal"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    className: "text-xl font-black"
  }, "Buat tugas pemeriksaan"), sumber && /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-500"
  }, "Diisi otomatis dari ", sumber.jenis.toLowerCase(), " ", sumber.id)), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Langkah 1 \xB7 Lokasi & jadwal"
  }, /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement(Lab, {
    t: "Tempat pemeriksaan"
  }, /*#__PURE__*/React.createElement("input", {
    value: f.tempat,
    onChange: e => set('tempat', e.target.value),
    placeholder: "Nama perusahaan / instansi",
    className: inp
  })), /*#__PURE__*/React.createElement(Lab, {
    t: "Alamat",
    hint: "opsional"
  }, /*#__PURE__*/React.createElement("input", {
    value: f.alamat,
    onChange: e => set('alamat', e.target.value),
    className: inp
  })), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-2"
  }, /*#__PURE__*/React.createElement(Lab, {
    t: "Tanggal mulai"
  }, /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: f.tglMulai,
    onChange: e => set('tglMulai', e.target.value),
    className: inp
  })), /*#__PURE__*/React.createElement(Lab, {
    t: "Tanggal selesai"
  }, /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: f.tglSelesai,
    onChange: e => set('tglSelesai', e.target.value),
    className: inp
  }))))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Langkah 2 \xB7 APAR yang diperiksa"
  }, /*#__PURE__*/React.createElement(BarisApar, {
    rows: rows,
    setRows: setRows
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center pt-3 mt-3 border-t border-slate-100"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-bold"
  }, "Jumlah APAR"), /*#__PURE__*/React.createElement("span", {
    className: "text-xl font-black tabular-nums"
  }, jumlah))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Langkah 3 \xB7 Teknisi yang ditugaskan"
  }, /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, teknisi.map(u => /*#__PURE__*/React.createElement("label", {
    key: u.id,
    className: "flex items-center gap-3 text-sm bg-slate-50 rounded-xl p-3"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    className: "w-5 h-5 accent-red-600",
    checked: f.teknisiIds.includes(u.id),
    onChange: e => set('teknisiIds', e.target.checked ? [...f.teknisiIds, u.id] : f.teknisiIds.filter(x => x !== u.id))
  }), u.name))), /*#__PURE__*/React.createElement("div", {
    className: "mt-3"
  }, /*#__PURE__*/React.createElement(Lab, {
    t: "Catatan untuk teknisi",
    hint: "opsional"
  }, /*#__PURE__*/React.createElement("textarea", {
    rows: "2",
    value: f.catatan,
    onChange: e => set('catatan', e.target.value),
    className: inp
  })))), err && /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-rose-600 font-semibold bg-rose-50 border border-rose-200 rounded-xl p-3"
  }, err), /*#__PURE__*/React.createElement("button", {
    onClick: kirim,
    className: btnUtama
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.send
  }), " Kirim tugas ke teknisi"));
}
function DetailTugas(_ref38) {
  let {
    ctx,
    id
  } = _ref38;
  const {
    st,
    me,
    go
  } = ctx;
  const t = st.tugas.find(x => x.id === id);
  const [edit, setEdit] = useState(null);
  if (!t) return /*#__PURE__*/React.createElement(Kosong, {
    teks: "Tugas tidak ditemukan."
  });
  const p = progres(t);
  const lay = t.units.filter(unitLayak).length;
  const sayaTeknisi = me.role === 'teknisi' && t.teknisiIds.includes(me.id);
  const bisaIsi = sayaTeknisi && t.status === 'dikerjakan';
  if (edit !== null) return /*#__PURE__*/React.createElement(FormUnit, {
    t: t,
    idx: edit,
    me: me,
    onBatal: () => setEdit(null),
    onSimpan: (u, lanjut) => {
      ctx.simpanUnit(t.id, edit, u);
      const nx = lanjut ? t.units.findIndex((x, i) => i > edit && !unitTerisi(x)) : -1;
      setEdit(nx >= 0 ? nx : null);
      if (nx < 0) window.scrollTo(0, 0);
    }
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement(Kembali, {
    onClick: () => go('tugas')
  }), /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl border border-slate-200 p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-start justify-between gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold text-slate-400"
  }, noDok(t.id)), /*#__PURE__*/React.createElement("h2", {
    className: "text-lg font-black leading-snug"
  }, t.tempat), t.alamat && /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-500"
  }, t.alamat)), /*#__PURE__*/React.createElement(Badge, {
    map: ST_TUGAS,
    status: t.status
  })), /*#__PURE__*/React.createElement("div", {
    className: "mt-3"
  }, /*#__PURE__*/React.createElement(Baris, {
    k: "Jadwal",
    v: `${fmtDate(t.tglMulai)} – ${fmtDate(t.tglSelesai)}`
  }), /*#__PURE__*/React.createElement(Baris, {
    k: "Jumlah APAR",
    v: t.jumlah
  }), /*#__PURE__*/React.createElement(Baris, {
    k: "Type / berat",
    v: `${t.type} · ${t.berat}${(t.rows || []).length > 1 ? ' + lainnya' : ''}`
  }), /*#__PURE__*/React.createElement(Baris, {
    k: "Teknisi",
    v: t.teknisiIds.map(i => userById(i).name).join(', ')
  }), t.catatan && /*#__PURE__*/React.createElement(Baris, {
    k: "Catatan",
    v: t.catatan
  })), /*#__PURE__*/React.createElement("div", {
    className: "mt-3 flex items-center gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex-1"
  }, /*#__PURE__*/React.createElement(Bar, {
    pct: p.pct
  })), /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-bold tabular-nums"
  }, p.d, "/", p.n, " diperiksa")), p.d > 0 && /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-500 mt-1.5"
  }, /*#__PURE__*/React.createElement("b", {
    className: "text-emerald-700"
  }, lay, " layak"), " \xB7 ", /*#__PURE__*/React.createElement("b", {
    className: "text-rose-600"
  }, p.d - lay, " tidak layak"))), sayaTeknisi && t.status === 'baru' && /*#__PURE__*/React.createElement("button", {
    onClick: () => ctx.terimaTugas(t.id),
    className: btnUtama
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.check
  }), " Terima tugas"), bisaIsi && p.d < p.n && /*#__PURE__*/React.createElement("button", {
    onClick: () => setEdit(t.units.findIndex(u => !unitTerisi(u))),
    className: btnUtama
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.clip
  }), " Periksa APAR berikutnya (no. ", t.units.find(u => !unitTerisi(u)).no, ")"), bisaIsi && p.d === p.n && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (confirm('Selesaikan pemeriksaan dan buat laporan PDF?')) ctx.selesaiTugas(t.id);
    },
    className: btnUtama
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.file
  }), " Selesai & buat laporan PDF"), t.status === 'selesai' && (t.pdf ? /*#__PURE__*/React.createElement("button", {
    onClick: () => bukaBerkas(t.pdf.fileId, t.pdf.name, ctx.setToast),
    className: btnUtama
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.file
  }), " Buka laporan PDF (Drive)") : /*#__PURE__*/React.createElement("button", {
    onClick: () => ctx.setLaporan({
      jenis: 'pemeriksaan',
      id: t.id
    }),
    className: btnUtama
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.file
  }), " Lihat laporan ", String(t.id).indexOf('tmp-') === 0 || ctx.sinkron.antri ? '(PDF dibuat saat terkirim)' : '')), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Tabel pemeriksaan",
    aksi: t.status !== 'baru' && /*#__PURE__*/React.createElement("button", {
      onClick: () => ctx.setLaporan({
        jenis: 'pemeriksaan',
        id: t.id
      }),
      className: "text-xs font-bold text-red-600"
    }, "Pratinjau PDF")
  }, /*#__PURE__*/React.createElement("div", {
    className: "overflow-x-auto -mx-4 px-4"
  }, /*#__PURE__*/React.createElement("table", {
    className: "w-full text-xs min-w-[520px]"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    className: "text-left text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200"
  }, /*#__PURE__*/React.createElement("th", {
    className: "py-2 pr-2"
  }, "No"), /*#__PURE__*/React.createElement("th", {
    className: "pr-2"
  }, "Lokasi"), /*#__PURE__*/React.createElement("th", {
    className: "pr-2"
  }, "Tekanan"), /*#__PURE__*/React.createElement("th", {
    className: "pr-2"
  }, "Masa berlaku"), /*#__PURE__*/React.createElement("th", {
    className: "pr-2"
  }, "Selang"), /*#__PURE__*/React.createElement("th", {
    className: "pr-2"
  }, "Handle"), /*#__PURE__*/React.createElement("th", {
    className: "pr-2"
  }, "Pin"), /*#__PURE__*/React.createElement("th", null, "Hasil"))), /*#__PURE__*/React.createElement("tbody", {
    className: "divide-y divide-slate-100"
  }, t.units.map((u, i) => {
    const ok = unitTerisi(u);
    return /*#__PURE__*/React.createElement("tr", {
      key: i,
      onClick: () => bisaIsi && setEdit(i),
      className: bisaIsi ? 'cursor-pointer active:bg-slate-50' : ''
    }, /*#__PURE__*/React.createElement("td", {
      className: "py-2 pr-2 font-bold"
    }, u.no), /*#__PURE__*/React.createElement("td", {
      className: "pr-2"
    }, u.lokasi || /*#__PURE__*/React.createElement("span", {
      className: "text-slate-300"
    }, "\u2014"), /*#__PURE__*/React.createElement("div", {
      className: "text-[10px] text-slate-400"
    }, u.type.split(' ')[0], " ", u.berat)), /*#__PURE__*/React.createElement("td", {
      className: "pr-2"
    }, u.tekanan || '—'), /*#__PURE__*/React.createElement("td", {
      className: `pr-2 ${u.kedaluwarsa && u.kedaluwarsa < todayStr() ? 'text-rose-600 font-bold' : ''}`
    }, u.kedaluwarsa ? fmtDate(u.kedaluwarsa) : '—'), /*#__PURE__*/React.createElement("td", {
      className: "pr-2"
    }, u.selang || '—'), /*#__PURE__*/React.createElement("td", {
      className: "pr-2"
    }, u.handle || '—'), /*#__PURE__*/React.createElement("td", {
      className: "pr-2"
    }, u.pin ? u.pin === 'Ada & tersegel' ? 'Ada' : 'Hilang' : '—'), /*#__PURE__*/React.createElement("td", null, ok ? unitLayak(u) ? /*#__PURE__*/React.createElement("span", {
      className: "font-bold text-emerald-700"
    }, "Layak") : /*#__PURE__*/React.createElement("span", {
      className: "font-bold text-rose-600"
    }, "Tidak layak") : /*#__PURE__*/React.createElement("span", {
      className: "text-slate-400"
    }, "Belum")));
  })))), bisaIsi && /*#__PURE__*/React.createElement("p", {
    className: "text-[11px] text-slate-500 mt-2"
  }, "Ketuk baris untuk mengisi atau mengubah.")), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Riwayat"
  }, /*#__PURE__*/React.createElement(Riwayat, {
    list: t.history
  })));
}
function FormUnit(_ref39) {
  let {
    t,
    idx,
    me,
    onBatal,
    onSimpan
  } = _ref39;
  const [u, setU] = useState(() => ({
    ...t.units[idx],
    foto: t.units[idx].foto || []
  }));
  const set = (k, v) => setU(p => ({
    ...p,
    [k]: v
  }));
  const ok = unitTerisi(u);
  const sisa = t.units.filter((x, i) => i !== idx && !unitTerisi(x)).length;
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement(Kembali, {
    onClick: onBatal,
    teks: "Kembali ke tabel"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold text-slate-400"
  }, t.tempat), /*#__PURE__*/React.createElement("h2", {
    className: "text-xl font-black"
  }, "APAR no. ", u.no, " ", /*#__PURE__*/React.createElement("span", {
    className: "text-sm font-bold text-slate-400"
  }, "dari ", t.units.length))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Langkah 1 \xB7 Identitas APAR"
  }, /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement(Lab, {
    t: "Lokasi penempatan"
  }, /*#__PURE__*/React.createElement("input", {
    value: u.lokasi,
    onChange: e => set('lokasi', e.target.value),
    placeholder: "mis. Lobi lantai 1",
    className: inp
  })), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-2"
  }, /*#__PURE__*/React.createElement(Lab, {
    t: "Type"
  }, /*#__PURE__*/React.createElement("select", {
    value: u.type,
    onChange: e => set('type', e.target.value),
    className: inp
  }, TYPE_APAR.map(x => /*#__PURE__*/React.createElement("option", {
    key: x
  }, x)))), /*#__PURE__*/React.createElement(Lab, {
    t: "Berat"
  }, /*#__PURE__*/React.createElement("select", {
    value: u.berat,
    onChange: e => set('berat', e.target.value),
    className: inp
  }, BERAT_APAR.map(x => /*#__PURE__*/React.createElement("option", {
    key: x
  }, x))))))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Langkah 2 \xB7 Hasil pemeriksaan"
  }, /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-600 mb-1.5"
  }, "Tekanan tabung (manometer)"), /*#__PURE__*/React.createElement(Segmen, {
    label: "Tekanan",
    value: u.tekanan,
    options: OPSI.tekanan,
    onChange: v => set('tekanan', v)
  })), /*#__PURE__*/React.createElement(Lab, {
    t: "Masa berlaku isi",
    hint: "tanggal kedaluwarsa pada label"
  }, /*#__PURE__*/React.createElement("input", {
    type: "date",
    "aria-label": "Masa berlaku",
    value: u.kedaluwarsa,
    onChange: e => set('kedaluwarsa', e.target.value),
    className: inp
  })), u.kedaluwarsa && u.kedaluwarsa < todayStr() && /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-rose-600 font-bold -mt-2"
  }, "Sudah kedaluwarsa \u2014 perlu isi ulang."), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-600 mb-1.5"
  }, "Selang / horn"), /*#__PURE__*/React.createElement(Segmen, {
    label: "Selang",
    value: u.selang,
    options: OPSI.selang,
    onChange: v => set('selang', v)
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-600 mb-1.5"
  }, "Handle / tuas"), /*#__PURE__*/React.createElement(Segmen, {
    label: "Handle",
    value: u.handle,
    options: OPSI.handle,
    onChange: v => set('handle', v)
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-600 mb-1.5"
  }, "Pin pengaman & segel"), /*#__PURE__*/React.createElement(Segmen, {
    label: "Pin",
    value: u.pin,
    options: OPSI.pin,
    onChange: v => set('pin', v)
  })), /*#__PURE__*/React.createElement(Lab, {
    t: "Keterangan",
    hint: "opsional"
  }, /*#__PURE__*/React.createElement("input", {
    value: u.ket,
    onChange: e => set('ket', e.target.value),
    placeholder: "mis. Perlu isi ulang, label pudar",
    className: inp
  })), /*#__PURE__*/React.createElement(FotoKamera, {
    label: "Foto APAR",
    list: u.foto,
    setList: l => set('foto', l),
    max: 2,
    info: {
      konsumen: t.tempat,
      teknisi: me ? me.name : '-',
      keterangan: `APAR no. ${u.no}${u.lokasi ? ' · ' + u.lokasi : ''}`
    }
  }))), ok && /*#__PURE__*/React.createElement("div", {
    className: `rounded-2xl p-3 text-sm font-bold text-center ${unitLayak(u) ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`
  }, "Hasil: ", unitLayak(u) ? 'LAYAK' : 'TIDAK LAYAK'), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-2"
  }, /*#__PURE__*/React.createElement("button", {
    disabled: !ok,
    onClick: () => onSimpan(u, false),
    className: "py-3 rounded-2xl border border-slate-300 font-bold text-sm disabled:opacity-40"
  }, "Simpan"), /*#__PURE__*/React.createElement("button", {
    disabled: !ok,
    onClick: () => onSimpan(u, true),
    className: "py-3 rounded-2xl bg-red-600 text-white font-black text-sm disabled:opacity-40"
  }, sisa ? 'Simpan & berikutnya' : 'Simpan')));
}

// ================================================================== pekerjaan refilling / pengadaan
function FormPekerjaan(_ref40) {
  let {
    ctx
  } = _ref40;
  const {
    go
  } = ctx;
  const [f, setF] = useState({
    tanggal: todayStr(),
    jenis: 'Refilling',
    konsumen: '',
    alamat: ''
  });
  const [rows, setRows] = useState([{
    type: '',
    berat: '',
    jumlah: ''
  }]);
  const [foto, setFoto] = useState([]);
  const [err, setErr] = useState('');
  const set = (k, v) => setF(p => ({
    ...p,
    [k]: v
  }));
  const kirim = () => {
    const rr = rows.filter(r => r.type || r.berat || r.jumlah).map(r => ({
      ...r,
      jumlah: Number(r.jumlah) || 0
    }));
    if (!f.tanggal) return setErr('Isi tanggal pengerjaan.');
    if (!f.konsumen.trim()) return setErr('Isi nama perusahaan / instansi / konsumen.');
    if (!rr.length || rr.some(r => !r.type || !r.berat || r.jumlah < 1)) return setErr('Lengkapi type, berat, dan jumlah APAR.');
    if (!foto.length) return setErr('Tambahkan minimal satu foto dokumentasi pengerjaan.');
    setErr('');
    ctx.simpanPekerjaan({
      ...f,
      konsumen: f.konsumen.trim(),
      rows: rr,
      foto
    });
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement(Kembali, {
    onClick: () => go('home'),
    teks: "Batal"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    className: "text-xl font-black"
  }, "Lapor kerja"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-500"
  }, "Isi setelah selesai refilling atau pengadaan. Laporan otomatis masuk ke Manager Operasional untuk dijadwalkan pemeriksaan.")), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Langkah 1 \xB7 Data pekerjaan"
  }, /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-2"
  }, ['Refilling', 'Pengadaan'].map(j => /*#__PURE__*/React.createElement("button", {
    key: j,
    type: "button",
    onClick: () => set('jenis', j),
    className: `rounded-xl border-2 p-3 text-left ${f.jenis === j ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-white'}`
  }, /*#__PURE__*/React.createElement("b", {
    className: "block text-sm"
  }, j), /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] text-slate-500"
  }, j === 'Refilling' ? 'isi ulang APAR' : 'APAR baru')))), /*#__PURE__*/React.createElement(Lab, {
    t: "Tanggal pengerjaan"
  }, /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: f.tanggal,
    onChange: e => set('tanggal', e.target.value),
    className: inp
  })), /*#__PURE__*/React.createElement(Lab, {
    t: "Nama perusahaan / instansi / konsumen"
  }, /*#__PURE__*/React.createElement("input", {
    value: f.konsumen,
    onChange: e => set('konsumen', e.target.value),
    className: inp
  })), /*#__PURE__*/React.createElement(Lab, {
    t: "Alamat",
    hint: "opsional"
  }, /*#__PURE__*/React.createElement("input", {
    value: f.alamat,
    onChange: e => set('alamat', e.target.value),
    className: inp
  })))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Langkah 2 \xB7 APAR yang dikerjakan"
  }, /*#__PURE__*/React.createElement(BarisApar, {
    rows: rows,
    setRows: setRows
  })), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Langkah 3 \xB7 Foto dokumentasi"
  }, /*#__PURE__*/React.createElement(FotoKamera, {
    label: "Foto pengerjaan",
    list: foto,
    setList: setFoto,
    max: 6,
    info: {
      konsumen: f.konsumen.trim(),
      teknisi: ctx.me.name,
      keterangan: `${f.jenis} APAR`
    },
    syarat: f.konsumen.trim() ? '' : 'Isi nama perusahaan / konsumen dulu — dipakai untuk watermark foto.'
  })), err && /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-rose-600 font-semibold bg-rose-50 border border-rose-200 rounded-xl p-3"
  }, err), /*#__PURE__*/React.createElement("button", {
    onClick: kirim,
    className: btnUtama
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.send
  }), " Simpan pekerjaan"));
}
function DaftarPekerjaan(_ref41) {
  let {
    ctx
  } = _ref41;
  const {
    st,
    me,
    go
  } = ctx;
  const list = me.role === 'teknisi' ? st.pekerjaan.filter(p => p.teknisiId === me.id) : st.pekerjaan;
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement(Kembali, {
    onClick: () => go(me.role === 'teknisi' ? 'home' : 'tugas')
  }), /*#__PURE__*/React.createElement("h2", {
    className: "text-xl font-black"
  }, "Pekerjaan refilling & pengadaan"), list.length === 0 ? /*#__PURE__*/React.createElement(Kosong, {
    teks: "Belum ada pekerjaan."
  }) : /*#__PURE__*/React.createElement("div", {
    className: "space-y-2.5"
  }, list.map(p => /*#__PURE__*/React.createElement(KartuPekerjaan, {
    key: p.id,
    p: p,
    onClick: () => go('pekerjaan', {
      id: p.id
    })
  }))));
}
function DetailPekerjaan(_ref42) {
  let {
    ctx,
    id
  } = _ref42;
  const {
    st,
    me,
    go
  } = ctx;
  const p = st.pekerjaan.find(x => x.id === id);
  if (!p) return /*#__PURE__*/React.createElement(Kosong, {
    teks: "Pekerjaan tidak ditemukan."
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement(Kembali, {
    onClick: () => go('pekerjaan')
  }), /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl border border-slate-200 p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold text-slate-400"
  }, noDok(p.id)), /*#__PURE__*/React.createElement("h2", {
    className: "text-lg font-black"
  }, p.konsumen), /*#__PURE__*/React.createElement("div", {
    className: "mt-2"
  }, /*#__PURE__*/React.createElement(Baris, {
    k: "Jenis",
    v: p.jenis
  }), /*#__PURE__*/React.createElement(Baris, {
    k: "Tanggal",
    v: fmtDate(p.tanggal)
  }), /*#__PURE__*/React.createElement(Baris, {
    k: "Teknisi",
    v: userById(p.teknisiId).name
  }), p.alamat && /*#__PURE__*/React.createElement(Baris, {
    k: "Alamat",
    v: p.alamat
  }), /*#__PURE__*/React.createElement(Baris, {
    k: "Pemeriksaan",
    v: p.taskId ? `Dijadwalkan · ${noDok(p.taskId)}` : 'Belum dijadwalkan'
  }))), me.role === 'manager' && !p.taskId && /*#__PURE__*/React.createElement("button", {
    onClick: () => go('buatTugas', {
      dari: p.id
    }),
    className: btnUtama
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.clip
  }), " Jadwalkan tugas pemeriksaan"), p.pdf && /*#__PURE__*/React.createElement("button", {
    onClick: () => bukaBerkas(p.pdf.fileId, p.pdf.name, ctx.setToast),
    className: btnUtama
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.file
  }), " Buka PDF dokumentasi (Drive)"), p.taskId && /*#__PURE__*/React.createElement("button", {
    onClick: () => go('tugas', {
      id: p.taskId
    }),
    className: btnGaris
  }, "Buka tugas ", noDok(p.taskId)), /*#__PURE__*/React.createElement(Seksi, {
    judul: "APAR"
  }, /*#__PURE__*/React.createElement("table", {
    className: "w-full text-sm"
  }, /*#__PURE__*/React.createElement("tbody", null, p.rows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    className: "border-b border-slate-100 last:border-0"
  }, /*#__PURE__*/React.createElement("td", {
    className: "py-2"
  }, r.type, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] text-slate-400"
  }, r.berat)), /*#__PURE__*/React.createElement("td", {
    className: "py-2 text-right font-black"
  }, r.jumlah, " unit")))))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Dokumentasi",
    aksi: /*#__PURE__*/React.createElement("button", {
      onClick: () => ctx.setLaporan({
        jenis: 'pekerjaan',
        id: p.id
      }),
      className: "text-xs font-bold text-red-600"
    }, "Pratinjau PDF")
  }, p.foto.length ? /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-2"
  }, p.foto.map((a, i) => /*#__PURE__*/React.createElement(Foto, {
    key: i,
    f: a,
    className: "w-full aspect-[4/3] object-contain bg-slate-900 rounded-xl border border-slate-200"
  }))) : /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-slate-400"
  }, "Tidak ada foto.")));
}

// ================================================================== pengajuan gaji / pembayaran
function DaftarAju(_ref43) {
  let {
    ctx
  } = _ref43;
  const {
    st,
    me,
    go
  } = ctx;
  const [tab, setTab] = useState('proses');
  const semua = me.role === 'teknisi' ? st.aju.filter(a => a.pemohonId === me.id) : st.aju;
  const list = semua.filter(a => tab === 'proses' ? !['dibayar', 'ditolak'].includes(a.status) : ['dibayar', 'ditolak'].includes(a.status));
  const judul = {
    teknisi: 'Pengajuan Gaji',
    manager: 'Persetujuan',
    direktur: 'Pembayaran'
  }[me.role];
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-xl font-black"
  }, judul), me.role === 'teknisi' && /*#__PURE__*/React.createElement("button", {
    onClick: () => go('formAju', {
      jenis: 'gaji'
    }),
    className: "px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold"
  }, "+ Ajukan gaji"), me.role === 'manager' && /*#__PURE__*/React.createElement("button", {
    onClick: () => go('formAju', {
      jenis: 'pembayaran'
    }),
    className: "px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold"
  }, "+ Ajukan pembayaran")), me.role === 'manager' && st.aju.some(a => a.status === 'menunggu_direktur') && /*#__PURE__*/React.createElement("button", {
    onClick: ctx.ingatkanDirektur,
    className: "w-full py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm flex items-center justify-center gap-2"
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.send,
    size: 16
  }), " Ingatkan Direktur (", st.aju.filter(a => a.status === 'menunggu_direktur').length, " menunggu)"), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 bg-slate-200 rounded-xl p-1 text-sm font-bold"
  }, [['proses', 'Dalam proses'], ['selesai', 'Selesai']].map(_ref44 => {
    let [k, l] = _ref44;
    return /*#__PURE__*/React.createElement("button", {
      key: k,
      onClick: () => setTab(k),
      className: `py-1.5 rounded-lg ${tab === k ? 'bg-white shadow-sm' : 'text-slate-500'}`
    }, l);
  })), list.length === 0 ? /*#__PURE__*/React.createElement(Kosong, {
    teks: "Tidak ada pengajuan."
  }) : /*#__PURE__*/React.createElement("div", {
    className: "space-y-2.5"
  }, list.map(a => /*#__PURE__*/React.createElement(KartuAju, {
    key: a.id,
    a: a,
    onClick: () => go('aju', {
      id: a.id
    })
  }))));
}
function FormAju(_ref45) {
  let {
    ctx,
    jenis,
    editId
  } = _ref45;
  const {
    st,
    me,
    go
  } = ctx;
  const awal = editId ? st.aju.find(a => a.id === editId) : null;
  const j = awal ? awal.jenis : jenis;
  const bln = addMonths(todayStr(), -1).slice(0, 7);
  const [f, setF] = useState(() => awal ? {
    ...awal,
    rincian: awal.rincian.map(r => ({
      ...r
    }))
  } : j === 'gaji' ? {
    jenis: 'gaji',
    periode: bln,
    keperluan: '',
    kategori: 'Operasional',
    jenisBiaya: 'Gaji & upah karyawan',
    rincian: [{
      desc: 'Gaji pokok',
      jumlah: ''
    }, {
      desc: 'Lembur',
      jumlah: ''
    }, {
      desc: 'Uang makan & transport',
      jumlah: ''
    }],
    bank: '',
    rekening: '',
    atasNama: me.name,
    lampiran: [],
    catatan: ''
  } : {
    jenis: 'pembayaran',
    keperluan: '',
    kategori: 'HPP',
    jenisBiaya: '',
    rincian: [{
      desc: '',
      jumlah: ''
    }],
    bank: '',
    rekening: '',
    atasNama: '',
    lampiran: [],
    catatan: ''
  });
  const [err, setErr] = useState('');
  const set = (k, v) => setF(p => ({
    ...p,
    [k]: v
  }));
  const setR = (i, k, v) => setF(p => ({
    ...p,
    rincian: p.rincian.map((r, x) => x === i ? {
      ...r,
      [k]: v
    } : r)
  }));
  const total = sum(f.rincian, r => r.jumlah);
  const kirim = () => {
    const rin = f.rincian.filter(r => String(r.desc).trim() && Number(r.jumlah) > 0).map(r => ({
      desc: String(r.desc).trim(),
      jumlah: Number(r.jumlah)
    }));
    if (j === 'gaji' && !f.periode) return setErr('Pilih periode gaji.');
    if (j !== 'gaji' && !f.keperluan.trim()) return setErr('Isi keperluan pembayaran.');
    if (j !== 'gaji' && !f.jenisBiaya) return setErr('Pilih jenis biaya.');
    if (!rin.length) return setErr('Isi minimal satu rincian dengan jumlah lebih dari 0.');
    if (!f.bank.trim() || !f.rekening.trim() || !f.atasNama.trim()) return setErr('Lengkapi bank, nomor rekening, dan atas nama.');
    setErr('');
    ctx.simpanAju({
      ...f,
      keperluan: j === 'gaji' ? `Gaji ${fmtBulan(f.periode)}` : f.keperluan.trim(),
      rincian: rin,
      bank: f.bank.trim(),
      rekening: f.rekening.trim(),
      atasNama: f.atasNama.trim()
    }, editId);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement(Kembali, {
    onClick: () => go('aju', editId ? {
      id: editId
    } : {}),
    teks: "Batal"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    className: "text-xl font-black"
  }, j === 'gaji' ? 'Pengajuan gaji' : 'Pengajuan pembayaran'), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-500"
  }, j === 'gaji' ? 'Diperiksa Manager Operasional, lalu dibayar Direktur.' : 'Langsung ke Direktur untuk dibayar.')), /*#__PURE__*/React.createElement(Seksi, {
    judul: j === 'gaji' ? 'Langkah 1 · Periode gaji' : 'Langkah 1 · Keperluan'
  }, j === 'gaji' ? /*#__PURE__*/React.createElement(Lab, {
    t: "Bulan"
  }, /*#__PURE__*/React.createElement("input", {
    type: "month",
    value: f.periode,
    onChange: e => set('periode', e.target.value),
    className: inp
  })) : /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement(Lab, {
    t: "Keperluan"
  }, /*#__PURE__*/React.createElement("input", {
    value: f.keperluan,
    onChange: e => set('keperluan', e.target.value),
    placeholder: "mis. Pembelian 20 tabung APAR 6 kg",
    className: inp
  })), /*#__PURE__*/React.createElement(Lab, {
    t: "Kategori"
  }, /*#__PURE__*/React.createElement("select", {
    value: f.kategori,
    onChange: e => setF(p => ({
      ...p,
      kategori: e.target.value,
      jenisBiaya: ''
    })),
    className: inp
  }, /*#__PURE__*/React.createElement("option", {
    value: "HPP"
  }, "Pembelian barang (HPP)"), /*#__PURE__*/React.createElement("option", {
    value: "Operasional"
  }, "Beban operasional"))), /*#__PURE__*/React.createElement(Lab, {
    t: "Jenis biaya"
  }, /*#__PURE__*/React.createElement("select", {
    "aria-label": "Jenis biaya",
    value: f.jenisBiaya,
    onChange: e => set('jenisBiaya', e.target.value),
    className: inp
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u2014 Pilih \u2014"), JENIS_BIAYA[f.kategori].map(x => /*#__PURE__*/React.createElement("option", {
    key: x
  }, x)))))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Langkah 2 \xB7 Rincian jumlah"
  }, /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, f.rincian.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "grid grid-cols-[1fr_130px_auto] gap-2 items-center"
  }, /*#__PURE__*/React.createElement("input", {
    "aria-label": `Uraian ${i + 1}`,
    value: r.desc,
    onChange: e => setR(i, 'desc', e.target.value),
    placeholder: "Uraian",
    className: inp
  }), /*#__PURE__*/React.createElement("input", {
    "aria-label": `Jumlah rupiah ${i + 1}`,
    type: "number",
    inputMode: "numeric",
    min: "0",
    value: r.jumlah,
    onChange: e => setR(i, 'jumlah', e.target.value),
    placeholder: "Rp",
    className: inp
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Hapus baris",
    onClick: () => setF(p => ({
      ...p,
      rincian: p.rincian.filter((_, x) => x !== i)
    })),
    className: "text-slate-400"
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.trash,
    size: 18
  })))), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => setF(p => ({
      ...p,
      rincian: [...p.rincian, {
        desc: '',
        jumlah: ''
      }]
    })),
    className: "text-sm font-bold text-red-600"
  }, "+ Tambah baris"), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center pt-2 border-t border-slate-100"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-bold"
  }, "Total"), /*#__PURE__*/React.createElement("span", {
    className: "text-xl font-black tabular-nums"
  }, fmt(total))))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Langkah 3 \xB7 Rekening tujuan"
  }, /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-2"
  }, /*#__PURE__*/React.createElement(Lab, {
    t: "Bank"
  }, /*#__PURE__*/React.createElement("input", {
    value: f.bank,
    onChange: e => set('bank', e.target.value),
    className: inp
  })), /*#__PURE__*/React.createElement(Lab, {
    t: "No. rekening"
  }, /*#__PURE__*/React.createElement("input", {
    inputMode: "numeric",
    value: f.rekening,
    onChange: e => set('rekening', e.target.value),
    className: inp
  }))), /*#__PURE__*/React.createElement(Lab, {
    t: "Atas nama"
  }, /*#__PURE__*/React.createElement("input", {
    value: f.atasNama,
    onChange: e => set('atasNama', e.target.value),
    className: inp
  })))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Langkah 4 \xB7 Lampiran"
  }, /*#__PURE__*/React.createElement(FotoInput, {
    label: j === 'gaji' ? 'Foto absensi / slip lembur' : 'Foto penawaran / invoice',
    list: f.lampiran || [],
    setList: l => set('lampiran', l),
    max: 4
  })), err && /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-rose-600 font-semibold bg-rose-50 border border-rose-200 rounded-xl p-3"
  }, err), /*#__PURE__*/React.createElement("button", {
    onClick: kirim,
    className: btnUtama
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.send
  }), " ", editId ? 'Ajukan ulang' : 'Kirim pengajuan'));
}
function DetailAju(_ref46) {
  let {
    ctx,
    id
  } = _ref46;
  const {
    st,
    me,
    go
  } = ctx;
  const a = st.aju.find(x => x.id === id);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [b, setB] = useState({
    tgl: todayStr(),
    metode: 'Transfer bank',
    ref: '',
    bukti: []
  });
  if (!a) return /*#__PURE__*/React.createElement(Kosong, {
    teks: "Pengajuan tidak ditemukan."
  });
  const pem = userById(a.pemohonId);
  const tahap = a.jenis === 'gaji' ? ['Diajukan', 'Diperiksa Manager', 'Dibayar Direktur'] : ['Diajukan', 'Dibayar Direktur'];
  const posisi = {
    cek_manager: 1,
    menunggu_direktur: a.jenis === 'gaji' ? 2 : 1,
    dibayar: 99
  }[a.status];
  const perlu = fn => {
    if (!note.trim()) {
      setErr('Tulis alasannya dulu.');
      return;
    }
    setErr('');
    fn();
  };
  const kas = a.kasKeluarId ? st.kasKeluar.find(k => k.id === a.kasKeluarId) : null;
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement(Kembali, {
    onClick: () => go('aju')
  }), /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl border border-slate-200 p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-start justify-between gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold text-slate-400"
  }, noDok(a.id), " \xB7 ", a.jenis === 'gaji' ? 'Gaji' : 'Pembayaran'), /*#__PURE__*/React.createElement("h2", {
    className: "text-lg font-black leading-snug"
  }, a.keperluan), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-500"
  }, pem.name, " \xB7 ", ROLES[pem.role])), /*#__PURE__*/React.createElement(Badge, {
    map: ST_AJU,
    status: a.status
  })), /*#__PURE__*/React.createElement("div", {
    className: "text-3xl font-black mt-3 tabular-nums"
  }, fmt(a.total)), posisi && /*#__PURE__*/React.createElement("ol", {
    className: `grid gap-1.5 mt-4 ${tahap.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`
  }, tahap.map((l, i) => {
    const done = posisi > i,
      now = posisi === i;
    return /*#__PURE__*/React.createElement("li", {
      key: l,
      className: "text-center"
    }, /*#__PURE__*/React.createElement("div", {
      className: `h-1.5 rounded-full ${done ? 'bg-emerald-500' : now ? 'bg-red-600' : 'bg-slate-200'}`
    }), /*#__PURE__*/React.createElement("div", {
      className: `text-[11px] font-bold mt-1.5 ${done ? 'text-emerald-700' : now ? 'text-red-700' : 'text-slate-400'}`
    }, l));
  }))), me.role === 'manager' && a.status === 'cek_manager' && /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl border-2 border-red-200 p-4 space-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black uppercase tracking-widest text-red-600"
  }, "Tindakan Anda"), /*#__PURE__*/React.createElement("p", {
    className: "text-sm"
  }, "Periksa rincian gaji dengan absensi dan lembur, lalu teruskan ke Direktur."), /*#__PURE__*/React.createElement("textarea", {
    rows: "2",
    value: note,
    onChange: e => setNote(e.target.value),
    placeholder: "Catatan (wajib jika dikembalikan)",
    className: inp
  }), err && /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-rose-600 font-semibold"
  }, err), /*#__PURE__*/React.createElement("div", {
    className: "flex gap-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => perlu(() => ctx.kembalikan(a.id, note)),
    className: "flex-1 py-3 rounded-xl border border-slate-300 font-bold text-sm"
  }, "Kembalikan"), /*#__PURE__*/React.createElement("button", {
    onClick: () => ctx.teruskan(a.id, note),
    className: "flex-1 py-3 rounded-xl bg-red-600 text-white font-black text-sm"
  }, "Teruskan ke Direktur"))), me.role === 'manager' && a.status === 'menunggu_direktur' && /*#__PURE__*/React.createElement("button", {
    onClick: ctx.ingatkanDirektur,
    className: btnGaris + ' flex items-center justify-center gap-2'
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.send,
    size: 16
  }), " Ingatkan Direktur"), a.status === 'dikembalikan' && a.pemohonId === me.id && /*#__PURE__*/React.createElement("button", {
    onClick: () => go('formAju', {
      editId: a.id
    }),
    className: btnUtama
  }, "Perbaiki & ajukan ulang"), me.role === 'direktur' && a.status === 'menunggu_direktur' && /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl border-2 border-red-200 p-4 space-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black uppercase tracking-widest text-red-600"
  }, "Bayar pengajuan"), /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-50 rounded-xl p-3 text-sm"
  }, /*#__PURE__*/React.createElement(Baris, {
    k: "Ke",
    v: `${a.bank} ${a.rekening}`
  }), /*#__PURE__*/React.createElement(Baris, {
    k: "Atas nama",
    v: a.atasNama
  }), /*#__PURE__*/React.createElement(Baris, {
    k: "Nominal",
    v: fmt(a.total)
  })), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-2"
  }, /*#__PURE__*/React.createElement(Lab, {
    t: "Tanggal bayar"
  }, /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: b.tgl,
    onChange: e => setB({
      ...b,
      tgl: e.target.value
    }),
    className: inp
  })), /*#__PURE__*/React.createElement(Lab, {
    t: "Metode"
  }, /*#__PURE__*/React.createElement("select", {
    value: b.metode,
    onChange: e => setB({
      ...b,
      metode: e.target.value
    }),
    className: inp
  }, /*#__PURE__*/React.createElement("option", null, "Transfer bank"), /*#__PURE__*/React.createElement("option", null, "Tunai")))), b.metode === 'Transfer bank' && /*#__PURE__*/React.createElement(Lab, {
    t: "No. referensi transfer"
  }, /*#__PURE__*/React.createElement("input", {
    value: b.ref,
    onChange: e => setB({
      ...b,
      ref: e.target.value
    }),
    placeholder: "mis. IB-123456",
    className: inp
  })), /*#__PURE__*/React.createElement(FotoInput, {
    label: "Bukti pembayaran",
    list: b.bukti,
    setList: l => setB({
      ...b,
      bukti: l
    }),
    max: 2
  }), /*#__PURE__*/React.createElement("p", {
    className: "text-[11px] text-slate-500"
  }, "Setelah dibayar, transaksi otomatis tercatat di Kas Keluar portal viopran.com (", a.kategori, " \xB7 ", a.jenisBiaya, ")."), /*#__PURE__*/React.createElement("textarea", {
    rows: "2",
    value: note,
    onChange: e => setNote(e.target.value),
    placeholder: "Alasan (wajib jika menolak)",
    className: inp
  }), err && /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-rose-600 font-semibold"
  }, err), /*#__PURE__*/React.createElement("div", {
    className: "flex gap-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => perlu(() => ctx.tolak(a.id, note)),
    className: "flex-1 py-3 rounded-xl border border-slate-300 font-bold text-sm"
  }, "Tolak"), /*#__PURE__*/React.createElement("button", {
    disabled: !b.bukti.length || b.metode === 'Transfer bank' && !b.ref.trim(),
    onClick: () => ctx.bayar(a.id, {
      ...b,
      ref: b.ref.trim()
    }),
    className: "flex-1 py-3 rounded-xl bg-red-600 text-white font-black text-sm disabled:opacity-40"
  }, "Tandai dibayar"))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Rincian"
  }, /*#__PURE__*/React.createElement("table", {
    className: "w-full text-sm"
  }, /*#__PURE__*/React.createElement("tbody", null, a.rincian.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    className: "border-b border-slate-100 last:border-0"
  }, /*#__PURE__*/React.createElement("td", {
    className: "py-2"
  }, r.desc), /*#__PURE__*/React.createElement("td", {
    className: "py-2 text-right font-bold tabular-nums"
  }, fmt(r.jumlah)))), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    className: "pt-2 font-black"
  }, "Total"), /*#__PURE__*/React.createElement("td", {
    className: "pt-2 text-right font-black tabular-nums"
  }, fmt(a.total)))))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Rekening"
  }, /*#__PURE__*/React.createElement(Baris, {
    k: "Bank",
    v: a.bank
  }), /*#__PURE__*/React.createElement(Baris, {
    k: "No. rekening",
    v: a.rekening
  }), /*#__PURE__*/React.createElement(Baris, {
    k: "Atas nama",
    v: a.atasNama
  }), /*#__PURE__*/React.createElement(Baris, {
    k: "Kategori",
    v: `${a.kategori} · ${a.jenisBiaya}`
  })), a.bayar && /*#__PURE__*/React.createElement(Seksi, {
    judul: "Pembayaran"
  }, /*#__PURE__*/React.createElement(Baris, {
    k: "Tanggal",
    v: fmtDate(a.bayar.tgl)
  }), /*#__PURE__*/React.createElement(Baris, {
    k: "Metode",
    v: a.bayar.metode
  }), a.bayar.ref && /*#__PURE__*/React.createElement(Baris, {
    k: "Referensi",
    v: a.bayar.ref
  }), kas && /*#__PURE__*/React.createElement(Baris, {
    k: "Kas Keluar",
    v: `${kas.id} · ${kas.sinkron ? 'tersinkron ke portal' : 'menunggu sinkron'}`
  }), a.bayar.bukti && a.bayar.bukti.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-3 gap-2 mt-2"
  }, a.bayar.bukti.map((x, i) => /*#__PURE__*/React.createElement(Foto, {
    key: i,
    f: x,
    className: "aspect-square object-cover rounded-xl border"
  })))), a.lampiran && a.lampiran.length > 0 && /*#__PURE__*/React.createElement(Seksi, {
    judul: "Lampiran"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-3 gap-2"
  }, a.lampiran.map((x, i) => /*#__PURE__*/React.createElement(Foto, {
    key: i,
    f: x,
    className: "aspect-square object-cover rounded-xl border"
  })))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Riwayat"
  }, /*#__PURE__*/React.createElement(Riwayat, {
    list: a.history
  })));
}
const Riwayat = _ref47 => {
  let {
    list
  } = _ref47;
  return /*#__PURE__*/React.createElement("ol", {
    className: "relative border-l-2 border-slate-200 ml-1.5 space-y-3"
  }, (list || []).map((h, i) => /*#__PURE__*/React.createElement("li", {
    key: i,
    className: "pl-4 relative"
  }, /*#__PURE__*/React.createElement("span", {
    className: "absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-white border-2 border-red-500"
  }), /*#__PURE__*/React.createElement("div", {
    className: "text-sm font-bold"
  }, h.action), /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] text-slate-500"
  }, userById(h.by).name, " \xB7 ", fmtTime(h.t)), h.note && /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-600 mt-0.5"
  }, "\u201C", h.note, "\u201D"))));
};

// ================================================================== kas keluar (sinkron ke website)
function KasKeluar(_ref48) {
  let {
    ctx
  } = _ref48;
  const {
    st
  } = ctx;
  const bln = todayStr().slice(0, 7);
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-xl font-black"
  }, "Kas keluar"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-500"
  }, "Setiap pembayaran yang ditandai Direktur otomatis dicatat di sini dan di portal viopran.com \u2192 menu ", /*#__PURE__*/React.createElement("b", null, "Pengeluaran"), " (kategori & jenis biaya ikut terisi, bukti bayar tersimpan di Drive)."), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-3"
  }, /*#__PURE__*/React.createElement(Kartu, {
    judul: "Bulan ini",
    nilai: fmt(sum(st.kasKeluar.filter(k => k.tgl.startsWith(bln)), k => k.nominal))
  }), /*#__PURE__*/React.createElement(Kartu, {
    judul: "Transaksi",
    nilai: st.kasKeluar.length,
    sub: "semua"
  })), st.kasKeluar.length === 0 ? /*#__PURE__*/React.createElement(Kosong, {
    teks: "Belum ada kas keluar."
  }) : st.kasKeluar.map(k => /*#__PURE__*/React.createElement("button", {
    key: k.id,
    onClick: () => ctx.go('aju', {
      id: k.pengajuanId
    }),
    className: "w-full text-left bg-white rounded-2xl border border-slate-200 p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold text-slate-400"
  }, k.id, " \xB7 ", fmtDate(k.tgl)), /*#__PURE__*/React.createElement("div", {
    className: "font-bold text-sm"
  }, k.deskripsi), /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] text-slate-500"
  }, k.kategori, " \xB7 ", k.jenisBiaya)), /*#__PURE__*/React.createElement("div", {
    className: "font-black text-rose-600 tabular-nums shrink-0"
  }, "\u2212", fmt(k.nominal))), /*#__PURE__*/React.createElement("div", {
    className: "mt-2 text-[11px] font-bold text-emerald-700"
  }, "\u2713 ", k.sinkron ? 'Tercatat di portal (Pengeluaran)' : 'Menunggu terkirim ke server'))));
}

// ================================================================== arsip PDF (Google Drive)
function Arsip(_ref49) {
  let {
    ctx
  } = _ref49;
  const {
    st,
    go
  } = ctx;
  const klien = {};
  const tambah = (k, x) => {
    (klien[k] = klien[k] || []).push(x);
  };
  st.tugas.filter(t => t.status === 'selesai').forEach(t => tambah(t.tempat, {
    nama: t.pdf ? t.pdf.name : `Laporan Pemeriksaan ${noDok(t.id)}`,
    pdf: t.pdf,
    doc: {
      jenis: 'pemeriksaan',
      id: t.id
    },
    tgl: t.selesaiAt || t.tglSelesai
  }));
  st.pekerjaan.forEach(p => tambah(p.konsumen, {
    nama: p.pdf ? p.pdf.name : `Dokumentasi ${p.jenis} ${noDok(p.id)}`,
    pdf: p.pdf,
    doc: {
      jenis: 'pekerjaan',
      id: p.id
    },
    tgl: p.tanggal
  }));
  const nama = Object.keys(klien).sort();
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement(Kembali, {
    onClick: () => go('home')
  }), /*#__PURE__*/React.createElement("h2", {
    className: "text-xl font-black"
  }, "Arsip PDF"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-500"
  }, "Setiap laporan pemeriksaan dan dokumentasi pekerjaan otomatis disimpan sebagai PDF di Google Drive perusahaan: ", /*#__PURE__*/React.createElement("b", null, "NVP Operasional / <nama klien> / Laporan"), ". Ketuk file untuk membuka."), nama.length === 0 ? /*#__PURE__*/React.createElement(Kosong, {
    teks: "Belum ada arsip."
  }) : nama.map(k => /*#__PURE__*/React.createElement(Seksi, {
    key: k,
    judul: k,
    aksi: /*#__PURE__*/React.createElement(Ico, {
      d: I.folder,
      size: 16,
      className: "text-amber-500"
    })
  }, klien[k].map((f, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => f.pdf ? bukaBerkas(f.pdf.fileId, f.pdf.name, ctx.setToast) : ctx.setLaporan(f.doc),
    className: "w-full flex items-center gap-2.5 py-2 text-left text-sm border-b border-slate-100 last:border-0"
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.file,
    size: 18,
    className: `${f.pdf ? 'text-red-600' : 'text-slate-400'} shrink-0`
  }), /*#__PURE__*/React.createElement("span", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("span", {
    className: "block truncate"
  }, f.nama), /*#__PURE__*/React.createElement("span", {
    className: "block text-[11px] text-slate-400"
  }, f.pdf ? 'Tersimpan di Drive' : 'PDF sedang dibuat — ketuk untuk pratinjau')))))));
}

// ================================================================== laporan (tampilan cetak / PDF)
function Laporan(_ref50) {
  let {
    doc,
    st,
    onTutup
  } = _ref50;
  const kop = (judul, nomor) => /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-end border-b-[3px] border-slate-900 pb-3 mb-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3"
  }, /*#__PURE__*/React.createElement("img", {
    src: "icons/icon-192.png",
    alt: "",
    className: "w-12 h-12 rounded-lg"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "font-black text-base leading-tight"
  }, COMPANY.name), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-600"
  }, COMPANY.brand, " \xB7 ", COMPANY.address, " \xB7 ", COMPANY.phone))), /*#__PURE__*/React.createElement("div", {
    className: "text-right"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-black text-sm"
  }, judul), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-600"
  }, nomor)));
  let isi = null,
    nama = '';
  if (doc.jenis === 'pemeriksaan') {
    const t = st.tugas.find(x => x.id === doc.id);
    const lay = t.units.filter(unitLayak).length,
      terisi = t.units.filter(unitTerisi).length;
    nama = `Laporan Pemeriksaan ${t.tempat}`;
    const foto = t.units.flatMap(u => (u.foto || []).map(f => ({
      ...f,
      no: u.no
    })));
    isi = /*#__PURE__*/React.createElement(React.Fragment, null, kop('LAPORAN PEMERIKSAAN APAR', t.id), /*#__PURE__*/React.createElement("table", {
      className: "w-full text-[11px] mb-3"
    }, /*#__PURE__*/React.createElement("tbody", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      className: "w-36 py-0.5 text-slate-600"
    }, "Tempat pemeriksaan"), /*#__PURE__*/React.createElement("td", {
      className: "font-bold"
    }, t.tempat, t.alamat ? ` — ${t.alamat}` : '')), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      className: "py-0.5 text-slate-600"
    }, "Tanggal"), /*#__PURE__*/React.createElement("td", {
      className: "font-bold"
    }, fmtDate(t.tglMulai), " s.d. ", fmtDate(t.tglSelesai))), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      className: "py-0.5 text-slate-600"
    }, "Teknisi"), /*#__PURE__*/React.createElement("td", {
      className: "font-bold"
    }, t.teknisiIds.map(i => userById(i).name).join(', '))), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      className: "py-0.5 text-slate-600"
    }, "Hasil"), /*#__PURE__*/React.createElement("td", {
      className: "font-bold"
    }, t.units.length, " APAR \xB7 ", lay, " layak \xB7 ", terisi - lay, " tidak layak", terisi < t.units.length ? ` · ${t.units.length - terisi} belum diperiksa` : '')))), /*#__PURE__*/React.createElement("div", {
      className: "overflow-x-auto print:overflow-visible"
    }, /*#__PURE__*/React.createElement("table", {
      className: "w-full text-[10px] border-collapse min-w-[640px] print:min-w-0"
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
      className: "bg-slate-100"
    }, ['No', 'Lokasi', 'Type', 'Berat', 'Tekanan', 'Masa berlaku', 'Selang', 'Handle', 'Pin & segel', 'Hasil', 'Keterangan'].map(h => /*#__PURE__*/React.createElement("th", {
      key: h,
      className: "border border-slate-400 px-1 py-1 text-left"
    }, h)))), /*#__PURE__*/React.createElement("tbody", null, t.units.map(u => /*#__PURE__*/React.createElement("tr", {
      key: u.no,
      className: "avoid-break"
    }, /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-1 py-0.5 text-center"
    }, u.no), /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-1"
    }, u.lokasi), /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-1"
    }, u.type.split(' (')[0]), /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-1 whitespace-nowrap"
    }, u.berat), /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-1"
    }, u.tekanan), /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-1 whitespace-nowrap"
    }, u.kedaluwarsa ? fmtDate(u.kedaluwarsa) : ''), /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-1"
    }, u.selang), /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-1"
    }, u.handle), /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-1"
    }, u.pin), /*#__PURE__*/React.createElement("td", {
      className: `border border-slate-300 px-1 font-bold ${unitTerisi(u) ? unitLayak(u) ? 'text-emerald-700' : 'text-rose-700' : ''}`
    }, unitTerisi(u) ? unitLayak(u) ? 'Layak' : 'Tidak layak' : '-'), /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-1"
    }, u.ket)))))), /*#__PURE__*/React.createElement("p", {
      className: "text-[9px] text-slate-500 mt-1.5"
    }, "Kriteria layak: tekanan normal, masa berlaku isi belum lewat, selang/horn tidak retak, handle baik, pin pengaman & segel ada."), foto.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "font-black text-[11px] mt-4 mb-2"
    }, "Dokumentasi"), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-cols-3 gap-2"
    }, foto.map((f, i) => /*#__PURE__*/React.createElement("figure", {
      key: i,
      className: "avoid-break"
    }, /*#__PURE__*/React.createElement(Foto, {
      f: f,
      className: "w-full h-auto border"
    }), /*#__PURE__*/React.createElement("figcaption", {
      className: "text-[9px] text-center"
    }, "APAR no. ", f.no))))));
  } else {
    const p = st.pekerjaan.find(x => x.id === doc.id);
    nama = `Dokumentasi ${p.jenis} ${p.konsumen}`;
    isi = /*#__PURE__*/React.createElement(React.Fragment, null, kop(`DOKUMENTASI ${p.jenis.toUpperCase()} APAR`, p.id), /*#__PURE__*/React.createElement("table", {
      className: "w-full text-[11px] mb-3"
    }, /*#__PURE__*/React.createElement("tbody", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      className: "w-36 py-0.5 text-slate-600"
    }, "Konsumen"), /*#__PURE__*/React.createElement("td", {
      className: "font-bold"
    }, p.konsumen, p.alamat ? ` — ${p.alamat}` : '')), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      className: "py-0.5 text-slate-600"
    }, "Tanggal pengerjaan"), /*#__PURE__*/React.createElement("td", {
      className: "font-bold"
    }, fmtDate(p.tanggal))), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      className: "py-0.5 text-slate-600"
    }, "Teknisi"), /*#__PURE__*/React.createElement("td", {
      className: "font-bold"
    }, userById(p.teknisiId).name)))), /*#__PURE__*/React.createElement("table", {
      className: "w-full text-[11px] border-collapse"
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
      className: "bg-slate-100"
    }, ['No', 'Type APAR', 'Berat', 'Jumlah'].map(h => /*#__PURE__*/React.createElement("th", {
      key: h,
      className: "border border-slate-400 px-2 py-1 text-left"
    }, h)))), /*#__PURE__*/React.createElement("tbody", null, p.rows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
      key: i
    }, /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-2 py-1"
    }, i + 1), /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-2"
    }, r.type), /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-2"
    }, r.berat), /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-2"
    }, r.jumlah, " unit"))), /*#__PURE__*/React.createElement("tr", {
      className: "font-bold"
    }, /*#__PURE__*/React.createElement("td", {
      colSpan: "3",
      className: "border border-slate-300 px-2 py-1 text-right"
    }, "Total"), /*#__PURE__*/React.createElement("td", {
      className: "border border-slate-300 px-2"
    }, sum(p.rows, r => r.jumlah), " unit")))), /*#__PURE__*/React.createElement("div", {
      className: "font-black text-[11px] mt-4 mb-2"
    }, "Foto pengerjaan"), p.foto.length ? /*#__PURE__*/React.createElement("div", {
      className: "grid grid-cols-2 gap-3"
    }, p.foto.map((f, i) => /*#__PURE__*/React.createElement(Foto, {
      key: i,
      f: f,
      className: "w-full h-auto border avoid-break"
    }))) : /*#__PURE__*/React.createElement("p", {
      className: "text-[11px] text-slate-500"
    }, "Tidak ada foto."));
  }
  useEffect(() => {
    const old = document.title;
    document.title = nama;
    return () => {
      document.title = old;
    };
  }, [nama]);
  return /*#__PURE__*/React.createElement("div", {
    className: "min-h-screen bg-slate-300 py-4 overflow-x-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "no-print max-w-[800px] mx-auto px-4 mb-3 flex gap-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onTutup,
    className: "px-4 py-2.5 rounded-xl bg-slate-800 text-white font-bold text-sm"
  }, "Tutup"), /*#__PURE__*/React.createElement("button", {
    onClick: () => window.print(),
    className: "flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white font-black text-sm"
  }, "Cetak / Simpan PDF")), /*#__PURE__*/React.createElement("div", {
    className: "print-page max-w-[800px] mx-auto bg-white p-6 text-slate-900 shadow-lg"
  }, isi, /*#__PURE__*/React.createElement("div", {
    className: "mt-8 flex justify-end text-[11px] avoid-break"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-center w-48"
  }, /*#__PURE__*/React.createElement("p", {
    className: "mb-12 text-slate-600"
  }, "Jakarta, ", fmtDate(todayStr())), /*#__PURE__*/React.createElement("p", {
    className: "font-bold border-b border-slate-800 pb-0.5"
  }, "\xA0"), /*#__PURE__*/React.createElement("p", {
    className: "text-[9px] text-slate-500 font-bold mt-1 uppercase"
  }, "Manager Operasional")))));
}

// ================================================================== notifikasi & akun
function Notifikasi(_ref51) {
  let {
    list,
    buka,
    bacaSemua
  } = _ref51;
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-xl font-black"
  }, "Notifikasi"), list.some(n => !n.read) && /*#__PURE__*/React.createElement("button", {
    onClick: bacaSemua,
    className: "text-xs font-bold text-red-600"
  }, "Tandai semua dibaca")), list.length === 0 ? /*#__PURE__*/React.createElement(Kosong, {
    teks: "Belum ada notifikasi untuk peran ini."
  }) : list.map(n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    onClick: () => buka(n),
    className: `w-full text-left rounded-2xl border p-4 flex gap-3 ${n.read ? 'bg-white border-slate-200' : 'bg-red-50/60 border-red-200'}`
  }, /*#__PURE__*/React.createElement("span", {
    className: `w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${n.read ? 'bg-slate-300' : 'bg-red-600'}`
  }), /*#__PURE__*/React.createElement("span", {
    className: "min-w-0"
  }, /*#__PURE__*/React.createElement("span", {
    className: "block font-bold text-sm"
  }, n.title), /*#__PURE__*/React.createElement("span", {
    className: "block text-xs text-slate-600 mt-0.5 break-words"
  }, n.body), /*#__PURE__*/React.createElement("span", {
    className: "block text-[11px] text-slate-400 mt-1"
  }, fmtTime(n.t))))));
}
function Profil(_ref52) {
  let {
    ctx,
    keluar
  } = _ref52;
  const [panduan, setPanduan] = useState(false);
  const [uji, setUji] = useState(false);
  const {
    me,
    perm,
    sinkron
  } = ctx;
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const android = /android/i.test(navigator.userAgent);
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const statusSinkron = sinkron.status === 'sync' ? 'Menyimpan ke server…' : sinkron.status === 'offline' ? `Tidak ada internet — ${sinkron.antri} perubahan menunggu` : sinkron.antri > 0 ? `${sinkron.antri} perubahan menunggu` : 'Semua data tersimpan di server';
  const tes = async () => {
    setUji(true);
    await ctx.tesNotif();
    setUji(false);
  };
  const minta = async () => {
    if (iOS && !standalone) {
      ctx.setToast('Di iPhone, pasang aplikasi ke Layar Utama dulu, lalu buka dari ikon NVP Ops.');
      return;
    }
    await ctx.mintaIzin();
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-xl font-black"
  }, "Akun & pengaturan"), /*#__PURE__*/React.createElement("section", {
    className: "bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-12 h-12 rounded-full bg-red-600 text-white flex items-center justify-center font-black text-lg"
  }, me.name[0]), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-black truncate"
  }, me.name), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-500"
  }, ROLES[me.role], " \xB7 ", /*#__PURE__*/React.createElement("span", {
    className: "font-mono"
  }, me.username)))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Notifikasi HP"
  }, /*#__PURE__*/React.createElement("div", {
    className: "space-y-3 text-sm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between gap-3"
  }, /*#__PURE__*/React.createElement("span", null, "Status: ", /*#__PURE__*/React.createElement("b", {
    className: perm === 'granted' ? 'text-emerald-700' : 'text-rose-600'
  }, perm === 'granted' ? 'Aktif' : perm === 'denied' ? 'Diblokir' : perm === 'unsupported' ? 'Belum didukung' : 'Belum diizinkan')), perm !== 'granted' && perm !== 'denied' && /*#__PURE__*/React.createElement("button", {
    onClick: minta,
    className: "px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold"
  }, "Izinkan notifikasi")), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-600"
  }, "Jika aktif, pemberitahuan (tugas baru, pengajuan, pembayaran) ", /*#__PURE__*/React.createElement("b", null, "muncul di layar HP walau HP terkunci atau aplikasi ditutup"), ", lengkap dengan suara/getar."), perm === 'denied' && /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-rose-600"
  }, "Notifikasi diblokir. Buka ", /*#__PURE__*/React.createElement("b", null, "Pengaturan HP \u2192 Aplikasi \u2192 NVP Ops (atau Chrome) \u2192 Notifikasi"), " lalu izinkan, kemudian buka aplikasi lagi."), perm === 'granted' && /*#__PURE__*/React.createElement("button", {
    onClick: tes,
    disabled: uji,
    className: btnGaris
  }, uji ? 'Mengirim…' : 'Kirim notifikasi uji ke HP ini'), perm === 'granted' && /*#__PURE__*/React.createElement("p", {
    className: "text-[11px] text-slate-500"
  }, "Setelah menekan tombol uji, kunci layar HP \u2014 notifikasi akan muncul dalam beberapa detik."), android && /*#__PURE__*/React.createElement("p", {
    className: "text-[11px] text-slate-500"
  }, /*#__PURE__*/React.createElement("b", null, "Tips Android:"), " agar notifikasi tidak terlambat, buka Pengaturan \u2192 Baterai \u2192 pilih ", /*#__PURE__*/React.createElement("b", null, "Chrome"), " (dan NVP Ops) \u2192 ", /*#__PURE__*/React.createElement("b", null, "Tidak dibatasi / Jangan optimalkan"), "."), iOS && /*#__PURE__*/React.createElement("p", {
    className: "text-[11px] text-slate-500"
  }, /*#__PURE__*/React.createElement("b", null, "iPhone:"), " notifikasi hanya bekerja jika aplikasi dipasang ke Layar Utama dan dibuka dari ikonnya (iOS 16.4 ke atas)."))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Pasang di HP"
  }, standalone ? /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-emerald-700 font-semibold"
  }, "\u2713 Aplikasi sudah terpasang di HP ini.") : ctx.installEvt ? /*#__PURE__*/React.createElement("button", {
    onClick: ctx.pasang,
    className: "w-full py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm"
  }, "Pasang aplikasi") : /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-slate-600"
  }, iOS ? /*#__PURE__*/React.createElement(React.Fragment, null, "Buka ", /*#__PURE__*/React.createElement("b", null, "viopran.com/app"), " di ", /*#__PURE__*/React.createElement("b", null, "Safari"), " \u2192 tombol ", /*#__PURE__*/React.createElement("b", null, "Bagikan"), " (kotak dengan panah) \u2192 ", /*#__PURE__*/React.createElement("b", null, "Tambah ke Layar Utama"), ".") : /*#__PURE__*/React.createElement(React.Fragment, null, "Chrome: menu ", /*#__PURE__*/React.createElement("b", null, "\u22EE"), " \u2192 ", /*#__PURE__*/React.createElement("b", null, "Instal aplikasi"), " / ", /*#__PURE__*/React.createElement("b", null, "Tambahkan ke layar utama"), "."))), /*#__PURE__*/React.createElement(Seksi, {
    judul: "Data"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-sm"
  }, /*#__PURE__*/React.createElement("b", {
    className: sinkron.status === 'offline' || sinkron.antri ? 'text-amber-700' : 'text-emerald-700'
  }, statusSinkron)), sinkron.waktu && /*#__PURE__*/React.createElement("p", {
    className: "text-[11px] text-slate-500 mt-0.5"
  }, "Terakhir diperbarui ", new Date(sinkron.waktu).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit'
  })), /*#__PURE__*/React.createElement("p", {
    className: "text-[11px] text-slate-500 mt-1.5"
  }, "Data disimpan di server perusahaan dan tersambung dengan portal viopran.com. Saat tidak ada sinyal, pekerjaan tetap bisa diisi dan dikirim otomatis begitu internet kembali."), /*#__PURE__*/React.createElement("button", {
    onClick: () => ctx.kirim(true),
    className: btnGaris + ' mt-2'
  }, "Muat ulang data")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setPanduan(!panduan),
    className: "w-full flex items-center gap-3 bg-white rounded-2xl border border-slate-200 p-4 text-left"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center"
  }, /*#__PURE__*/React.createElement(Ico, {
    d: I.help
  })), /*#__PURE__*/React.createElement("span", {
    className: "flex-1"
  }, /*#__PURE__*/React.createElement("b", {
    className: "block text-sm"
  }, "Panduan penggunaan"), /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-slate-500"
  }, "Langkah kerja untuk ", ROLES[me.role])), /*#__PURE__*/React.createElement(Ico, {
    d: I.chev,
    className: `text-slate-400 ${panduan ? 'rotate-90' : ''}`
  })), panduan && /*#__PURE__*/React.createElement(Panduan, {
    role: me.role
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      const msg = sinkron.antri > 0 ? `Masih ada ${sinkron.antri} perubahan yang belum terkirim dan akan hilang. Tetap keluar?` : 'Keluar dari akun ini? HP ini tidak akan menerima notifikasi akun ini lagi.';
      if (confirm(msg)) keluar();
    },
    className: "w-full py-3 rounded-2xl border border-rose-300 text-rose-700 font-bold text-sm"
  }, "Keluar"), /*#__PURE__*/React.createElement("p", {
    className: "text-center text-[11px] text-slate-400"
  }, "NVP Operasional \xB7 PT Nuri Vira Pratama"));
}
ReactDOM.createRoot(document.getElementById('root')).render( /*#__PURE__*/React.createElement(App, null));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));