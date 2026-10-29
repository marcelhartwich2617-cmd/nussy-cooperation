#!/usr/bin/env node
/*
 * Nussy EBuLa – Bridge zwischen Zusi 3 (TCP-Server, Port 1436) und der
 * Fahrplananzeige im Browser (iPad, Tablet, zweiter Monitor …).
 *
 *  Zusi 3  --TCP-->  bridge.js  --HTTP / Server-Sent Events-->  Browser
 *
 * Keine externen Abhängigkeiten – nur Node.js (ab Version 16) wird benötigt.
 *   Start:  node bridge.js            (oder start.bat doppelklicken)
 *   Optionen: --zusi 192.168.0.10:1436   --port 8080   --debug
 */
'use strict';

const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

// ---------------------------------------------------------------- Konfiguration
const DEFAULTS = {
  zusiHost: '127.0.0.1',
  zusiPort: 1436,
  httpPort: 8080,
  clientName: 'Nussy EBuLa',
  // Führerstandsanzeigen (DATA_FTD), die angefordert werden
  fsIds: [
    0x0001, // Geschwindigkeit m/s
    0x0010, 0x0011, 0x0012, // Uhrzeit Stunde/Minute/Sekunde (Zeigerstellung)
    0x0017, // AFB-Sollgeschwindigkeit m/s
    0x0019, // Zurückgelegter Gesamtweg m
    0x0023, // Uhrzeit digital (0…1 = 0:00…24:00)
    0x004B, // Datum (Tage seit 30.12.1899)
    0x004D, // Streckenhöchstgeschwindigkeit m/s
    0x0061, // Kilometrierung Zugspitze km
  ],
  extraFsIds: [],
  // Programmdaten (DATA_PROG): Zugdatei, Zugnummer, Ladepause, Buchfahrplan (XML)
  progIds: [0x0001, 0x0002, 0x0003, 0x0004],
  // Zusätzliche Zusi-Datenverzeichnisse für die Suche nach *.timetable.xml
  datenVerzeichnisse: [],
};

function loadConfig() {
  const cfg = { ...DEFAULTS };
  const file = path.join(__dirname, 'config.json');
  try {
    Object.assign(cfg, JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[config] config.json konnte nicht gelesen werden:', e.message);
  }
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--zusi' && argv[i + 1]) {
      const [h, p] = argv[++i].split(':');
      cfg.zusiHost = h || cfg.zusiHost;
      if (p) cfg.zusiPort = +p;
    } else if (a === '--port' && argv[i + 1]) cfg.httpPort = +argv[++i];
    else if (a === '--debug') cfg.debug = true;
  }
  return cfg;
}
const cfg = loadConfig();

// ---------------------------------------------------------------- Zustand
const state = {
  zusi: { connected: false, version: '', info: '', error: '', since: null },
  ftd: {}, // id -> Wert
  ftdSeen: {}, // id -> Länge des Attributs (Debug)
  prog: { zugdatei: '', zugnummer: '', ladepause: null, xml: '', xmlSource: '', xmlRev: 0 },
};

// ---------------------------------------------------------------- Zusi-Binärprotokoll
// Knoten:   00 00 00 00 | ID (2 Byte)  …Inhalt…  FF FF FF FF
// Attribut: Länge (4 Byte, inkl. ID) | ID (2 Byte) | Daten
const NODE_START = Buffer.from([0, 0, 0, 0]);
const NODE_END = Buffer.from([0xff, 0xff, 0xff, 0xff]);

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function node(id, ...children) { return Buffer.concat([NODE_START, u16(id), ...children, NODE_END]); }
function attr(id, data) {
  const head = Buffer.alloc(6);
  head.writeUInt32LE(data.length + 2, 0);
  head.writeUInt16LE(id, 4);
  return Buffer.concat([head, data]);
}
const attrWord = (id, v) => attr(id, u16(v));
const attrStr = (id, s) => attr(id, Buffer.from(s, 'latin1'));

class ZusiParser {
  constructor(onNode) { this.onNode = onNode; this.reset(); }
  reset() { this.buf = Buffer.alloc(0); this.stack = []; }
  push(chunk) {
    let buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    let off = 0;
    for (;;) {
      if (buf.length - off < 4) break;
      const len = buf.readUInt32LE(off);
      if (len === 0) {
        if (buf.length - off < 6) break;
        const n = { id: buf.readUInt16LE(off + 4), attrs: [], nodes: [] };
        if (this.stack.length) this.stack[this.stack.length - 1].nodes.push(n);
        this.stack.push(n);
        off += 6;
      } else if (len === 0xffffffff) {
        off += 4;
        const n = this.stack.pop();
        if (n && !this.stack.length) this.onNode(n);
      } else {
        if (len < 2 || len > 64 * 1024 * 1024) throw new Error('Ungültige Attributlänge ' + len);
        if (buf.length - off < 4 + len) break;
        const id = buf.readUInt16LE(off + 4);
        const data = Buffer.from(buf.subarray(off + 6, off + 4 + len));
        if (this.stack.length) this.stack[this.stack.length - 1].attrs.push({ id, data });
        off += 4 + len;
      }
    }
    this.buf = Buffer.from(buf.subarray(off));
  }
}

