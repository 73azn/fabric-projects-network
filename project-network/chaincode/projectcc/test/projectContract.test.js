/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests with an in-memory stub (no Fabric network needed): `npm test`
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ProjectContract = require('../lib/projectContract');
const { isValidDate } = require('../lib/validation');
const { isoFromTimestamp, stableStringify } = require('../lib/util');

function makeCtx(msp = 'PlatformMSP', state = new Map(), history = new Map()) {
    let txCounter = 0;
    return {
        state,
        history,
        clientIdentity: { getMSPID: () => msp },
        stub: {
            async getState(key) { return state.has(key) ? state.get(key) : Buffer.alloc(0); },
            async putState(key, value) {
                state.set(key, Buffer.from(value));
                txCounter += 1;
                const list = history.get(key) || [];
                list.push({ txId: `tx${txCounter}`, timestamp: { seconds: 1767225600 + txCounter, nanos: 5000000 }, isDelete: false, value: Buffer.from(value) });
                history.set(key, list);
            },
            async getHistoryForKey(key) {
                // like the real ledger: newest version first
                const list = [...(history.get(key) || [])].reverse();
                let i = 0;
                return {
                    next: async () => (i < list.length ? { value: list[i++], done: false } : { done: true }),
                    close: async () => {},
                };
            },
        },
    };
}

const PROJECT = {
    id: 'PRJ-001',
    owner: 'Ahmed Ali',
    contractor: 'Al-Bina Co.',
    agreedPrice: 250000,
    currency: 'SAR',
    milestone: [
        { description: 'Dig and pour the foundation', startDate: '2026-10-01', finishDate: '2026-10-20' },
        { description: 'Build the ground floor columns', startDate: '2026-10-21', finishDate: null },
    ],
};
const PAYMENT = { id: 'PAY-1', amount: 50000, date: '2026-10-03', note: 'First payment' };

const contract = new ProjectContract();
const asCode = (code) => (err) => { assert.match(err.message, new RegExp(`^${code}:`)); return true; };

test('CreateProject stores a project with no payments and sorted keys', async () => {
    const ctx = makeCtx();
    const out = await contract.CreateProject(ctx, JSON.stringify(PROJECT));
    const stored = ctx.state.get('PRJ-001').toString();
    assert.equal(out, stored);
    const parsed = JSON.parse(stored);
    assert.deepEqual(parsed.payments, []);
    assert.deepEqual(Object.keys(parsed), [...Object.keys(parsed)].sort());
    assert.deepEqual(Object.keys(parsed.milestone[0]), ['clientApproved', 'description', 'finishDate', 'startDate']);
    assert.equal(stored, stableStringify(parsed));
});

test('CreateProject defaults currency to SAR, milestone to [] and dates to null', async () => {
    const ctx = makeCtx();
    await contract.CreateProject(ctx, JSON.stringify({
        id: 'P2', owner: 'A', contractor: 'B', agreedPrice: 10, milestone: [{ description: 'x' }],
    }));
    const p = JSON.parse(ctx.state.get('P2').toString());
    assert.equal(p.currency, 'SAR');
    assert.deepEqual(p.milestone, [{ clientApproved: false, description: 'x', finishDate: null, startDate: null }]);
    await contract.CreateProject(ctx, JSON.stringify({ id: 'P3', owner: 'A', contractor: 'B', agreedPrice: 10 }));
    assert.deepEqual(JSON.parse(ctx.state.get('P3').toString()).milestone, []);
});

test('CreateProject fails if the id already exists', async () => {
    const ctx = makeCtx();
    await contract.CreateProject(ctx, JSON.stringify(PROJECT));
    await assert.rejects(contract.CreateProject(ctx, JSON.stringify(PROJECT)), asCode('ALREADY_EXISTS'));
});

test('CreateProject rejects payments in the input', async () => {
    const ctx = makeCtx();
    await assert.rejects(contract.CreateProject(ctx, JSON.stringify({ ...PROJECT, payments: [PAYMENT] })), asCode('INVALID_INPUT'));
    await contract.CreateProject(ctx, JSON.stringify({ ...PROJECT, payments: [] })); // empty list is fine
});

