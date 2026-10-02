'use strict';

const express = require('express');
const { FabricConnections, decodeJson } = require('./fabric');
const { HttpError } = require('./errors');

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Re-orders the fields the way the project is written in the docs (the chain stores them with sorted keys). */
function presentProject(p) {
    return {
        id: p.id,
        owner: p.owner,
        contractor: p.contractor,
        agreedPrice: p.agreedPrice,
        currency: p.currency,
        milestone: (p.milestone || []).map((t) => ({
            description: t.description,
            startDate: t.startDate,
            finishDate: t.finishDate,
            clientApproved: t.clientApproved === true, // missing on projects stored before the field existed
        })),
        payments: (p.payments || []).map((x) => ({ id: x.id, amount: x.amount, date: x.date, note: x.note })),
    };
}

/** totalPaid / remaining are calculated for the response only; they are never stored on the chain. */
function withTotals(project) {
    const shaped = presentProject(project);
    const totalPaid = shaped.payments.reduce((sum, p) => sum + p.amount, 0);
    return { ...shaped, totalPaid, remaining: shaped.agreedPrice - totalPaid };
}

function presentHistory(history) {
    return history.map((h) => ({ ...h, value: h.value ? presentProject(h.value) : null }));
}

function requireBody(req) {
    if (!isPlainObject(req.body)) {
        throw new HttpError(400, 'the request body must be a JSON object (send Content-Type: application/json)', 'INVALID_INPUT');
    }
    return req.body;
}

function projectsRouter({ fabric }) {
    const router = express.Router();

    // X-Org: platform | admin  (default: platform) -> decides which organization's user signs the request
    router.use((req, _res, next) => {
        const org = FabricConnections.resolveOrg(req.get('X-Org'));
        if (!org) {
            return next(new HttpError(400, 'X-Org must be "platform" or "admin"', 'INVALID_INPUT'));
        }
        req.org = org;
        return next();
    });

    const read = (req, fn, ...args) => fabric.contract(req.org).evaluateTransaction(fn, ...args);
    const write = (req, fn, ...args) => fabric.contract(req.org).submitTransaction(fn, ...args);

    // Create a project (the id is in the body)
    router.post('/', async (req, res) => {
        const body = requireBody(req);
        const project = decodeJson(await write(req, 'CreateProject', JSON.stringify(body)));
        res.status(201).json(withTotals(project));
    });

    // Read a project (+ totalPaid and remaining)
    router.get('/:id', async (req, res) => {
        const project = decodeJson(await read(req, 'ReadProject', req.params.id));
        res.json(withTotals(project));
    });

    // Update a project (payments cannot be changed here)
    router.put('/:id', async (req, res) => {
        const { totalPaid, remaining, ...data } = requireBody(req); // computed fields may be sent back, they are ignored
        if (data.id !== undefined && data.id !== req.params.id) {
            throw new HttpError(400, 'the id in the body does not match the id in the URL', 'INVALID_INPUT');
        }
        data.id = req.params.id;
        const project = decodeJson(await write(req, 'UpdateProject', JSON.stringify(data)));
        res.json(withTotals(project));
    });

    // Add a payment
    router.post('/:id/payments', async (req, res) => {
        const payment = requireBody(req);
        const project = decodeJson(await write(req, 'AddPayment', req.params.id, JSON.stringify(payment)));
        const shaped = withTotals(project);
        res.status(201).json({ payment: shaped.payments.find((p) => p.id === payment.id), project: shaped });
    });

    // All past versions of the project from the ledger (oldest first)
    router.get('/:id/history', async (req, res) => {
        res.json(presentHistory(decodeJson(await read(req, 'GetProjectHistory', req.params.id))));
    });

    return router;
}

module.exports = { projectsRouter, withTotals };