function decodeString(data) {
  let s = data.toString('utf8');
  if (s.includes('\uFFFD')) s = data.toString('latin1'); // Zusi schreibt teils ANSI
  return s.replace(/^\uFEFF/, '').replace(/\0+$/, '');
}
const findAttr = (n, id) => n.attrs.find((a) => a.id === id);
const findNode = (n, id) => n.nodes.find((c) => c.id === id);

// ---------------------------------------------------------------- Verbindung zu Zusi
let sock = null;
let reconnectTimer = null;
let xmlFallbackTimer = null;

function connectZusi() {
  clearTimeout(reconnectTimer);
  if (sock) sock.destroy();
  const s = new net.Socket();
  sock = s;
  const parser = new ZusiParser(handleNode);
  s.setNoDelay(true);
  s.connect(cfg.zusiPort, cfg.zusiHost, () => {
    log(`TCP verbunden mit ${cfg.zusiHost}:${cfg.zusiPort} – sende HELLO`);
    s.write(node(0x0001, node(0x0001,
      attrWord(0x0001, 2), // Protokollversion
      attrWord(0x0002, 2), // Client-Typ: Fahrpult
      attrStr(0x0003, cfg.clientName),
      attrStr(0x0004, '1.0'))));
  });
  s.on('data', (chunk) => {
    try { parser.push(chunk); } catch (e) {
      log('Protokollfehler: ' + e.message);
      s.destroy();
    }
  });
  s.on('error', (e) => {
    if (state.zusi.error !== e.code) log(`Zusi nicht erreichbar (${e.code || e.message}) – neuer Versuch alle 3 s`);
    state.zusi.error = e.code || e.message;
  });
  s.on('close', () => {
    if (sock !== s) return;
    if (state.zusi.connected) log('Verbindung zu Zusi getrennt');
    state.zusi.connected = false;
    state.ftd = {};
    broadcastStatus();
    reconnectTimer = setTimeout(connectZusi, 3000);
  });
}

function handleNode(n) {
  if (n.id === 0x0001) {
    const ack = findNode(n, 0x0002);
    if (!ack) return;
    const result = findAttr(ack, 0x0003);
    if (result && result.data[0] !== 0) {
      log('Zusi hat die Anmeldung abgelehnt (Ergebnis ' + result.data[0] + ')');
      return;
    }
    state.zusi.version = findAttr(ack, 0x0001) ? decodeString(findAttr(ack, 0x0001).data) : '';
    state.zusi.info = findAttr(ack, 0x0002) ? decodeString(findAttr(ack, 0x0002).data) : '';
    log(`Angemeldet bei Zusi ${state.zusi.version} – fordere Daten an`);
    const ids = [...new Set([...cfg.fsIds, ...cfg.extraFsIds])];
    sock.write(node(0x0002, node(0x0003,
      node(0x000A, ...ids.map((id) => attrWord(0x0001, id))),
      node(0x000C, ...cfg.progIds.map((id) => attrWord(0x0001, id))))));
    return;
  }
  if (n.id !== 0x0002) return;
  for (const c of n.nodes) {
    if (c.id === 0x0004) {
      const r = findAttr(c, 0x0001);
      if (r && r.data[0] !== 0) log('Zusi meldet Fehler bei der Datenanforderung: ' + r.data[0]);
      state.zusi.connected = true;
      state.zusi.error = '';
      state.zusi.since = Date.now();
      log('Datenverbindung aktiv ✔');
      broadcastStatus();
    } else if (c.id === 0x000A) {
      for (const a of c.attrs) {
        state.ftdSeen[a.id] = a.data.length;
        if (a.data.length === 4) state.ftd[a.id] = a.data.readFloatLE(0);
        else if (a.data.length === 8) state.ftd[a.id] = a.data.readDoubleLE(0);
        else if (a.data.length === 2) state.ftd[a.id] = a.data.readUInt16LE(0);
        else if (a.data.length === 1) state.ftd[a.id] = a.data[0];
      }
      for (const sub of c.nodes) state.ftdSeen[sub.id] = 'Knoten';
      scheduleFtd();
    } else if (c.id === 0x000C) {
      handleProg(c);
    }
  }
}