test('CreateProject validates required fields and types', async () => {
    const ctx = makeCtx();
    const bad = [
        { ...PROJECT, id: undefined },
        { ...PROJECT, id: '' },
        { ...PROJECT, id: 'has space' },
        { ...PROJECT, owner: '' },
        { ...PROJECT, owner: '   ' },
        { ...PROJECT, contractor: undefined },
        { ...PROJECT, agreedPrice: undefined },
        { ...PROJECT, agreedPrice: 0 },
        { ...PROJECT, agreedPrice: -5 },
        { ...PROJECT, agreedPrice: 100.5 },
        { ...PROJECT, agreedPrice: '1000' },
        { ...PROJECT, currency: 'USD' },
        { ...PROJECT, milestone: 'nope' },
        { ...PROJECT, milestone: [{ startDate: '2026-01-01' }] },
        { ...PROJECT, milestone: [{ description: '' }] },
        { ...PROJECT, milestone: [{ description: 'x', extra: 1 }] },
        { ...PROJECT, unexpected: true },
    ];
    for (const b of bad) {
        await assert.rejects(contract.CreateProject(ctx, JSON.stringify(b)), asCode('INVALID_INPUT'), JSON.stringify(b));
    }
    await assert.rejects(contract.CreateProject(ctx, 'not json'), asCode('INVALID_INPUT'));
    await assert.rejects(contract.CreateProject(ctx, ''), asCode('INVALID_INPUT'));
    assert.equal(ctx.state.size, 0);
});

test('task dates: format, real calendar dates, finish needs start, finish not before start', async () => {
    const ctx = makeCtx();
    const task = (t) => JSON.stringify({ ...PROJECT, milestone: [{ description: 'x', ...t }] });
    for (const t of [
        { startDate: '2026-1-1' }, { startDate: '01-10-2026' }, { startDate: '2026/10/01' },
        { startDate: '2026-02-30' }, { startDate: '2026-13-01' }, { startDate: '2025-02-29' }, { startDate: 20261001 },
        { finishDate: '2026-10-20' },                                      // finish without start
        { startDate: '2026-10-20', finishDate: '2026-10-19' },             // finish before start
    ]) {
        await assert.rejects(contract.CreateProject(ctx, task(t)), asCode('INVALID_INPUT'), JSON.stringify(t));
    }
    // valid: leap day, same-day start/finish, explicit nulls
    await contract.CreateProject(ctx, task({ startDate: '2028-02-29', finishDate: '2028-02-29' }));
    assert.equal(isValidDate('2024-02-29'), true);
    assert.equal(isValidDate('2100-02-29'), false);
    assert.equal(isValidDate('2000-02-29'), true);
});

test('permissions: AdminOrg can read but not write, unknown orgs cannot do anything', async () => {
    const platform = makeCtx('PlatformMSP');
    await contract.CreateProject(platform, JSON.stringify(PROJECT));
    const admin = makeCtx('AdminOrgMSP', platform.state, platform.history);
    assert.equal(JSON.parse(await contract.ReadProject(admin, 'PRJ-001')).id, 'PRJ-001');
    assert.equal(await contract.ProjectExists(admin, 'PRJ-001'), true);
    assert.equal(JSON.parse(await contract.GetProjectHistory(admin, 'PRJ-001')).length, 1);
    await assert.rejects(contract.CreateProject(admin, JSON.stringify({ ...PROJECT, id: 'X' })), asCode('FORBIDDEN'));
    await assert.rejects(contract.UpdateProject(admin, JSON.stringify(PROJECT)), asCode('FORBIDDEN'));
    await assert.rejects(contract.AddPayment(admin, 'PRJ-001', JSON.stringify(PAYMENT)), asCode('FORBIDDEN'));

    const other = makeCtx('EvilMSP', platform.state, platform.history);
    await assert.rejects(contract.ReadProject(other, 'PRJ-001'), asCode('FORBIDDEN'));
    await assert.rejects(contract.ProjectExists(other, 'PRJ-001'), asCode('FORBIDDEN'));
});

test('ReadProject / ProjectExists', async () => {
    const ctx = makeCtx();
    assert.equal(await contract.ProjectExists(ctx, 'PRJ-001'), false);
    await assert.rejects(contract.ReadProject(ctx, 'PRJ-001'), asCode('NOT_FOUND'));
    await contract.CreateProject(ctx, JSON.stringify(PROJECT));
    assert.equal(await contract.ProjectExists(ctx, 'PRJ-001'), true);
    const p = JSON.parse(await contract.ReadProject(ctx, 'PRJ-001'));
    assert.equal(p.owner, 'Ahmed Ali');
    await assert.rejects(contract.ReadProject(ctx, ''), asCode('INVALID_INPUT'));
});

