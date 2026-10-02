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

// short fixture for tests that do not care about the people
const PARTIES = {
    owner: 'o', ownerId: 'USR-OWNER', ownerEmail: 'owner@example.com',
    contractor: 'c', contractorId: 'USR-CONTRACTOR', contractorEmail: 'contractor@example.com',
};

const PROJECT = {
    id: 'PRJ-001',
    owner: 'Ahmed Ali',
    ownerId: '5b3f0c52-1a7e-4c1d-9f0e-2d6a8b7c9e11',
    ownerEmail: 'ahmed.ali@example.com',
    contractor: 'Al-Bina Co.',
    contractorId: '9c4d7e20-6b1f-4a3e-8d52-0f1e2a3b4c55',
    contractorEmail: 'info@al-bina.example.com',
    agreedPrice: 250000,
    currency: 'SAR',
    milestone: [
        { description: 'Dig and pour the foundation', startDate: '2026-10-01', finishDate: '2026-10-20', status: 'done' },
        { description: 'Build the ground floor columns', startDate: '2026-10-21', finishDate: null, status: 'accepted' },
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
    assert.deepEqual(Object.keys(parsed.milestone[0]), ['description', 'finishDate', 'startDate', 'status']);
    assert.equal(stored, stableStringify(parsed));
});