function handleProg(c) {
  let changed = false;
  for (const a of c.attrs) {
    if (a.id === 0x0001) {
      const zd = decodeString(a.data);
      if (zd !== state.prog.zugdatei) {
        state.prog.zugdatei = zd;
        state.prog.xmlSource = '';
        changed = true;
        log('Zugdatei: ' + zd);
        clearTimeout(xmlFallbackTimer);
        // Falls Zusi den Buchfahrplan nicht mitschickt: von der Festplatte lesen
        xmlFallbackTimer = setTimeout(() => loadTimetableFromDisk(zd), 2500);
      }
    } else if (a.id === 0x0002) {
      state.prog.zugnummer = decodeString(a.data);
      changed = true;
      log('Zugnummer: ' + state.prog.zugnummer);
    } else if (a.id === 0x0003) {
      state.prog.ladepause = a.data.length >= 2 ? a.data.readUInt16LE(0) : a.data[0];
      changed = true;
    } else if (a.id === 0x0004) {
      const xml = decodeString(a.data);
      if (xml.trim()) {
        clearTimeout(xmlFallbackTimer);
        setXml(xml, 'Zusi');
        changed = true;
      }
    }
  }
  if (changed) broadcastProg();
}

function setXml(xml, source) {
  if (xml === state.prog.xml) return;
  state.prog.xml = xml;
  state.prog.xmlSource = source;
  state.prog.xmlRev++;
  log(`Buchfahrplan erhalten (${source}, ${Math.round(xml.length / 1024)} kB)`);
}

// ---------------------------------------------------------------- Buchfahrplan von der Festplatte
let dataDirsCache = null;
function regQuery(key) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('');
    execFile('reg', ['query', key, '/s'], { windowsHide: true }, (err, out) => resolve(err ? '' : out));
  });
}
async function zusiDataDirs() {
  if (dataDirsCache) return dataDirsCache;
  const dirs = [...cfg.datenVerzeichnisse];
  for (const key of ['HKLM\\SOFTWARE\\Zusi3', 'HKLM\\SOFTWARE\\WOW6432Node\\Zusi3', 'HKCU\\SOFTWARE\\Zusi3']) {
    const out = await regQuery(key);
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s+(\S*Verzeichnis\S*|\S*Dir\S*)\s+REG_(?:EXPAND_)?SZ\s+(.+)$/i);
      if (m) dirs.push(m[2].trim());
    }
  }
  const pub = process.env.PUBLIC || 'C:\\Users\\Public';
  dirs.push(
    path.join(pub, 'Documents', 'Zusi3', '_ZusiData'),
    path.join(pub, 'Documents', 'Zusi3'),
    'C:\\Program Files\\Zusi3\\_ZusiData',
    'C:\\Program Files (x86)\\Zusi3\\_ZusiData',
    path.join(os.homedir(), 'Documents', 'Zusi3', '_ZusiData'),
  );
  dataDirsCache = [...new Set(dirs)];
  return dataDirsCache;
}

async function loadTimetableFromDisk(zugdatei) {
  if (!zugdatei || state.prog.xmlSource === 'Zusi') return;
  const rel = zugdatei.replace(/[\\/]+/g, path.sep);
  const candidates = [];
  const bases = path.isAbsolute(rel) ? [''] : await zusiDataDirs();
  for (const base of bases) {
    const p = base ? path.join(base, rel) : rel;
    candidates.push(p.replace(/\.trn$/i, '.timetable.xml'), p);
  }
  for (const file of candidates) {
    try {
      const xml = fs.readFileSync(file, 'utf8');
      setXml(xml, file.toLowerCase().endsWith('.trn') ? 'Zugdatei (.trn)' : 'Datei');
      return broadcastProg();
    } catch { /* nächster Kandidat */ }
  }
  log('Kein Buchfahrplan zur Zugdatei gefunden – Datei ggf. in der Anzeige manuell laden');
}

// ---------------------------------------------------------------- HTTP + Server-Sent Events
const clients = new Set();
function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(event, data) { for (const res of clients) send(res, event, data); }
function statusPayload() {
  return { zusi: state.zusi.connected, version: state.zusi.version, info: state.zusi.info, error: state.zusi.error, host: `${cfg.zusiHost}:${cfg.zusiPort}` };
}
function progPayload(withXml = true) {
  const p = { zugdatei: state.prog.zugdatei, zugnummer: state.prog.zugnummer, ladepause: state.prog.ladepause, xmlRev: state.prog.xmlRev, xmlSource: state.prog.xmlSource };
  if (withXml) p.xml = state.prog.xml;
  return p;
}
const broadcastStatus = () => broadcast('status', statusPayload());
const broadcastProg = () => broadcast('prog', progPayload());
let ftdTimer = null;
function scheduleFtd() {
  if (ftdTimer) return;
  ftdTimer = setTimeout(() => { ftdTimer = null; broadcast('ftd', state.ftd); }, 150);
}

