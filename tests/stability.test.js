import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { parseCookies } from '../src/utils.js';
import { archiveR2ToDrive } from '../src/drive.js';

const sqlite = new DatabaseSync(':memory:');
const storage = new Map();
const env = {
  DATABASE_V2: {
    prepare(sql) {
      let params = [];
      const statement = {
        bind(...values) { params = values; return statement; },
        async run() { sqlite.prepare(sql).run(...params); return { success: true }; },
        async first() { return sqlite.prepare(sql).get(...params) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; }
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  },
  STORAGE_V2: { async put(key, body) { storage.set(key, await new Response(body).text()); } },
  APP_VERSION: '1.0.4'
};
let cookie;
async function request(path, body, options = {}) {
  const headers = { ...(cookie ? { cookie } : {}), ...options.headers };
  const r = await worker.fetch(new Request('https://vidgen.test'+path, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : {body: typeof body === 'string' ? body : JSON.stringify(body)}) }), env);
  const data = await r.json();
  if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
  return { status: r.status, data };
}
test('health is independent of database', async () => {
  const r = await worker.fetch(new Request('https://vidgen.test/api/health'), {});
  assert.equal(r.status,200);
});
test('bootstrap initializes multiline schema and persists session', async () => {
  const r = await request('/api/bootstrap');
  assert.equal(r.status,200); assert.ok(cookie); assert.equal(r.data.providers.length,4);
  const before = cookie; await request('/api/bootstrap'); assert.equal(cookie,before);
});
test('invalid JSON and invalid numbers produce 400', async () => {
  assert.equal((await request('/api/storyboard','{')).status,400);
  assert.equal((await request('/api/storyboard',{sceneCount:'invalid'})).status,400);
  assert.equal((await request('/api/projects',{scenes:[]})).status,400);
});
let projectId;
test('same storyboard saves twice without scene ID collisions', async () => {
  const {data} = await request('/api/storyboard',{sceneCount:4,sceneDuration:8});
  const payload = {title:'Stability regression',scenes:data.scenes};
  const first=await request('/api/projects',payload), second=await request('/api/projects',payload);
  assert.equal(first.status,201); assert.equal(second.status,201); assert.notEqual(first.data.id,second.data.id);
  projectId=first.data.id;
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM scenes').get().n,8);
});
test('failed save rolls back project and scenes together', async () => {
  const original=env.DATABASE_V2.prepare;
  env.DATABASE_V2.prepare=function(sql){if(sql.startsWith('INSERT INTO scenes')) return {bind(){return this},async run(){throw new Error('simulated write failure')}};return original(sql)};
  const before=sqlite.prepare('SELECT count(*) AS n FROM projects').get().n;
  const r=await request('/api/projects',{scenes:[{prompt:'x',start:0,duration:8}]});
  env.DATABASE_V2.prepare=original;
  assert.equal(r.status,500); assert.equal(sqlite.prepare('SELECT count(*) AS n FROM projects').get().n,before);
});
test('generation without credentials is explicitly demo', async () => {
  const r=await request('/api/generate',{projectId});
  assert.equal(r.status,200); assert.ok(r.data.jobs.every(j=>j.demo));
  assert.equal(sqlite.prepare('SELECT status FROM projects WHERE id=?').get(projectId).status,'demo');
  assert.equal((await request('/api/jobs?projectId='+projectId)).data.jobs.length,4);
});
test('other session cannot generate or read project jobs', async () => {
  const headers={cookie:'VIDGEN_SESSION=usr_other'};
  assert.equal((await request('/api/generate',{projectId},{headers})).status,404);
  assert.equal((await request('/api/jobs?projectId='+projectId,undefined,{headers})).data.jobs.length,0);
});
test('upload retains session prefix and content', async () => {
  const r=await request('/api/storage/upload?name=test.txt','test upload');
  assert.equal(r.status,200); assert.equal(storage.get(r.data.key),'test upload');
  assert.ok(r.data.key.startsWith(decodeURIComponent(cookie.split('=')[1])+'/'));
});
test('Drive archive rejects another session file before reading storage', async () => {
  await assert.rejects(archiveR2ToDrive({},'owner',{r2Key:'other/uploads/file'}),e=>e.status===403);
});
test('malformed cookie does not crash parser', () => {
  assert.deepEqual(parseCookies(new Request('https://test',{headers:{cookie:'bad=%ZZ; valid=ok; malformed'}})),{valid:'ok'});
});
test('database initialization failure returns JSON and can be retried', async () => {
  const isolated=(await import('../src/index.js?failure-test')).default;
  const bad={...env,DATABASE_V2:{prepare:env.DATABASE_V2.prepare,async batch(){throw new Error('DB unavailable')}}};
  const r=await isolated.fetch(new Request('https://test/api/bootstrap'),bad);
  assert.equal(r.status,500); assert.equal((await r.json()).error,'DB unavailable');
  const retry=await isolated.fetch(new Request('https://test/api/bootstrap'),env);
  assert.equal(retry.status,200);
});
