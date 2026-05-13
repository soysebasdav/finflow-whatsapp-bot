require('dotenv').config();
const fs = require('fs');
const express = require('express');
const qrcode = require('qrcode-terminal');
const qrcodeSvg = require('qrcode');
const sharp = require('sharp');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const PORT = Number(process.env.PORT || 3100);
const BOT_API_TOKEN = String(process.env.BOT_API_TOKEN || '');
const HEADLESS = String(process.env.HEADLESS || 'true').toLowerCase() !== 'false';
const WWEBJS_DATA_PATH = String(process.env.WWEBJS_DATA_PATH || './.wwebjs_auth');
const PUPPETEER_EXECUTABLE_PATH = String(process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();

fs.mkdirSync(WWEBJS_DATA_PATH, { recursive: true });

const app = express();
app.use(express.json({ limit: '2mb' }));

let currentQr = null;
let lastKnownState = 'initializing';

const puppeteerOptions = {
  headless: HEADLESS,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
  ]
};

if (PUPPETEER_EXECUTABLE_PATH !== '') {
  puppeteerOptions.executablePath = PUPPETEER_EXECUTABLE_PATH;
}

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: process.env.WWEBJS_CLIENT_ID || 'finflow-main',
    dataPath: WWEBJS_DATA_PATH
  }),
  puppeteer: puppeteerOptions
});

client.on('qr', (qr) => {
  currentQr = qr;
  lastKnownState = 'qr';
  qrcode.generate(qr, { small: true });
  console.log('Escanea este QR con el número-bot de WhatsApp.');
});

client.on('ready', () => {
  currentQr = null;
  lastKnownState = 'ready';
  console.log('WhatsApp bot listo.');
});

client.on('authenticated', () => {
  lastKnownState = 'authenticated';
  console.log('Sesión autenticada.');
});

client.on('auth_failure', (msg) => {
  lastKnownState = 'auth_failure';
  console.error('Fallo de autenticación:', msg);
});

client.on('disconnected', (reason) => {
  lastKnownState = 'disconnected';
  console.warn('Bot desconectado:', reason);
});

function requireAuth(req, res, next) {
  if (!BOT_API_TOKEN) {
    return next();
  }

  const header = req.headers.authorization || '';
  if (header === `Bearer ${BOT_API_TOKEN}`) {
    return next();
  }

  return res.status(401).json({ ok: false, error: 'unauthorized' });
}

function requireBrowserAuth(req, res, next) {
  if (!BOT_API_TOKEN) {
    return next();
  }

  const header = req.headers.authorization || '';
  const token = String(req.query.token || '');
  if (header === `Bearer ${BOT_API_TOKEN}` || token === BOT_API_TOKEN) {
    return next();
  }

  return res.status(401).send('No autorizado. Abre esta URL usando ?token=TU_TOKEN o envía Authorization: Bearer TU_TOKEN.');
}

function extractInviteCode(raw) {
  if (!raw) return null;
  const value = String(raw).trim();
  const match = value.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i);
  return match ? match[1] : null;
}

