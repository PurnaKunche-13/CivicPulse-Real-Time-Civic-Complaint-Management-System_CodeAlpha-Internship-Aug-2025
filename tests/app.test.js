const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.OPENAI_API_KEY = '';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
const db = require('../lib/supabase');
let fail = false;
db.from = () => {
    if (fail) throw new Error('Simulated database failure');
    return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: 'admin-test', password: 'test' } }) };
};
const app = require('../server');
let server, base;
before(async () => { server = app.listen(0); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => new Promise(resolve => server.close(resolve)));
const request = (url, options = {}) => fetch(base + url, { redirect: 'manual', ...options });
test('public pages render and missing routes return 404', async () => {
    for (const route of ['/', '/user-login', '/admin-login']) assert.equal((await request(route)).status, 200);
    assert.equal((await request('/not-found')).status, 404);
});
test('protected pages redirect anonymous users', async () => {
    for (const route of ['/post-problem', '/user-dashboard', '/admin-dashboard']) {
        const response = await request(route); assert.equal(response.status, 302);
        assert.match(response.headers.get('location'), /login/);
    }
});
test('admin validation, session, invalid filters and status', async () => {
    assert.equal((await request('/admin-login', { method: 'POST' })).status, 400);
    const login = await request('/admin-login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=admin&password=test' });
    assert.equal(login.status, 302);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/update-status/test', { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'status=invalid' })).status, 400);
    assert.equal((await request('/admin-dashboard?date=invalid', { headers: { cookie } })).status, 400);
    const logout = await request('/admin-logout', { headers: { cookie } }); assert.equal(logout.status, 302);
    assert.equal((await request('/admin-dashboard', { headers: { cookie } })).status, 302);
});
test('rejected async routes return HTTP 500 without crashing', async () => {
    fail = true;
    const response = await request('/admin-login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=admin&password=test' });
    fail = false;
    assert.equal(response.status, 500);
    assert.equal((await request('/')).status, 200);
});
test('all EJS templates compile', () => {
    const fs = require('node:fs'), path = require('node:path'), ejs = require('ejs');
    for (const file of fs.readdirSync(path.join(__dirname, '../views'))) if (file.endsWith('.ejs')) ejs.compile(fs.readFileSync(path.join(__dirname, '../views', file), 'utf8'));
});