test('CreateProject defaults currency to SAR, milestone to [] and dates to null', async () => {
    const ctx = makeCtx();
    await contract.CreateProject(ctx, JSON.stringify({
        id: 'P2', ...PARTIES, agreedPrice: 10, milestone: [{ description: 'x' }],
    }));
    const p = JSON.parse(ctx.state.get('P2').toString());
    assert.equal(p.currency, 'SAR');
    assert.deepEqual(p.milestone, [{ description: 'x', finishDate: null, startDate: null, status: 'proposed' }]);
    await contract.CreateProject(ctx, JSON.stringify({ id: 'P3', ...PARTIES, agreedPrice: 10 }));
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
        { ...PROJECT, ownerId: undefined },
        { ...PROJECT, ownerId: '' },
        { ...PROJECT, ownerId: 'has space' },
        { ...PROJECT, ownerId: 42 },
        { ...PROJECT, ownerEmail: undefined },
        { ...PROJECT, ownerEmail: '' },
        { ...PROJECT, ownerEmail: 'not-an-email' },
        { ...PROJECT, ownerEmail: 'no-domain@' },
        { ...PROJECT, ownerEmail: 'no-dot@example' },
        { ...PROJECT, ownerEmail: 'with space@example.com' },
        { ...PROJECT, ownerEmail: `a@${'b'.repeat(250)}.com` },     // longer than 254 characters
        { ...PROJECT, contractorId: undefined },
        { ...PROJECT, contractorId: '-starts-with-dash' },
        { ...PROJECT, contractorEmail: undefined },
        { ...PROJECT, contractorEmail: 'x@y' },
        { ...PROJECT, contractorId: PROJECT.ownerId },              // the owner cannot also be the contractor
        { ...PROJECT, agreedPrice: undefined },
        { ...PROJECT, agreedPrice: 0 },
        { ...PROJECT, agreedPrice: -5 },
        { ...PROJECT, agreedPrice: 100.123 },
        { ...PROJECT, agreedPrice: 10000000000 },
        { ...PROJECT, agreedPrice: Infinity },
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
    await contract.CreateProject(ctx, task({ startDate: '2028-02-29', finishDate: '2028-02-29', status: 'done' }));
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

    const updated = { id: 'PRJ-001', ...PARTIES, owner: 'Ahmed A.', contractor: 'New Co', agreedPrice: 300000, milestone: [{ description: 'Only task' }] };
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
    await assert.rejects(contract.AddPayment(ctx, 'PRJ-001', JSON.stringify({ ...PAYMENT, id: 'PAY-3', amount: 10.555 })), asCode('INVALID_INPUT'));
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

test('money: SAR with at most 2 decimals, like a numeric(12,2) database column', async () => {
    const create = (id, agreedPrice) => contract.CreateProject(makeCtx(), JSON.stringify({ id, ...PARTIES, agreedPrice }));
    for (const ok of [1, 0.01, 100.5, 1234.56, 9999999999.99]) {
        await create('M', ok);
    }
    for (const bad of [0, -1, 0.001, 100.123, 10000000000, '100.50', null, NaN, 1e21]) {
        await assert.rejects(create('M', bad), asCode('INVALID_INPUT'), `agreedPrice=${bad}`);
    }
});

test('money: sums are exact (0.1 + 0.2 is 0.3) and the agreed price is a hard limit', async () => {
    const ctx = makeCtx();
    await contract.CreateProject(ctx, JSON.stringify({ id: 'M-1', ...PARTIES, agreedPrice: 0.3 }));
    await contract.AddPayment(ctx, 'M-1', JSON.stringify({ id: 'A', amount: 0.1, date: '2026-10-01' }));
    await contract.AddPayment(ctx, 'M-1', JSON.stringify({ id: 'B', amount: 0.2, date: '2026-10-02' }));   // exactly 0.30
    await assert.rejects(contract.AddPayment(ctx, 'M-1', JSON.stringify({ id: 'C', amount: 0.01, date: '2026-10-03' })), asCode('INVALID_INPUT'));
    await assert.rejects(contract.AddPayment(ctx, 'M-1', JSON.stringify({ id: 'D', amount: 0.001, date: '2026-10-03' })), asCode('INVALID_INPUT'));

    // halalas: 100.50 + 99.50 = 200 exactly
    await contract.CreateProject(ctx, JSON.stringify({ id: 'M-2', ...PARTIES, agreedPrice: 200 }));
    await contract.AddPayment(ctx, 'M-2', JSON.stringify({ id: 'A', amount: 100.5, date: '2026-10-01' }));
    await contract.AddPayment(ctx, 'M-2', JSON.stringify({ id: 'B', amount: 99.5, date: '2026-10-02' }));
    await assert.rejects(contract.UpdateProject(ctx, JSON.stringify({ id: 'M-2', ...PARTIES, agreedPrice: 199.99 })), asCode('INVALID_INPUT'));
    await contract.UpdateProject(ctx, JSON.stringify({ id: 'M-2', ...PARTIES, agreedPrice: 200 }));
});

test('task description: required, up to 5000 characters (5000)', async () => {
    const create = (description) => contract.CreateProject(makeCtx(), JSON.stringify({ id: 'D-1', ...PARTIES, agreedPrice: 1, milestone: [{ description }] }));
    await create('x'.repeat(5000));
    await assert.rejects(create('x'.repeat(5001)), asCode('INVALID_INPUT'));
    await assert.rejects(create(''), asCode('INVALID_INPUT'));
    await assert.rejects(create('   '), asCode('INVALID_INPUT'));
    await assert.rejects(create(undefined), asCode('INVALID_INPUT'));
});

test('task status: the five task statuses, default proposed, nothing else', async () => {
    const ctx = makeCtx();
    const withTask = (task) => JSON.stringify({ id: 'S-1', ...PARTIES, agreedPrice: 100, milestone: [task] });
    const dates = { startDate: '2026-10-01', finishDate: '2026-10-05' };
    await contract.CreateProject(ctx, JSON.stringify({ id: 'S-1', ...PARTIES, agreedPrice: 100, milestone: [
        { description: 'a' },
        { description: 'b', status: 'proposed' },
        { description: 'c', status: 'accepted' },
        { description: 'd', status: 'rejected' },
        { description: 'e', status: 'done', ...dates },
        { description: 'f', status: 'approved', ...dates },
    ] }));
    const stored = JSON.parse(ctx.state.get('S-1').toString());
    assert.deepEqual(stored.milestone.map((t) => t.status), ['proposed', 'proposed', 'accepted', 'rejected', 'done', 'approved']);

    for (const bad of ['Done', 'finished', 'agreed', '', null, 1, true]) {
        await assert.rejects(contract.CreateProject(makeCtx(), withTask({ description: 't', status: bad })), asCode('INVALID_INPUT'), `status=${JSON.stringify(bad)}`);
    }
    // the old field is gone
    await assert.rejects(contract.CreateProject(makeCtx(), withTask({ description: 't', clientApproved: true })), asCode('INVALID_INPUT'));
});

test('finishDate exists exactly when the status is done or approved (and needs a startDate)', async () => {
    const create = (task) => contract.CreateProject(makeCtx(), JSON.stringify({ id: 'F-1', ...PARTIES, agreedPrice: 1, milestone: [{ description: 't', ...task }] }));
    const start = { startDate: '2026-10-01' };
    await create({ ...start });                                                            // proposed, started, not finished
    await create({ ...start, status: 'accepted' });
    await create({ ...start, finishDate: '2026-10-02', status: 'done' });
    await create({ ...start, finishDate: '2026-10-01', status: 'approved' });              // same day is fine
    await assert.rejects(create({ ...start, status: 'done' }), asCode('INVALID_INPUT'));                          // done needs a finishDate
    await assert.rejects(create({ status: 'approved' }), asCode('INVALID_INPUT'));
    await assert.rejects(create({ ...start, finishDate: '2026-10-02', status: 'accepted' }), asCode('INVALID_INPUT')); // finishDate but not done
    await assert.rejects(create({ ...start, finishDate: '2026-10-02' }), asCode('INVALID_INPUT'));                // default status proposed
    await assert.rejects(create({ finishDate: '2026-10-02', status: 'done' }), asCode('INVALID_INPUT'));          // finish without start
    await assert.rejects(create({ startDate: '2026-10-05', finishDate: '2026-10-02', status: 'done' }), asCode('INVALID_INPUT')); // finish before start
});

test('status changes with UpdateProject and is kept by AddPayment', async () => {
    const ctx = makeCtx();
    await contract.CreateProject(ctx, JSON.stringify({ ...PROJECT, milestone: [{ description: 'Foundation' }, { description: 'Columns' }] }));
    await contract.UpdateProject(ctx, JSON.stringify({ ...PROJECT, milestone: [
        { description: 'Foundation', status: 'accepted', startDate: '2026-10-01' },
        { description: 'Columns' },
    ] }));
    await contract.AddPayment(ctx, 'PRJ-001', JSON.stringify(PAYMENT));
    const p = JSON.parse(await contract.ReadProject(ctx, 'PRJ-001'));
    assert.deepEqual(p.milestone.map((t) => [t.description, t.status]), [['Foundation', 'accepted'], ['Columns', 'proposed']]);
    assert.equal(p.payments.length, 1);
});

test('records stored by earlier versions read correctly (1.1 dates only, 1.2 clientApproved)', async () => {
    const ctx = makeCtx();
    const legacy = { id: 'OLD-1', owner: 'o', contractor: 'c', agreedPrice: 10, currency: 'SAR', payments: [], milestone: [
        { description: 'v1.1 finished', startDate: '2026-10-01', finishDate: '2026-10-05' },        // 1.1: no status at all
        { description: 'v1.1 open', startDate: '2026-10-06', finishDate: null },
        { description: 'v1.2 agreed', startDate: null, finishDate: null, clientApproved: true },
        { description: 'v1.2 not agreed', startDate: null, finishDate: null, clientApproved: false },
        { description: 'v1.2 finished', startDate: '2026-10-01', finishDate: '2026-10-02', clientApproved: true },
    ] };
    await ctx.stub.putState('OLD-1', Buffer.from(stableStringify(legacy)));          // written by the previous chaincode versions
    const read = JSON.parse(await contract.ReadProject(ctx, 'OLD-1'));
    assert.deepEqual(read.milestone.map((t) => t.status), ['done', 'proposed', 'accepted', 'proposed', 'done']);
    assert.ok(read.milestone.every((t) => !('clientApproved' in t)));
    const history = JSON.parse(await contract.GetProjectHistory(ctx, 'OLD-1'));
    assert.deepEqual(history[0].value.milestone.map((t) => t.status), ['done', 'proposed', 'accepted', 'proposed', 'done']);
    // an old project can be paid and its tasks are kept (rewritten in the new shape)
    await contract.AddPayment(ctx, 'OLD-1', JSON.stringify({ id: 'PAY-1', amount: 5, date: '2026-10-02' }));
    const after = JSON.parse(await contract.ReadProject(ctx, 'OLD-1'));
    assert.equal(after.milestone.length, 5);
    assert.equal(after.milestone[0].status, 'done');
    // the old project has no owner / contractor ids and e-mails: they read as "" (not recorded) ...
    for (const f of ['ownerId', 'ownerEmail', 'contractorId', 'contractorEmail']) {
        assert.equal(after[f], '', f);
        assert.equal(history[0].value[f], '', `history ${f}`);
    }
    // ... so they must be filled in before the project can be updated; sending the "" back is refused
    await assert.rejects(contract.UpdateProject(ctx, JSON.stringify(after)), asCode('INVALID_INPUT'));
    await contract.UpdateProject(ctx, JSON.stringify({ ...after, ...PARTIES }));
    assert.equal(JSON.parse(await contract.ReadProject(ctx, 'OLD-1')).ownerEmail, 'owner@example.com');
});

test('owner and contractor ids and e-mails are stored, read back, and can be corrected (the history keeps the old ones)', async () => {
    const ctx = makeCtx();
    await contract.CreateProject(ctx, JSON.stringify(PROJECT));
    const read = JSON.parse(await contract.ReadProject(ctx, 'PRJ-001'));
    for (const f of ['owner', 'ownerId', 'ownerEmail', 'contractor', 'contractorId', 'contractorEmail']) {
        assert.equal(read[f], PROJECT[f], f);
    }

    await contract.UpdateProject(ctx, JSON.stringify({ ...PROJECT, ownerEmail: 'ahmed.new@example.com' }));
    const history = JSON.parse(await contract.GetProjectHistory(ctx, 'PRJ-001'));
    assert.deepEqual(history.map((h) => h.value.ownerEmail), ['ahmed.ali@example.com', 'ahmed.new@example.com']);
    assert.equal(history[1].value.ownerId, PROJECT.ownerId);       // the id did not change

    // payments keep the parties untouched
    await contract.AddPayment(ctx, 'PRJ-001', JSON.stringify(PAYMENT));
    const afterPayment = JSON.parse(await contract.ReadProject(ctx, 'PRJ-001'));
    assert.equal(afterPayment.contractorEmail, PROJECT.contractorEmail);
    assert.equal(afterPayment.ownerEmail, 'ahmed.new@example.com');
});

test('the same person cannot be owner and contractor, and the platform-side ids may be any safe id (uuid, USR-1 ...)', async () => {
    const ctx = makeCtx();
    await assert.rejects(contract.CreateProject(ctx, JSON.stringify({ ...PROJECT, contractorId: PROJECT.ownerId })), asCode('INVALID_INPUT'));
    await contract.CreateProject(ctx, JSON.stringify({ ...PROJECT, id: 'X-1', ownerId: 'USR-1', contractorId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }));
    assert.equal(JSON.parse(ctx.state.get('X-1').toString()).ownerId, 'USR-1');
});