async function resolveGroup(groupTarget, groupName) {
  const target = String(groupTarget || '').trim();
  const name = String(groupName || '').trim();

  if (target.endsWith('@g.us')) {
    return client.getChatById(target);
  }

  const inviteCode = extractInviteCode(target);
  if (inviteCode) {
    try {
      const chatId = await client.acceptInvite(inviteCode);
      return client.getChatById(chatId);
    } catch (error) {
      console.warn('No se pudo unir por invitación. Se intentará ubicar el grupo existente.', error.message);
    }
  }

  const chats = await client.getChats();
  const groups = chats.filter((chat) => chat.isGroup);

  if (target) {
    const direct = groups.find((chat) => chat.id && chat.id._serialized === target);
    if (direct) return direct;
  }

  if (name) {
    const byName = groups.find((chat) => String(chat.name || '').trim().toLowerCase() === name.toLowerCase());
    if (byName) return byName;
  }

  if (target && !inviteCode) {
    const fuzzy = groups.find((chat) => String(chat.name || '').trim().toLowerCase() === target.toLowerCase());
    if (fuzzy) return fuzzy;
  }

  throw new Error('No se encontró el grupo configurado en WhatsApp.');
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(value, max = 42) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function wrapText(value, maxChars = 58) {
  const words = String(value ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function currencyColor(value) {
  return String(value || '').trim().startsWith('-') ? '#C0392B' : '#0F172A';
}

function metricCard(x, y, width, height, label, value, accent, valueColor = '#0F172A') {
  return `
    <g>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="#F8FAFC" stroke="#E2E8F0" />
      <rect x="${x}" y="${y}" width="8" height="${height}" rx="8" fill="${accent}" />
      <text x="${x + 24}" y="${y + 28}" font-size="18" font-weight="600" fill="#475569">${escapeXml(label)}</text>
      <text x="${x + 24}" y="${y + 65}" font-size="30" font-weight="700" fill="${valueColor}">${escapeXml(truncate(value, 26))}</text>
    </g>`;
}

function infoPill(x, y, text) {
  return `
    <g>
      <rect x="${x}" y="${y - 20}" width="${Math.max(120, Math.min(480, text.length * 10.3))}" height="34" rx="17" fill="#ECFDF5" stroke="#D1FAE5" />
      <text x="${x + 16}" y="${y + 2}" font-size="17" font-weight="600" fill="#065F46">${escapeXml(text)}</text>
    </g>`;
}

function tableCell(x, y, width, text, options = {}) {
  const align = options.align || 'start';
  const color = options.color || '#0F172A';
  const fontWeight = options.fontWeight || 500;
  const fontSize = options.fontSize || 18;
  const anchor = align === 'end' ? 'end' : 'start';
  const textX = align === 'end' ? x + width - 12 : x + 12;

  return `<text x="${textX}" y="${y}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${color}" text-anchor="${anchor}">${escapeXml(truncate(text, 24))}</text>`;
}

function headerBlock({ width, margin, innerWidth, title, statusLabel, statusColor }) {
  return `
    <rect x="${margin}" y="${margin}" width="${innerWidth}" height="96" rx="28" fill="#0F172A" />
    <rect x="${margin + innerWidth - 240}" y="${margin + 26}" width="180" height="42" rx="21" fill="${statusColor}" />
    <text x="${margin + 34}" y="${margin + 42}" font-size="18" font-weight="600" fill="#94A3B8">FinFlow · Notificación oficial</text>
    <text x="${margin + 34}" y="${margin + 77}" font-size="38" font-weight="700" fill="#FFFFFF">${escapeXml(title)}</text>
    <text x="${margin + innerWidth - 150}" y="${margin + 54}" font-size="20" font-weight="700" fill="#FFFFFF" text-anchor="middle">${escapeXml(statusLabel)}</text>`;
}

function entityInfoBlock({ margin, innerWidth, name, subtitle, registeredBy, reviewedBy, generatedAt }) {
  return `
    <text x="${margin + 34}" y="${margin + 150}" font-size="42" font-weight="700" fill="#0F172A">${escapeXml(truncate(name || 'Sin nombre', 60))}</text>
    ${infoPill(margin + 34, margin + 184, subtitle || 'Movimiento confirmado')}
    <text x="${margin + 34}" y="${margin + 218}" font-size="18" font-weight="500" fill="#475569">Registrado por: ${escapeXml(registeredBy || 'Sistema')}</text>
    <text x="${margin + 34}" y="${margin + 244}" font-size="18" font-weight="500" fill="#475569">Revisado por: ${escapeXml(reviewedBy || 'Sistema')}</text>
    <text x="${margin + innerWidth - 34}" y="${margin + 218}" font-size="18" font-weight="500" fill="#64748B" text-anchor="end">Generado: ${escapeXml(generatedAt || '-')}</text>`;
}

async function renderPaymentApprovedSummaryBuffer(data = {}) {
  const rows = Array.isArray(data.movementHistory) ? data.movementHistory.slice(0, 10) : [];
  const width = 1680;
  const margin = 48;
  const innerWidth = width - (margin * 2);
  const metricGap = 18;
  const metricWidth = (innerWidth - (metricGap * 2)) / 3;
  const metricHeight = 86;
  const summaryTop = 310;
  const tableTop = 560;
  const rowHeight = 52;
  const tableHeaderHeight = 44;
  const footerHeight = 76;
  const height = tableTop + tableHeaderHeight + (rows.length * rowHeight) + footerHeight + 54;

  const metrics = [
    { label: 'Valor pagado', value: data.amount || '-', accent: '#10B981' },
    { label: 'Fecha real del pago', value: data.paymentDate || '-', accent: '#3B82F6' },
    { label: 'Interés pagado', value: data.interestPaid || '-', accent: '#8B5CF6' },
    { label: 'Capital pagado', value: data.capitalPaid || '-', accent: '#F97316', valueColor: currencyColor(data.capitalPaid || '-') },
    { label: 'Saldo actual', value: data.currentBalance || '-', accent: '#334155' },
    { label: 'Próximo vencimiento', value: data.nextDueDate || '-', accent: '#14B8A6' }
  ];

  const metricCards = metrics.map((item, index) => {
    const row = Math.floor(index / 3);
    const col = index % 3;
    const x = margin + col * (metricWidth + metricGap);
    const y = summaryTop + row * (metricHeight + 14);
    return metricCard(x, y, metricWidth, metricHeight, item.label, item.value, item.accent, item.valueColor || '#0F172A');
  }).join('');

  const columns = [
    { key: 'date', label: 'Fecha', width: 150, align: 'start' },
    { key: 'movementLabel', label: 'Movimiento', width: 220, align: 'start' },
    { key: 'amount', label: 'Monto', width: 160, align: 'end' },
    { key: 'balanceBefore', label: 'Saldo antes', width: 210, align: 'end' },
    { key: 'balanceAfter', label: 'Saldo después', width: 210, align: 'end' },
    { key: 'interestPaid', label: 'Interés pagado', width: 190, align: 'end' },
    { key: 'capitalPaid', label: 'Capital pagado', width: 190, align: 'end' }
  ];

  const headerX = margin + 16;
  let runningX = headerX;
  const headerCells = columns.map((column) => {
    const cell = tableCell(runningX, tableTop + 28, column.width, column.label, {
      align: column.align,
      color: '#FFFFFF',
      fontWeight: 700,
      fontSize: 17
    });
    runningX += column.width;
    return cell;
  }).join('');

  const rowSvgs = rows.map((row, index) => {
    const baseY = tableTop + tableHeaderHeight + (index * rowHeight);
    const background = index % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
    let x = headerX;
    const cells = columns.map((column) => {
      const value = row[column.key] || '-';
      const cell = tableCell(x, baseY + 32, column.width, value, {
        align: column.align,
        color: column.key === 'capitalPaid' ? currencyColor(value) : '#0F172A',
        fontWeight: column.key === 'capitalPaid' && String(value || '').startsWith('-') ? 700 : 500,
        fontSize: 17
      });
      x += column.width;
      return cell;
    }).join('');

    return `
      <g>
        <rect x="${margin}" y="${baseY}" width="${innerWidth}" height="${rowHeight}" fill="${background}" />
        <line x1="${margin}" y1="${baseY + rowHeight}" x2="${margin + innerWidth}" y2="${baseY + rowHeight}" stroke="#E2E8F0" />
        ${cells}
      </g>`;
  }).join('');

  const subtitle = [data.counterpartyType || null, data.identifier ? `ID ${data.identifier}` : null].filter(Boolean).join(' · ');

  const svg = `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="#EEF2F7" />
    <rect x="${margin}" y="${margin}" width="${innerWidth}" height="${height - (margin * 2)}" rx="28" fill="#FFFFFF" stroke="#E2E8F0" />

    ${headerBlock({ width, margin, innerWidth, title: data.title || 'Pago aprobado', statusLabel: data.statusLabel || 'APROBADO', statusColor: data.statusColor || '#10B981' })}
    ${entityInfoBlock({ margin, innerWidth, name: data.counterpartyName, subtitle, registeredBy: data.registeredBy, reviewedBy: data.reviewedBy, generatedAt: data.generatedAt })}
    ${metricCards}

    <text x="${margin + 20}" y="${tableTop - 18}" font-size="28" font-weight="700" fill="#0F172A">Historial oficial de movimientos</text>
    <rect x="${margin}" y="${tableTop}" width="${innerWidth}" height="${tableHeaderHeight}" rx="16" fill="#0F172A" />
    ${headerCells}
    ${rowSvgs}

    <line x1="${margin + 24}" y1="${height - footerHeight - 16}" x2="${margin + innerWidth - 24}" y2="${height - footerHeight - 16}" stroke="#E2E8F0" />
    <text x="${margin + 28}" y="${height - 36}" font-size="17" font-weight="500" fill="#64748B">${escapeXml(data.officialLegend || 'Comprobante informativo generado automáticamente.')}</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderPaymentRejectedSummaryBuffer(data = {}) {
  const width = 1680;
  const margin = 48;
  const innerWidth = width - (margin * 2);
  const metricGap = 18;
  const metricWidth = (innerWidth - (metricGap * 2)) / 3;
  const metricHeight = 86;
  const summaryTop = 310;
  const reasonTop = 560;
  const reasonLines = wrapText(data.reason || 'No se indicó una razón específica.', 80);
  const reasonBoxHeight = 80 + (reasonLines.length * 28);
  const footerHeight = 80;
  const height = reasonTop + reasonBoxHeight + footerHeight + 80;

  const subtitle = [data.counterpartyType || null, data.identifier ? `ID ${data.identifier}` : null].filter(Boolean).join(' · ');
  const metrics = [
    { label: 'Valor registrado', value: data.amount || '-', accent: '#10B981' },
    { label: 'Fecha real del pago', value: data.paymentDate || '-', accent: '#3B82F6' },
    { label: 'Estado', value: 'Rechazado', accent: '#DC2626', valueColor: '#DC2626' },
    { label: 'Saldo actual', value: data.currentBalance || '-', accent: '#334155' },
    { label: 'Interés pendiente', value: data.currentInterest || '-', accent: '#8B5CF6' },
    { label: 'Próximo vencimiento', value: data.nextDueDate || '-', accent: '#14B8A6' }
  ];

  const metricCards = metrics.map((item, index) => {
    const row = Math.floor(index / 3);
    const col = index % 3;
    const x = margin + col * (metricWidth + metricGap);
    const y = summaryTop + row * (metricHeight + 14);
    return metricCard(x, y, metricWidth, metricHeight, item.label, item.value, item.accent, item.valueColor || '#0F172A');
  }).join('');

  const reasonSvg = reasonLines.map((line, index) => `
    <text x="${margin + 28}" y="${reasonTop + 74 + index * 28}" font-size="22" font-weight="500" fill="#0F172A">${escapeXml(line)}</text>`).join('');

  const svg = `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="#EEF2F7" />
    <rect x="${margin}" y="${margin}" width="${innerWidth}" height="${height - (margin * 2)}" rx="28" fill="#FFFFFF" stroke="#E2E8F0" />

    ${headerBlock({ width, margin, innerWidth, title: data.title || 'Pago rechazado', statusLabel: data.statusLabel || 'RECHAZADO', statusColor: data.statusColor || '#DC2626' })}
    ${entityInfoBlock({ margin, innerWidth, name: data.counterpartyName, subtitle, registeredBy: data.registeredBy, reviewedBy: data.reviewedBy, generatedAt: data.generatedAt })}
    ${metricCards}

    <text x="${margin + 20}" y="${reasonTop - 18}" font-size="28" font-weight="700" fill="#0F172A">Razón del rechazo</text>
    <rect x="${margin}" y="${reasonTop}" width="${innerWidth}" height="${reasonBoxHeight}" rx="20" fill="#FEF2F2" stroke="#FECACA" />
    <text x="${margin + 28}" y="${reasonTop + 40}" font-size="18" font-weight="700" fill="#991B1B">Observación del revisor</text>
    ${reasonSvg}

    <line x1="${margin + 24}" y1="${height - footerHeight - 16}" x2="${margin + innerWidth - 24}" y2="${height - footerHeight - 16}" stroke="#E2E8F0" />
    <text x="${margin + 28}" y="${height - 36}" font-size="17" font-weight="500" fill="#64748B">${escapeXml(data.officialLegend || 'Notificación informativa generada automáticamente.')}</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderMediaFromPayload(renderType, renderData) {
  switch (String(renderType || '').trim()) {
    case 'payment_approved_summary': {
      const buffer = await renderPaymentApprovedSummaryBuffer(renderData || {});
      return new MessageMedia('image/png', buffer.toString('base64'), `pago-aprobado-${Date.now()}.png`);
    }
    case 'payment_rejected_summary': {
      const buffer = await renderPaymentRejectedSummaryBuffer(renderData || {});
      return new MessageMedia('image/png', buffer.toString('base64'), `pago-rechazado-${Date.now()}.png`);
    }
    default:
      throw new Error('invalid_render_type');
  }
}

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FinFlow WhatsApp Bot</title>
  <style>
    body { font-family: Arial, sans-serif; background:#0f172a; color:#fff; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
    .card { background:#111827; border:1px solid #334155; border-radius:24px; padding:32px; max-width:650px; box-shadow:0 20px 60px rgba(0,0,0,.35); }
    h1 { margin:0 0 12px; font-size:30px; }
    p { color:#cbd5e1; line-height:1.45; }
    code { background:#020617; padding:3px 6px; border-radius:6px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>FinFlow WhatsApp Bot</h1>
    <p>Servicio activo. Usa <code>/health</code> para validar estado.</p>
    <p>Para escanear el QR abre <code>/qr?token=TU_BOT_API_TOKEN</code>.</p>
  </div>
</body>
</html>`);
});

app.get('/health', (req, res) => {
  res.json({ ok: true, state: lastKnownState });
});

app.get('/status', requireAuth, async (req, res) => {
  let wid = null;
  try {
    wid = client.info ? client.info.wid?._serialized : null;
  } catch (error) {}

  res.json({ ok: true, state: lastKnownState, qrPending: Boolean(currentQr), wid, qr: currentQr });
});

app.get('/qr', requireBrowserAuth, async (req, res) => {
  try {
    if (!currentQr) {
      const ready = lastKnownState === 'ready' || lastKnownState === 'authenticated';
      return res.status(ready ? 200 : 404).send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FinFlow WhatsApp Bot</title>
  <style>
    body { font-family: Arial, sans-serif; background:#0f172a; color:#fff; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
    .card { background:#111827; border:1px solid #334155; border-radius:24px; padding:32px; max-width:560px; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,.35); }
    h1 { margin:0 0 12px; font-size:28px; }
    p { color:#cbd5e1; line-height:1.45; }
    code { background:#020617; padding:3px 6px; border-radius:6px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>FinFlow WhatsApp Bot</h1>
    <p>Estado actual: <code>${lastKnownState}</code></p>
    <p>${ready ? 'El bot ya está autenticado. No hay QR pendiente.' : 'Todavía no hay QR disponible. Espera unos segundos y recarga esta página.'}</p>
  </div>
</body>
</html>`);
    }

    const svg = await qrcodeSvg.toString(currentQr, {
      type: 'svg',
      width: 420,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' }
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vincular WhatsApp - FinFlow</title>
  <style>
    body { font-family: Arial, sans-serif; background:#0f172a; color:#fff; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
    .card { background:#f8fafc; color:#0f172a; border-radius:28px; padding:32px; max-width:560px; width:calc(100% - 32px); text-align:center; box-shadow:0 20px 60px rgba(0,0,0,.35); }
    h1 { margin:0 0 8px; font-size:28px; }
    p { color:#475569; line-height:1.45; margin:8px 0; }
    .qr { margin:24px auto; width:420px; max-width:100%; background:#fff; padding:18px; border-radius:24px; border:1px solid #e2e8f0; }
    .qr svg { width:100%; height:auto; display:block; }
    .steps { text-align:left; background:#e2e8f0; border-radius:16px; padding:16px 18px; margin-top:18px; color:#0f172a; }
    .small { font-size:13px; color:#64748b; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Escanea este QR</h1>
    <p>WhatsApp → Dispositivos vinculados → Vincular dispositivo.</p>
    <div class="qr">${svg}</div>
    <div class="steps">
      <strong>Después de escanear:</strong>
      <p>Espera en Railway hasta ver <strong>WhatsApp bot listo.</strong></p>
      <p>Luego esta página debe decir que ya no hay QR pendiente.</p>
    </div>
    <p class="small">Esta página está protegida con token. No compartas este enlace.</p>
  </div>
</body>
</html>`);
  } catch (error) {
    console.error(error);
    return res.status(500).send('No fue posible renderizar el QR.');
  }
});

app.post('/api/whatsapp/send-group', requireAuth, async (req, res) => {
  try {
    if (lastKnownState !== 'ready' && lastKnownState !== 'authenticated') {
      return res.status(503).json({ ok: false, error: 'bot_not_ready', state: lastKnownState });
    }

    const { groupTarget = '', groupName = '', message = '', caption = '', eventType = '', renderType = '', renderData = {}, meta = {} } = req.body || {};

    const hasMessage = String(message || '').trim() !== '';
    const hasRender = String(renderType || '').trim() !== '';
    if (!hasMessage && !hasRender) {
      return res.status(422).json({ ok: false, error: 'message_or_render_required' });
    }

    const chat = await resolveGroup(groupTarget, groupName);
    let sent;
    let delivery = 'text';

    if (hasRender) {
      const media = await renderMediaFromPayload(renderType, renderData);
      const safeCaption = String(caption || message || '').trim();
      sent = await chat.sendMessage(media, safeCaption ? { caption: safeCaption } : undefined);
      delivery = 'image';
    } else {
      sent = await chat.sendMessage(String(message));
    }

    return res.json({
      ok: true,
      eventType,
      delivery,
      chatId: chat.id?._serialized || null,
      chatName: chat.name || null,
      messageId: sent?.id?._serialized || null,
      meta
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message || 'send_failed' });
  }
});

app.listen(PORT, () => {
  console.log(`WhatsApp bot escuchando en http://127.0.0.1:${PORT}`);
});

client.initialize();