test('UpdateProject replaces data, keeps id and payments, fails if missing', async () => {
    const ctx = makeCtx();
    await assert.rejects(contract.UpdateProject(ctx, JSON.stringify(PROJECT)), asCode('NOT_FOUND'));
    await contract.CreateProject(ctx, JSON.stringify(PROJECT));
    await contract.AddPayment(ctx, 'PRJ-001', JSON.stringify(PAYMENT));

    const updated = { id: 'PRJ-001', owner: 'Ahmed A.', contractor: 'New Co', agreedPrice: 300000, milestone: [{ description: 'Only task' }] };
    await contract.UpdateProject(ctx, JSON.stringify(updated));
    const p = JSON.parse(ctx.state.get('PRJ-001').toString());
    assert.equal(p.owner, 'Ahmed A.');
    assert.equal(p.agreedPrice, 300000);
    assert.equal(p.milestone.length, 1);            // replaced, not merged
    assert.deepEqual(p.payments, [PAYMENT]);        // untouched

    // sending the payments back unchanged is allowed
    await contract.UpdateProject(ctx, JSON.stringify({ ...updated, payments: [PAYMENT] }));
    // changing them is not
    await assert.rejects(contract.UpdateProject(ctx, JSON.stringify({ ...updated, payments: [] })), asCode('INVALID_INPUT'));
    await assert.rejects(contract.UpdateProject(ctx, JSON.stringify({ ...updated, payments: [{ ...PAYMENT, amount: 1 }] })), asCode('INVALID_INPUT'));
    assert.deepEqual(JSON.parse(ctx.state.get('PRJ-001').toString()).payments, [PAYMENT]);
});

test('UpdateProject cannot lower agreedPrice below the total already paid', async () => {
    const ctx = makeCtx();
    await contract.CreateProject(ctx, JSON.stringify(PROJECT));
    await contract.AddPayment(ctx, 'PRJ-001', JSON.stringify(PAYMENT));            // 50000 paid
    const upd = (agreedPrice) => JSON.stringify({ ...PROJECT, agreedPrice });
    await assert.rejects(contract.UpdateProject(ctx, upd(49999)), asCode('INVALID_INPUT'));
    await contract.UpdateProject(ctx, upd(50000));                                   // exactly equal is fine
    assert.equal(JSON.parse(ctx.state.get('PRJ-001').toString()).agreedPrice, 50000);
});

test('AddPayment appends, never edits, and validates', async () => {
    const ctx = makeCtx();
    await assert.rejects(contract.AddPayment(ctx, 'PRJ-001', JSON.stringify(PAYMENT)), asCode('NOT_FOUND'));
    await contract.CreateProject(ctx, JSON.stringify(PROJECT));
    await contract.AddPayment(ctx, 'PRJ-001', JSON.stringify(PAYMENT));
    await contract.AddPayment(ctx, 'PRJ-001', JSON.stringify({ id: 'PAY-2', amount: 100000, date: '2026-11-01' }));
    const p = JSON.parse(ctx.state.get('PRJ-001').toString());
    assert.deepEqual(p.payments.map((x) => x.id), ['PAY-1', 'PAY-2']);
    assert.equal(p.payments[1].note, '');

    await assert.rejects(contract.AddPayment(ctx, 'PRJ-001', JSON.stringify(PAYMENT)), asCode('INVALID_INPUT'));            // duplicate id
    await assert.rejects(contract.AddPayment(ctx, 'PRJ-001', JSON.stringify({ ...PAYMENT, id: 'PAY-3', amount: 0 })), asCode('INVALID_INPUT'));
    await assert.rejects(contract.AddPayment(ctx, 'PRJ-001', JSON.stringify({ ...PAYMENT, id: 'PAY-3', amount: -1 })), asCode('INVALID_INPUT'));
    await assert.rejects(contract.AddPayment(ctx, 'PRJ-001', JSON.stringify({ ...PAYMENT, id: 'PAY-3', amount: 10.5 })), asCode('INVALID_INPUT'));
    await assert.rejects(contract.AddPayment(ctx, 'PRJ-001', JSON.stringify({ ...PAYMENT, id: 'PAY-3', date: '2026-02-30' })), asCode('INVALID_INPUT'));
    await assert.rejects(contract.AddPayment(ctx, 'PRJ-001', JSON.stringify({ id: 'PAY-3', amount: 5 })), asCode('INVALID_INPUT'));   // no date
    await assert.rejects(contract.AddPayment(ctx, 'PRJ-001', JSON.stringify({ ...PAYMENT, id: 'PAY-3', who: 'x' })), asCode('INVALID_INPUT'));
    assert.equal(JSON.parse(ctx.state.get('PRJ-001').toString()).payments.length, 2);
});

test('AddPayment: total payments can never exceed agreedPrice', async () => {
    const ctx = makeCtx();
    await contract.CreateProject(ctx, JSON.stringify(PROJECT));                       // price 250000
    await contract.AddPayment(ctx, 'PRJ-001', JSON.stringify({ id: 'A', amount: 200000, date: '2026-10-01' }));
    await assert.rejects(contract.AddPayment(ctx, 'PRJ-001', JSON.stringify({ id: 'B', amount: 50001, date: '2026-10-02' })), asCode('INVALID_INPUT'));
    await contract.AddPayment(ctx, 'PRJ-001', JSON.stringify({ id: 'B', amount: 50000, date: '2026-10-02' })); // exactly the price
    await assert.rejects(contract.AddPayment(ctx, 'PRJ-001', JSON.stringify({ id: 'C', amount: 1, date: '2026-10-03' })), asCode('INVALID_INPUT'));
});

