'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');
const { assess } = require('../src/health');
const { toHttpError } = require('../src/errors');

const enc = (obj) => new TextEncoder().encode(JSON.stringify(obj));

const PROJECT = {
    id: 'PRJ-001', owner: 'Ahmed Ali', contractor: 'Al-Bina Co.', agreedPrice: 250000, currency: 'SAR', milestone: [],
    payments: [{ id: 'PAY-1', amount: 50000, date: '2026-10-03', note: 'First payment' }],
};

/** Starts the app on a random port with a fake gateway; `handler(org, fn, args)` plays the chaincode. */
async function withServer(handler, fn) {
    const calls = [];
    const fabric = {
        contract: (org) => ({
            evaluateTransaction: async (name, ...args) => { calls.push({ org, name, args }); return handler(org, name, args); },
            submitTransaction: async (name, ...args) => { calls.push({ org, name, args }); return handler(org, name, args); },
        }),
    };
    const health = async () => ({ httpStatus: 200, body: { status: 'healthy' } });
    const server = http.createServer(createApp({ fabric, health }));
    await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, path, { body, headers = {}, raw } = {}) => {
        const res = await fetch(base + path, {
            method,
            headers: { ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
            body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, json: await res.json() };
    };
    try { await fn(call, calls); } finally { await new Promise((r) => server.close(r)); }
}

const chaincodeError = (text) => Object.assign(new Error('10 ABORTED: failed to endorse transaction'), { details: [{ message: `chaincode response 500, ${text}` }] });

test('GET /projects/:id adds totalPaid and remaining (calculated, not stored)', async () => {
    await withServer(() => enc(PROJECT), async (call, calls) => {
        const r = await call('GET', '/projects/PRJ-001');
        assert.equal(r.status, 200);
        assert.equal(r.json.totalPaid, 50000);
        assert.equal(r.json.remaining, 200000);
        assert.equal(r.json.owner, 'Ahmed Ali');
        assert.deepEqual(calls[0], { org: 'platform', name: 'ReadProject', args: ['PRJ-001'] });
    });
});

test('X-Org picks the organization (default platform), bad values are 400', async () => {
    await withServer(() => enc(PROJECT), async (call, calls) => {
        await call('GET', '/projects/PRJ-001', { headers: { 'X-Org': 'admin' } });
        await call('GET', '/projects/PRJ-001', { headers: { 'X-Org': 'PLATFORM' } });
        assert.deepEqual(calls.map((c) => c.org), ['admin', 'platform']);
        const bad = await call('GET', '/projects/PRJ-001', { headers: { 'X-Org': 'nobody' } });
        assert.equal(bad.status, 400);
        assert.equal(bad.json.code, 'INVALID_INPUT');
    });
});

test('chaincode errors map to 400 / 403 / 404 / 409', async () => {
    const cases = [
        ['INVALID_INPUT: agreedPrice must be greater than 0', 400, 'INVALID_INPUT'],
        ['FORBIDDEN: organization AdminOrgMSP is not allowed to create projects', 403, 'FORBIDDEN'],
        ['NOT_FOUND: project PRJ-9 does not exist', 404, 'NOT_FOUND'],
        ['ALREADY_EXISTS: project PRJ-001 already exists', 409, 'ALREADY_EXISTS'],
    ];
    for (const [text, status, code] of cases) {
        await withServer(() => { throw chaincodeError(text); }, async (call) => {
            const r = await call('POST', '/projects', { body: { id: 'PRJ-001' } });
            assert.equal(r.status, status, text);
            assert.equal(r.json.code, code);
            assert.equal(r.json.error, text.split(': ').slice(1).join(': '));
        });
    }
});

test('unreachable network is 503, unknown errors are 500 without leaking details', () => {
    assert.equal(toHttpError(Object.assign(new Error('14 UNAVAILABLE'), { code: 14 })).status, 503);
    const noPlan = toHttpError(Object.assign(new Error('9 FAILED_PRECONDITION: no combination of peers can be derived which satisfy the endorsement policy'), { code: 9, details: [] }));
    assert.equal(noPlan.status, 503);
    assert.equal(noPlan.code, 'NETWORK_UNAVAILABLE');
    const e = toHttpError(new Error('boom with secret path /etc/x'));
    assert.equal(e.status, 500);
    assert.doesNotMatch(e.message, /secret/);
});

test('POST /projects -> 201 with totals; PUT strips computed fields and checks the id', async () => {
    const created = { ...PROJECT, payments: [] };
    await withServer((_org, name, args) => (name === 'CreateProject' ? enc(created) : enc({ ...PROJECT, ...JSON.parse(args[0]) })), async (call, calls) => {
        const r = await call('POST', '/projects', { body: { id: 'PRJ-001', owner: 'a', contractor: 'b', agreedPrice: 250000 } });
        assert.equal(r.status, 201);
        assert.equal(r.json.totalPaid, 0);
        assert.equal(r.json.remaining, 250000);

        const put = await call('PUT', '/projects/PRJ-001', { body: { owner: 'new', contractor: 'b', agreedPrice: 300000, totalPaid: 1, remaining: 2 } });
        assert.equal(put.status, 200);
        const sent = JSON.parse(calls.at(-1).args[0]);
        assert.deepEqual(sent, { owner: 'new', contractor: 'b', agreedPrice: 300000, id: 'PRJ-001' });

        const mismatch = await call('PUT', '/projects/PRJ-001', { body: { id: 'OTHER', owner: 'x', contractor: 'y', agreedPrice: 1 } });
        assert.equal(mismatch.status, 400);
    });
});

test('POST /projects/:id/payments and GET history', async () => {
    const history = [{ txId: 'a', timestamp: '2026-10-01T00:00:00.000Z', isDelete: false, value: PROJECT }];
    await withServer((_o, name) => (name === 'AddPayment' ? enc(PROJECT) : enc(history)), async (call, calls) => {
        const p = await call('POST', '/projects/PRJ-001/payments', { body: { id: 'PAY-1', amount: 50000, date: '2026-10-03', note: 'First payment' } });
        assert.equal(p.status, 201);
        assert.equal(p.json.payment.id, 'PAY-1');
        assert.equal(p.json.project.remaining, 200000);
        assert.deepEqual(calls[0].args[0], 'PRJ-001');
        const h = await call('GET', '/projects/PRJ-001/history');
        assert.equal(h.status, 200);
        assert.equal(h.json.length, 1);
    });
});

test('bad bodies are 400, unknown routes are 404 JSON', async () => {
    await withServer(() => enc(PROJECT), async (call) => {
        assert.equal((await call('POST', '/projects', { raw: '{not json' })).status, 400);
        assert.equal((await call('POST', '/projects', { raw: '[1,2]' })).status, 400);
        assert.equal((await call('POST', '/projects/PRJ-001/payments', { raw: '"x"' })).status, 400);
        const nf = await call('GET', '/nope');
        assert.equal(nf.status, 404);
        assert.equal(nf.json.code, 'NOT_FOUND');
    });
});

// ---------------------------------------------------------------- health decision logic

const up = { status: 'up' };
const down = { status: 'down', detail: 'ECONNREFUSED' };
const allUp = { orderer: up, 'peer0.platform': up, 'peer0.adminorg': up };

test('health: everything up and same height -> healthy', () => {
    const r = assess({ nodes: allUp, heights: { 'peer0.platform': 7, 'peer0.adminorg': 7 }, lagSince: null, nowMs: 1000, graceMs: 10000 });
    assert.deepEqual(r.reasons, []);
    assert.equal(r.inSync, true);
    assert.equal(r.heightGap, 0);
});

test('health: a 1-block gap is tolerated for the grace period, then unhealthy', () => {
    const h = { 'peer0.platform': 8, 'peer0.adminorg': 7 };
    let r = assess({ nodes: allUp, heights: h, lagSince: null, nowMs: 1000, graceMs: 10000 });
    assert.deepEqual(r.reasons, []);
    assert.equal(r.lagSince, 1000);
    r = assess({ nodes: allUp, heights: h, lagSince: r.lagSince, nowMs: 9000, graceMs: 10000 });
    assert.deepEqual(r.reasons, []);
    r = assess({ nodes: allUp, heights: h, lagSince: 1000, nowMs: 12000, graceMs: 10000 });
    assert.equal(r.reasons.length, 1);
    assert.match(r.reasons[0], /out of sync/);
    // catching up resets the timer
    r = assess({ nodes: allUp, heights: { 'peer0.platform': 8, 'peer0.adminorg': 8 }, lagSince: 1000, nowMs: 13000, graceMs: 10000 });
    assert.equal(r.lagSince, null);
    assert.deepEqual(r.reasons, []);
});

test('health: a gap of 2+ blocks is unhealthy immediately', () => {
    const r = assess({ nodes: allUp, heights: { 'peer0.platform': 12, 'peer0.adminorg': 9 }, lagSince: null, nowMs: 1, graceMs: 10000 });
    assert.match(r.reasons[0], /gap of 3 blocks/);
});

test('health: a down peer is reported with its name and no height', () => {
    const r = assess({ nodes: { ...allUp, 'peer0.adminorg': down }, heights: { 'peer0.platform': 7, 'peer0.adminorg': null }, lagSince: null, nowMs: 1, graceMs: 10000 });
    assert.deepEqual(r.reasons, ['peer0.adminorg is down (ECONNREFUSED)']);
    assert.equal(r.inSync, false);
    assert.equal(r.heightGap, null);
});

test('health: orderer down and unreadable height', () => {
    const r = assess({ nodes: { ...allUp, orderer: down }, heights: { 'peer0.platform': 7, 'peer0.adminorg': null }, lagSince: null, nowMs: 1, graceMs: 10000 });
    assert.equal(r.reasons.length, 2);
    assert.match(r.reasons[0], /orderer is down/);
    assert.match(r.reasons[1], /peer0.adminorg is up but its block height could not be read/);
});

test('responses use the documented field order', async () => {
    const sorted = { agreedPrice: 10, contractor: 'c', currency: 'SAR', id: 'P', milestone: [{ description: 'd', finishDate: null, startDate: null, status: 'accepted' }], owner: 'o', payments: [{ amount: 1, date: '2026-01-01', id: 'A', note: '' }] };
    await withServer(() => enc(sorted), async (call) => {
        const r = await call('GET', '/projects/P');
        assert.deepEqual(Object.keys(r.json), ['id', 'owner', 'contractor', 'agreedPrice', 'currency', 'milestone', 'payments', 'totalPaid', 'remaining']);
        assert.deepEqual(Object.keys(r.json.milestone[0]), ['description', 'startDate', 'finishDate', 'status']);
        assert.equal(r.json.milestone[0].status, 'accepted');
        assert.deepEqual(Object.keys(r.json.payments[0]), ['id', 'amount', 'date', 'note']);
    });
});

test('a task without status is shown as proposed (chaincode normally fills it in)', async () => {
    const old = { ...PROJECT, milestone: [{ description: 'legacy', startDate: '2026-10-01', finishDate: null }] };
    await withServer(() => enc(old), async (call) => {
        const r = await call('GET', '/projects/PRJ-001');
        assert.equal(r.json.milestone[0].status, 'proposed');
    });
});

test('status and decimal amounts in the request body are passed to the chaincode untouched', async () => {
    await withServer(() => enc(PROJECT), async (call, calls) => {
        await call('POST', '/projects', { body: { id: 'P', owner: 'o', contractor: 'c', agreedPrice: 100.5, milestone: [{ description: 't', status: 'accepted' }] } });
        const sent = JSON.parse(calls[0].args[0]);
        assert.equal(sent.milestone[0].status, 'accepted');
        assert.equal(sent.agreedPrice, 100.5);
    });
});

test('totalPaid and remaining are exact with decimals (0.1 + 0.2 = 0.3)', async () => {
    const decimals = { ...PROJECT, agreedPrice: 100.5, payments: [
        { id: 'A', amount: 0.1, date: '2026-10-01', note: '' },
        { id: 'B', amount: 0.2, date: '2026-10-02', note: '' },
    ] };
    await withServer(() => enc(decimals), async (call) => {
        const r = await call('GET', '/projects/PRJ-001');
        assert.equal(r.json.totalPaid, 0.3);
        assert.equal(r.json.remaining, 100.2);
    });
});
