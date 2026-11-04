'use strict';
/*
 * Eigene Zertifizierungsstelle (CA) und HTTPS-Zertifikat für die Bridge – ohne externe Programme.
 *
 * Damit die EBuLa auch von einer https-Webseite (z. B. Vercel) aus mit der Bridge sprechen darf,
 * braucht die Bridge einen https-Zugang. Dafür erzeugt sie beim ersten Start eine eigene CA
 * (wird einmal auf dem iPad/Handy installiert) und bei jedem Start ein Serverzertifikat für die
 * aktuellen IP-Adressen des PCs, unterschrieben von dieser CA.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- DER-Kodierung (ASN.1)
function len(n) {
  if (n < 128) return Buffer.from([n]);
  const b = [];
  while (n) { b.unshift(n & 255); n = Math.floor(n / 256); }
  return Buffer.from([0x80 | b.length, ...b]);
}
function tlv(tag, ...content) {
  const c = Buffer.concat(content.flat());
  return Buffer.concat([Buffer.from([tag]), len(c.length), c]);
}
const seq = (...c) => tlv(0x30, ...c);
const set = (...c) => tlv(0x31, ...c);
const ctx = (n, ...c) => tlv(0xa0 | n, ...c);
const octet = (b) => tlv(0x04, b);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const NULL = Buffer.from([0x05, 0x00]);
function int(b) {
  if (typeof b === 'number') b = Buffer.from([b]);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
function oid(str) {
  const p = str.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const s = [v & 0x7f];
    let x = Math.floor(v / 128);
    while (x) { s.unshift(0x80 | (x & 0x7f)); x = Math.floor(x / 128); }
    out.push(...s);
  }
  return tlv(0x06, Buffer.from(out));
}
function time(d) {
  const p = (n) => String(n).padStart(2, '0');
  const rest = p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
  const y = d.getUTCFullYear();
  return y < 2050 ? tlv(0x17, Buffer.from(String(y).slice(2) + rest)) : tlv(0x18, Buffer.from(y + rest));
}
// BIT STRING für keyUsage: Bitnummern wie in RFC 5280 (0 = digitalSignature …)
function keyUsageBits(bits) {
  let v = 0, last = 0;
  for (const b of bits) { v |= 0x80 >> b; last = Math.max(last, b); }
  return tlv(0x03, Buffer.from([7 - last, v]));
}
function ipBytes(ip) {
  return Buffer.from(ip.split('.').map(Number));
}
const SHA256_RSA = seq(oid('1.2.840.113549.1.1.11'), NULL);
const name = (cn) => seq(set(seq(oid('2.5.4.10'), utf8('Nussy EBuLa'))), set(seq(oid('2.5.4.3'), utf8(cn))));
const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octet(value));
function keyId(publicKey) {
  // SHA-1 über den öffentlichen Schlüssel (RFC 5280, Methode 1)
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha1').update(spki).digest();
}

function makeCert({ subjectCn, issuerCn, publicKey, signKey, issuerKey, days, ca, ips = [], dns = [] }) {
  const now = Date.now();
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  const exts = [
    ext('2.5.29.19', true, ca ? seq(bool(true)) : seq()),
    ext('2.5.29.15', true, keyUsageBits(ca ? [5, 6] : [0, 2])),
    ext('2.5.29.14', false, octet(keyId(publicKey))),
  ];
  if (!ca) {
    exts.push(ext('2.5.29.35', false, seq(tlv(0x80, keyId(issuerKey)))));
    exts.push(ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))));
    exts.push(ext('2.5.29.17', false, seq(...dns.map((d) => tlv(0x82, Buffer.from(d))), ...ips.map((ip) => tlv(0x87, ipBytes(ip))))));
  }
  const tbs = seq(
    ctx(0, int(2)),
    int(serial),
    SHA256_RSA,
    name(issuerCn),
    seq(time(new Date(now - 24 * 3600e3)), time(new Date(now + days * 24 * 3600e3))),
    name(subjectCn),
    publicKey.export({ type: 'spki', format: 'der' }),
    ctx(3, seq(...exts)),
  );
  const sig = crypto.sign('sha256', tbs, signKey);
  return seq(tbs, SHA256_RSA, tlv(0x03, Buffer.from([0]), sig));
}
const pem = (der, label) => `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;

// ---------------------------------------------------------------- CA laden/erzeugen, Serverzertifikat ausstellen
const CA_NAME = 'Nussy EBuLa Bridge CA';
function loadOrCreateCa(dir) {
  const keyFile = path.join(dir, 'ca-schluessel.pem'), certFile = path.join(dir, 'ca-zertifikat.pem');
  try {
    const key = crypto.createPrivateKey(fs.readFileSync(keyFile));
    const certPem = fs.readFileSync(certFile, 'utf8');
    return { key, certPem, der: new crypto.X509Certificate(certPem).raw, neu: false };
  } catch { /* neu erzeugen */ }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = makeCert({ subjectCn: CA_NAME, issuerCn: CA_NAME, publicKey, signKey: privateKey, issuerKey: publicKey, days: 3650, ca: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(certFile, pem(der, 'CERTIFICATE'));
  return { key: privateKey, certPem: pem(der, 'CERTIFICATE'), der, neu: true };
}

function serverCert(ca, ips) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const caPub = crypto.createPublicKey(ca.key);
  // Apple verlangt für Serverzertifikate höchstens 825 Tage; die Bridge stellt bei jedem Start neu aus
  const der = makeCert({ subjectCn: ips[0] || 'localhost', issuerCn: CA_NAME, publicKey, signKey: ca.key, issuerKey: caPub, days: 390, ca: false, ips: ['127.0.0.1', ...ips], dns: ['localhost'] });
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem(der, 'CERTIFICATE') + ca.certPem };
}

module.exports = { loadOrCreateCa, serverCert, makeCert, pem };