test('GetProjectHistory returns every version, oldest first, with deterministic timestamps', async () => {
    const ctx = makeCtx();
    await assert.rejects(contract.GetProjectHistory(ctx, 'PRJ-001'), asCode('NOT_FOUND'));
    await contract.CreateProject(ctx, JSON.stringify(PROJECT));
    await contract.AddPayment(ctx, 'PRJ-001', JSON.stringify(PAYMENT));
    const history = JSON.parse(await contract.GetProjectHistory(ctx, 'PRJ-001'));
    assert.equal(history.length, 2);
    assert.deepEqual(history[0].value.payments, []);
    assert.equal(history[1].value.payments.length, 1);
    assert.equal(history[0].isDelete, false);
    assert.match(history[0].txId, /^tx/);
    assert.equal(history[0].timestamp, '2026-01-01T00:00:01.005Z');
});

test('isoFromTimestamp converts epoch seconds without Date', () => {
    assert.equal(isoFromTimestamp(0, 0), '1970-01-01T00:00:00.000Z');
    assert.equal(isoFromTimestamp(951782400, 0), '2000-02-29T00:00:00.000Z');          // leap day
    assert.equal(isoFromTimestamp('1790000000', 123456789), new Date(1790000000 * 1000 + 123).toISOString());
    assert.equal(isoFromTimestamp(1709251199, 999000000), '2024-02-29T23:59:59.999Z');
});

test('clientApproved: true/false is stored, defaults to false, and only booleans are accepted', async () => {
    const ctx = makeCtx();
    const withTasks = (milestone) => JSON.stringify({ id: 'P-A', owner: 'o', contractor: 'c', agreedPrice: 100, milestone });
    await contract.CreateProject(ctx, withTasks([
        { description: 'agreed', clientApproved: true },
        { description: 'not agreed', clientApproved: false },
        { description: 'not said' },
    ]));
    const stored = JSON.parse(ctx.state.get('P-A').toString());
    assert.deepEqual(stored.milestone.map((t) => t.clientApproved), [true, false, false]);

    for (const bad of ['true', 'yes', 1, 0, null, {}, []]) {
        await assert.rejects(
            contract.CreateProject(makeCtx(), JSON.stringify({ id: 'P-B', owner: 'o', contractor: 'c', agreedPrice: 1, milestone: [{ description: 't', clientApproved: bad }] })),
            asCode('INVALID_INPUT'), `clientApproved=${JSON.stringify(bad)}`);
    }
});

test('clientApproved can be changed with UpdateProject and is kept by AddPayment', async () => {
    const ctx = makeCtx();
    await contract.CreateProject(ctx, JSON.stringify({ ...PROJECT, milestone: [{ description: 'Foundation' }, { description: 'Columns' }] }));
    await contract.UpdateProject(ctx, JSON.stringify({ ...PROJECT, milestone: [{ description: 'Foundation', clientApproved: true }, { description: 'Columns' }] }));
    await contract.AddPayment(ctx, 'PRJ-001', JSON.stringify(PAYMENT));
    const p = JSON.parse(await contract.ReadProject(ctx, 'PRJ-001'));
    assert.deepEqual(p.milestone.map((t) => [t.description, t.clientApproved]), [['Foundation', true], ['Columns', false]]);
    assert.equal(p.payments.length, 1);
});

test('records stored before clientApproved existed read as false (also in the history)', async () => {
    const ctx = makeCtx();
    const old = { id: 'OLD-1', owner: 'o', contractor: 'c', agreedPrice: 10, currency: 'SAR', payments: [],
        milestone: [{ description: 'legacy task', startDate: '2026-10-01', finishDate: null }] };
    await ctx.stub.putState('OLD-1', Buffer.from(stableStringify(old)));   // written by the previous chaincode version
    assert.equal(JSON.parse(await contract.ReadProject(ctx, 'OLD-1')).milestone[0].clientApproved, false);
    const history = JSON.parse(await contract.GetProjectHistory(ctx, 'OLD-1'));
    assert.equal(history[0].value.milestone[0].clientApproved, false);
    // paying on an old project works and keeps its tasks
    await contract.AddPayment(ctx, 'OLD-1', JSON.stringify({ id: 'PAY-1', amount: 5, date: '2026-10-02' }));
    assert.equal(JSON.parse(await contract.ReadProject(ctx, 'OLD-1')).milestone[0].description, 'legacy task');
});
