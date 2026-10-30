/**
 * Grand Jeu Fanar — backend (Google Apps Script, attached to the Google Sheet).
 *
 * The sheet has three tabs:
 *   Défis   : column A = challenge, then one column per patrol holding "" / "Validé" / "Refusé"
 *   Lieux   : column A = number of accepted challenges needed, then one location per patrol
 *   Comptes : Identifiant | Mot de passe | Patrouille ("Admin" for the admin account)
 *
 * Passwords only live in the sheet, never in this file.
 *
 * @OnlyCurrentDoc
 */

const PATROLS = ['Requin', 'Faucon', 'Bison', 'Leops', 'Panda'];
const TAB_CHALLENGES = 'Défis';
const TAB_LOCATIONS = 'Lieux';
const TAB_ACCOUNTS = 'Comptes';
const STATUS_TEXT = { pending: '', accepted: 'Validé', rejected: 'Refusé' };
const SESSION_MS = 7 * 24 * 3600 * 1000;
const MAX_LOGIN_FAILURES = 10; // per identifiant, per 10 minutes
const SESSION_EXPIRED = 'Session expirée, reconnectez-vous.';

function doGet(e) {
  // Open <web app URL>?ping=1 to check that this deployment runs the latest code and is public.
  if (e && e.parameter && e.parameter.ping) {
    return ContentService.createTextOutput(JSON.stringify({ ok: true, riddleVersion: 1, message: 'Le serveur fonctionne.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Grand Jeu Fanar')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// JSON entry point for the copy of the site hosted on GitHub Pages: { fn, args } -> { ok, value | error }.
function doPost(e) {
  const api = { login: login, getData: getData, setStatus: setStatus };
  let body;
  try {
    const req = JSON.parse(e.postData.contents);
    if (!Object.prototype.hasOwnProperty.call(api, req.fn)) throw new Error('Action inconnue : ' + req.fn);
    body = { ok: true, value: api[req.fn].apply(null, req.args || []) };
  } catch (err) {
    body = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Called from Index.html with google.script.run ----------

function login(username, password) {
  const cache = CacheService.getScriptCache();
  const failKey = 'fail:' + normalize_(username);
  const failures = Number(cache.get(failKey) || 0);
  if (failures >= MAX_LOGIN_FAILURES) {
    throw new Error('Trop de tentatives. Réessayez dans 10 minutes.');
  }
  const account = findAccount_(username);
  if (!account || account.password !== String(password || '').trim()) {
    cache.put(failKey, String(failures + 1), 600);
    throw new Error('Identifiant ou mot de passe incorrect.');
  }
  cache.remove(failKey);
  const payload = Utilities.base64EncodeWebSafe(
    JSON.stringify({ u: account.username, e: Date.now() + SESSION_MS }), Utilities.Charset.UTF_8);
  const token = payload + '.' + sign_(payload, account.password);
  return { token: token, data: getData(token) };
}

function getData(token) {
  const account = authenticate_(token);
  const game = readGame_();
  if (account.isAdmin) {
    return {
      role: 'admin',
      riddleVersion: 1,
      user: account.username,
      sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
      patrols: PATROLS.map((_, k) => patrolView_(game, k, true)),
    };
  }
  return { role: 'patrol', riddleVersion: 1, patrol: patrolView_(game, account.patrolIndex, false) };
}

function setStatus(token, patrolKey, row, challengeName, status) {
  const account = authenticate_(token);
  if (!account.isAdmin) throw new Error('Seul l\'admin peut modifier les défis.');
  if (!(status in STATUS_TEXT)) throw new Error('Statut inconnu : ' + status);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = tab_(TAB_CHALLENGES);
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    const col = patrolColumns_(header, TAB_CHALLENGES)[PATROLS.findIndex(p => normalize_(p) === patrolKey)];
    if (col === undefined) throw new Error('Patrouille inconnue : ' + patrolKey);
    if (sheet.getRange(row, 1).getDisplayValue().trim() !== challengeName) {
      throw new Error('La liste des défis a changé dans la feuille. Rechargez la page.');
    }
    sheet.getRange(row, col + 1).setValue(STATUS_TEXT[status]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return getData(token);
}

// ---------- Sheet reading ----------

function readGame_() {
  const rows = tab_(TAB_CHALLENGES).getDataRange().getDisplayValues();
  const cols = patrolColumns_(rows[0], TAB_CHALLENGES);
  const challenges = [];
  for (let i = 1; i < rows.length; i++) {
    const name = rows[i][0].trim();
    if (name) challenges.push({ row: i + 1, name: name, statuses: cols.map(c => parseStatus_(rows[i][c])) });
  }

  const lieux = tab_(TAB_LOCATIONS).getDataRange().getDisplayValues();
  const lieuxCols = patrolColumns_(lieux[0], TAB_LOCATIONS);
  const locations = PATROLS.map(() => []);
  for (let i = 1; i < lieux.length; i++) {
    const threshold = parseInt(lieux[i][0], 10);
    if (!(threshold > 0)) continue;
    lieuxCols.forEach((c, k) => {
      const name = lieux[i][c].trim();
      if (name) locations[k].push({ threshold: threshold, name: name });
    });
  }
  locations.forEach(list => list.sort((a, b) => a.threshold - b.threshold));

  return { names: cols.map(c => rows[0][c].trim()), challenges: challenges, locations: locations };
}

// Admins get every location (to see what is coming); patrols only get the ones they unlocked.
function patrolView_(game, k, isAdmin) {
  const challenges = game.challenges.map(c => ({ row: c.row, name: c.name, status: c.statuses[k] }));
  const accepted = challenges.filter(c => c.status === 'accepted').length;
  const next = game.locations[k].find(l => l.threshold > accepted);
  return {
    key: normalize_(PATROLS[k]),
    name: game.names[k],
    challenges: challenges,
    // Select permitted locations BEFORE loading any images. Never send answers to patrols.
    locations: game.locations[k].filter(l => isAdmin || l.threshold <= accepted).map(l => {
      const imageData = typeof privateLocationImage_ === 'function' ? privateLocationImage_(l.name) : '';
      const location = { threshold: l.threshold, imageData: imageData };
      if (isAdmin) location.name = l.name;
      return location;
    }),
    nextThreshold: next ? next.threshold : null,
  };
}

function patrolColumns_(header, tabName) {
  const normalized = header.map(normalize_);
  return PATROLS.map(p => {
    const col = normalized.indexOf(normalize_(p));
    if (col < 1) throw new Error('Colonne "' + p + '" introuvable dans l\'onglet ' + tabName + '.');
    return col;
  });
}

// Also accepts checkboxes (TRUE) and a few common spellings typed by hand.
function parseStatus_(value) {
  const v = normalize_(value);
  if (/^(valide|accepte|ok|oui|true|x|✓|✔)/.test(v)) return 'accepted';
  if (/^(refuse|rejete|non|✗|✘)/.test(v)) return 'rejected';
  return 'pending';
}

function tab_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Onglet "' + name + '" introuvable dans la feuille Google.');
  return sheet;
}

// ---------- Accounts & sessions ----------

function findAccount_(username) {
  const wanted = normalize_(username);
  if (!wanted) return null;
  const row = tab_(TAB_ACCOUNTS).getDataRange().getDisplayValues().slice(1)
    .find(r => normalize_(r[0]) === wanted);
  if (!row) return null;
  const role = normalize_(row[2]);
  const patrolIndex = PATROLS.findIndex(p => normalize_(p) === role);
  if (role !== 'admin' && patrolIndex < 0) return null;
  return { username: row[0].trim(), password: row[1].trim(), isAdmin: role === 'admin', patrolIndex: patrolIndex };
}

// The signature covers the password, so changing a password in the sheet logs that account out.
function authenticate_(token) {
  const parts = String(token || '').split('.');
  let data = null;
  try {
    data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (e) {
    throw new Error(SESSION_EXPIRED);
  }
  const account = data && data.e > Date.now() ? findAccount_(data.u) : null;
  if (!account || sign_(parts[0], account.password) !== parts[1]) throw new Error(SESSION_EXPIRED);
  return account;
}

function sign_(payload, password) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload + '|' + password, secret_()));
}

function secret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SESSION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', secret);
  }
  return secret;
}

function normalize_(value) {
  return String(value == null ? '' : value).trim().toLowerCase()
    .replace(/[àâä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[îï]/g, 'i')
    .replace(/[ôö]/g, 'o').replace(/[ùûü]/g, 'u').replace(/ç/g, 'c');
}
