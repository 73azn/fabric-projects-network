/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const { Contract } = require('fabric-contract-api');
const { stableStringify, isoFromTimestamp } = require('./util');
const {
    ChaincodeError,
    validateProjectInput,
    validatePaymentInput,
    parseJson,
    requireId,
    totalPaid,
    normalizeProject,
} = require('./validation');

// Only Platform may change data. Both organizations may read.
const WRITER_MSPS = ['PlatformMSP'];
const READER_MSPS = ['PlatformMSP', 'AdminOrgMSP'];

class ProjectContract extends Contract {

    // ---------------------------------------------------------------- writes (PlatformMSP only)

    /**
     * Creates a new project. The project starts with no payments.
     * @param {string} projectJson JSON: { id, owner, contractor, agreedPrice, currency?, milestone? }
     */
    async CreateProject(ctx, projectJson) {
        this._requireMsp(ctx, WRITER_MSPS, 'create projects');
        const input = validateProjectInput(parseJson(projectJson, 'project'), 'project');

        if (input.payments !== undefined && !(Array.isArray(input.payments) && input.payments.length === 0)) {
            throw new ChaincodeError('INVALID_INPUT', 'a new project starts with no payments; use AddPayment to add them');
        }
        if (await this._exists(ctx, input.id)) {
            throw new ChaincodeError('ALREADY_EXISTS', `project ${input.id} already exists`);
        }

        const project = { ...input, payments: [] };
        await ctx.stub.putState(project.id, Buffer.from(stableStringify(project)));
        return stableStringify(project);
    }

    /**
     * Replaces the project data (owner, contractor, agreedPrice, currency, milestone).
     * The id and the payments can never be changed here. "payments" may be sent back unchanged.
     * @param {string} projectJson JSON with the same shape as CreateProject (id identifies the project)
     */
    async UpdateProject(ctx, projectJson) {
        this._requireMsp(ctx, WRITER_MSPS, 'update projects');
        const input = validateProjectInput(parseJson(projectJson, 'project'), 'project');

        const current = await this._read(ctx, input.id);
        if (input.payments !== undefined && stableStringify(input.payments) !== stableStringify(current.payments)) {
            throw new ChaincodeError('INVALID_INPUT', 'payments cannot be changed with UpdateProject; use AddPayment');
        }
        const paid = totalPaid(current.payments);
        if (input.agreedPrice < paid) {
            throw new ChaincodeError('INVALID_INPUT',
                `agreedPrice (${input.agreedPrice}) cannot be less than the total already paid (${paid})`);
        }

        const project = { ...input, payments: current.payments };
        await ctx.stub.putState(project.id, Buffer.from(stableStringify(project)));
        return stableStringify(project);
    }

    /**
     * Adds one payment (money the owner paid to the contractor). Payments are append-only.
     * @param {string} id project id
     * @param {string} paymentJson JSON: { id, amount, date, note? }
     */
    async AddPayment(ctx, id, paymentJson) {
        this._requireMsp(ctx, WRITER_MSPS, 'add payments');
        requireId(id, 'AddPayment');
        const payment = validatePaymentInput(parseJson(paymentJson, 'payment'));

        const project = await this._read(ctx, id);
        if (project.payments.some((p) => p.id === payment.id)) {
            throw new ChaincodeError('INVALID_INPUT', `payment id ${payment.id} already exists in project ${id}`);
        }
        const paid = totalPaid(project.payments);
        if (paid + payment.amount > project.agreedPrice) {
            throw new ChaincodeError('INVALID_INPUT',
                `payment of ${payment.amount} would make the total paid (${paid + payment.amount}) ` +
                `exceed the agreed price (${project.agreedPrice})`);
        }

        project.payments.push(payment);
        await ctx.stub.putState(id, Buffer.from(stableStringify(project)));
        return stableStringify(project);
    }

    // ---------------------------------------------------------------- reads (both organizations)

    /** Returns the project as a JSON string. Fails with NOT_FOUND if it does not exist. */
    async ReadProject(ctx, id) {
        this._requireMsp(ctx, READER_MSPS, 'read projects');
        requireId(id, 'ReadProject');
        return stableStringify(await this._read(ctx, id));
    }

    /** Returns true/false. */
    async ProjectExists(ctx, id) {
        this._requireMsp(ctx, READER_MSPS, 'read projects');
        requireId(id, 'ProjectExists');
        return this._exists(ctx, id);
    }

    /**
     * Returns every version of the project stored on the ledger, oldest first, as a JSON array of
     * { txId, timestamp, isDelete, value }.
     */
    async GetProjectHistory(ctx, id) {
        this._requireMsp(ctx, READER_MSPS, 'read projects');
        requireId(id, 'GetProjectHistory');

        const iterator = await ctx.stub.getHistoryForKey(id);
        const history = [];
        try {
            for (let res = await iterator.next(); !res.done; res = await iterator.next()) {
                const item = res.value;
                const raw = item.value && item.value.length ? Buffer.from(item.value).toString('utf8') : '';
                history.push({
                    txId: item.txId,
                    timestamp: isoFromTimestamp(item.timestamp.seconds, item.timestamp.nanos),
                    isDelete: Boolean(item.isDelete),
                    value: raw ? normalizeProject(JSON.parse(raw)) : null,
                });
            }
        } finally {
            await iterator.close();
        }
        if (history.length === 0) {
            throw new ChaincodeError('NOT_FOUND', `project ${id} does not exist`);
        }
        // Fabric returns the newest version first; return them in chronological order (oldest first).
        history.reverse();
        return stableStringify(history);
    }

    // ---------------------------------------------------------------- helpers

    _requireMsp(ctx, allowed, action) {
        const msp = ctx.clientIdentity.getMSPID();
        if (!allowed.includes(msp)) {
            throw new ChaincodeError('FORBIDDEN', `organization ${msp} is not allowed to ${action}`);
        }
    }

    async _exists(ctx, id) {
        const data = await ctx.stub.getState(id);
        return Boolean(data) && data.length > 0;
    }

    async _read(ctx, id) {
        const data = await ctx.stub.getState(id);
        if (!data || data.length === 0) {
            throw new ChaincodeError('NOT_FOUND', `project ${id} does not exist`);
        }
        return normalizeProject(JSON.parse(Buffer.from(data).toString('utf8')));
    }
}

module.exports = ProjectContract;
