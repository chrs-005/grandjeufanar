const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function backend(accepted = 0, admin = false) {
  const sandbox = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getUrl: () => 'https://example.test/private-sheet' }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: text => ({ text, setMimeType() { return this; } }),
    },
  });
  vm.runInContext(code, sandbox);
  const game = {
    names: ['Requin', 'Faucon', 'Bison', 'Leops', 'Panda'],
    challenges: Array.from({ length: 22 }, (_, i) => ({ row: i + 2, name: 'Challenge ' + i,
      statuses: Array(5).fill(i < accepted ? 'accepted' : 'pending') })),
    locations: Array.from({ length: 5 }, (_, k) => [4, 8, 12, 16, 20].map((threshold, i) => ({ threshold, name: `SECRET-ANSWER-${k}-${i}` }))),
  };
  sandbox.gameFixture = game;
  sandbox.accountFixture = { isAdmin: admin, patrolIndex: 0, username: admin ? 'MDTadmin' : 'patrol' };
  sandbox.requestedImages = [];
  vm.runInContext(`
    authenticate_ = () => accountFixture;
    readGame_ = () => gameFixture;
    privateLocationImage_ = name => { requestedImages.push(name); return 'data:image/webp;base64,AAAA'; };
  `, sandbox);
  return sandbox;
}

test('every patrol gets only image bytes for earned thresholds, never answer names', () => {
  for (let accepted = 0; accepted <= 22; accepted++) {
    for (let patrol = 0; patrol < 5; patrol++) {
      const server = backend(accepted);
      server.accountFixture.patrolIndex = patrol;
      const data = server.getData('fixture-token');
      const earned = [4, 8, 12, 16, 20].filter(n => n <= accepted);
      assert.equal(data.riddleVersion, 1);
      assert.deepEqual(Array.from(data.patrol.locations, l => l.threshold), earned);
      assert.equal(JSON.stringify(data).includes('SECRET-ANSWER'), false);
      assert.equal('sheetUrl' in data, false);
      for (const location of data.patrol.locations) {
        assert.deepEqual(Object.keys(location).sort(), ['imageData', 'threshold']);
      }
      assert.equal(server.requestedImages.length, earned.length, 'Locked images are never loaded');
    }
  }
});

test('only authenticated admin responses keep all answer names and images', () => {
  const server = backend(0, true);
  const data = server.getData('fixture-token');
  assert.equal(data.role, 'admin');
  assert.equal(data.user, 'MDTadmin');
  assert.equal(data.patrols.length, 5);
  assert.equal(data.patrols[0].locations[0].name, 'SECRET-ANSWER-0-0');
  assert.equal(server.requestedImages.length, 25);
});

test('missing image helper fails without exposing an answer', () => {
  const server = backend(4);
  vm.runInContext('privateLocationImage_ = undefined;', server);
  const location = server.getData('fixture-token').patrol.locations[0];
  assert.equal(location.imageData, '');
  assert.equal('name' in location, false);
});

test('JSON API cannot call private image helpers or choose another patrol/role', () => {
  const server = backend(4);
  for (const fn of ['privateLocationImage_', 'patrolView_', 'readGame_', 'constructor', '__proto__']) {
    const result = server.doPost({ postData: { contents: JSON.stringify({ fn, args: ['SECRET-ANSWER-0-4'] }) } });
    assert.equal(JSON.parse(result.text).ok, false);
  }
  const result = server.doPost({ postData: { contents: JSON.stringify({ fn: 'getData', args: ['fixture-token', 4, true] }) } });
  const data = JSON.parse(result.text).value;
  assert.equal(data.role, 'patrol');
  assert.equal(data.patrol.key, 'requin');
  assert.equal(JSON.stringify(data).includes('SECRET-ANSWER'), false);
});

test('authentication is required before game data or images are read', () => {
  const server = backend(22);
  vm.runInContext('authenticate_ = () => { throw new Error("Session expired"); };', server);
  assert.throws(() => server.getData('invalid-token'), /Session expired/);
  assert.equal(server.requestedImages.length, 0);
});