const PUBLIC = path.join(__dirname, 'public');
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8',
};
const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Ungültige Adresse');
  }
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (url.pathname === '/events') {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    send(res, 'status', statusPayload());
    send(res, 'prog', progPayload());
    send(res, 'ftd', state.ftd);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/state') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ status: statusPayload(), prog: progPayload(false), ftd: state.ftd, ftdSeen: state.ftdSeen, bridge: 'nussy-ebula' }));
  }
  if (url.pathname === '/api/reconnect' && req.method === 'POST') {
    connectZusi();
    res.writeHead(204, cors);
    return res.end();
  }
  if (url.pathname === '/debug') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(DEBUG_HTML);
  }
  // Statische Dateien der Anzeige (index.html, Manifest, Icons …)
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (/^[\w.-]+$/.test(name) && STATIC_TYPES[path.extname(name)]) {
    fs.readFile(path.join(PUBLIC, name), (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(name + ' fehlt'); }
      res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(name)], 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Nicht gefunden');
});
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);

const DEBUG_HTML = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EBuLa Bridge – Diagnose</title><style>body{font:14px system-ui,sans-serif;background:#111;color:#eee;margin:16px}
table{border-collapse:collapse}td,th{border:1px solid #444;padding:4px 10px;text-align:left}th{background:#222}code{color:#9cf}</style></head>
<body><h2>EBuLa Bridge – Diagnose</h2><div id="s"></div><h3>Führerstandsanzeigen (DATA_FTD)</h3>
<table><thead><tr><th>ID (hex)</th><th>ID (dez)</th><th>Wert</th></tr></thead><tbody id="t"></tbody></table>
<h3>Programmdaten</h3><pre id="p"></pre><script>
const names={1:'Geschwindigkeit m/s',16:'Uhr Stunde',17:'Uhr Minute',18:'Uhr Sekunde',23:'AFB-Soll m/s',25:'Gesamtweg m',35:'Uhrzeit digital',75:'Datum',77:'Streckenhöchstgeschw. m/s',97:'Kilometrierung km'};
async function tick(){try{const r=await fetch('/api/state');const j=await r.json();
document.getElementById('s').innerHTML='Zusi: <b>'+(j.status.zusi?'verbunden':'nicht verbunden')+'</b> '+j.status.version+' ('+j.status.host+') '+(j.status.error||'');
const ids=Object.keys(j.ftdSeen).map(Number).sort((a,b)=>a-b);
document.getElementById('t').innerHTML=ids.map(id=>'<tr><td><code>0x'+id.toString(16).padStart(4,'0').toUpperCase()+'</code></td><td>'+id+'</td><td>'+(j.ftd[id]!==undefined?(+j.ftd[id]).toFixed(4):j.ftdSeen[id])+' <small>'+(names[id]||'')+'</small></td></tr>').join('');
document.getElementById('p').textContent=JSON.stringify(j.prog,null,2);}catch(e){document.getElementById('s').textContent='Bridge nicht erreichbar'}}
setInterval(tick,500);tick();</script></body></html>`;

// ---------------------------------------------------------------- Start
function log(msg) { console.log(`[${new Date().toLocaleTimeString('de-DE')}] ${msg}`); }

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

if (require.main === module) {
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${cfg.httpPort} ist belegt – andere Portnummer mit --port wählen.` : e.message);
    process.exit(1);
  });
  server.listen(cfg.httpPort, () => {
    console.log('==============================================================');
    console.log('  Nussy EBuLa – Fahrplananzeige für Zusi 3');
    console.log('==============================================================');
    console.log(`  Auf diesem PC:      http://localhost:${cfg.httpPort}`);
    for (const ip of lanAddresses()) console.log(`  Auf iPad/Tablet:    http://${ip}:${cfg.httpPort}`);
    console.log(`  Diagnose:           http://localhost:${cfg.httpPort}/debug`);
    console.log(`  Zusi TCP-Server:    ${cfg.zusiHost}:${cfg.zusiPort}`);
    console.log('==============================================================');
    connectZusi();
  });
}

module.exports = { ZusiParser, node, attr, attrWord, attrStr };
