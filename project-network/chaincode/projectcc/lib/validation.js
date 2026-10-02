/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

/**
 * Pure validation helpers. No Date, no randomness, no I/O: safe to run inside chaincode.
 * Every failure throws a ChaincodeError whose message starts with a machine readable code
 * (INVALID_INPUT, NOT_FOUND, ALREADY_EXISTS, FORBIDDEN) so the REST API can map it to an HTTP status.
 */

class ChaincodeError extends Error {
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.name = 'ChaincodeError';
        this.code = code;
    }
}

const invalid = (message) => new ChaincodeError('INVALID_INPUT', message);

const CURRENCY = 'SAR';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_TEXT = 500;

const PROJECT_FIELDS = ['id', 'owner', 'contractor', 'agreedPrice', 'currency', 'milestone', 'payments'];
const TASK_FIELDS = ['description', 'startDate', 'finishDate', 'clientApproved'];
const PAYMENT_FIELDS = ['id', 'amount', 'date', 'note'];

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownFields(obj, allowed, what) {
    for (const key of Object.keys(obj)) {
        if (!allowed.includes(key)) {
            throw invalid(`${what} has an unknown field "${key}" (allowed: ${allowed.join(', ')})`);
        }
    }
}

function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y, m) {
    if (m === 2) {
        return isLeapYear(y) ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** True only for real calendar dates written as YYYY-MM-DD. */
function isValidDate(value) {
    if (typeof value !== 'string') {
        return false;
    }
    const match = DATE_PATTERN.exec(value);
    if (!match) {
        return false;
    }
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function requireText(value, name, what) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw invalid(`${what}: "${name}" is required and must be a non-empty string`);
    }
    if (value.length > MAX_TEXT) {
        throw invalid(`${what}: "${name}" is too long (max ${MAX_TEXT} characters)`);
    }
    return value;
}

function requireId(value, what) {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
        throw invalid(`${what}: "id" is required and must match ${ID_PATTERN} (letters, digits, dot, underscore, dash; max 64)`);
    }
    return value;
}

function requireMoney(value, name, what) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw invalid(`${what}: "${name}" is required and must be a whole number (SAR, no decimals)`);
    }
    if (value <= 0) {
        throw invalid(`${what}: "${name}" must be greater than 0`);
    }
    return value;
}

function optionalDate(value, name, what) {
    if (value === undefined || value === null) {
        return null;
    }
    if (!isValidDate(value)) {
        throw invalid(`${what}: "${name}" must be a real date in YYYY-MM-DD format or null`);
    }
    return value;
}

/** The client's agreement to a task: true or false. Missing means false (not agreed yet). */
function optionalBoolean(value, name, what) {
    if (value === undefined) {
        return false;
    }
    if (typeof value !== 'boolean') {
        throw invalid(`${what}: "${name}" must be true or false`);
    }
    return value;
}

function validateTask(task, index) {
    const what = `milestone[${index}]`;
    if (!isPlainObject(task)) {
        throw invalid(`${what} must be an object`);
    }
    rejectUnknownFields(task, TASK_FIELDS, what);
    const description = requireText(task.description, 'description', what);
    const startDate = optionalDate(task.startDate, 'startDate', what);
    const finishDate = optionalDate(task.finishDate, 'finishDate', what);
    if (finishDate !== null && startDate === null) {
        throw invalid(`${what}: a task cannot have a finishDate without a startDate`);
    }
    // YYYY-MM-DD strings sort chronologically
    if (finishDate !== null && finishDate < startDate) {
        throw invalid(`${what}: finishDate (${finishDate}) cannot be before startDate (${startDate})`);
    }
    const clientApproved = optionalBoolean(task.clientApproved, 'clientApproved', what);
    return { description, startDate, finishDate, clientApproved };
}

/**
 * Projects stored before the field "clientApproved" existed have tasks without it: they read as false.
 * Pure function, used when reading, so every peer returns the same bytes.
 */
function normalizeProject(project) {
    return {
        ...project,
        milestone: (project.milestone || []).map((task) => ({ ...task, clientApproved: task.clientApproved === true })),
    };
}

function totalPaid(payments) {
    return payments.reduce((sum, p) => sum + p.amount, 0);
}

/**
 * Validates project data coming from a caller and returns a clean project object
 * (payments are returned exactly as supplied, if any; the contract decides what to do with them).
 */
function validateProjectInput(input, what) {
    if (!isPlainObject(input)) {
        throw invalid(`${what}: the project must be a JSON object`);
    }
    rejectUnknownFields(input, PROJECT_FIELDS, what);

    const id = requireId(input.id, what);
    const owner = requireText(input.owner, 'owner', what);
    const contractor = requireText(input.contractor, 'contractor', what);
    const agreedPrice = requireMoney(input.agreedPrice, 'agreedPrice', what);

    const currency = input.currency === undefined ? CURRENCY : input.currency;
    if (currency !== CURRENCY) {
        throw invalid(`${what}: "currency" must be "${CURRENCY}"`);
    }

    let milestone = [];
    if (input.milestone !== undefined && input.milestone !== null) {
        if (!Array.isArray(input.milestone)) {
            throw invalid(`${what}: "milestone" must be an array of tasks`);
        }
        milestone = input.milestone.map(validateTask);
    }

    return { id, owner, contractor, agreedPrice, currency, milestone, payments: input.payments };
}

function validatePaymentInput(input) {
    const what = 'payment';
    if (!isPlainObject(input)) {
        throw invalid(`${what} must be a JSON object`);
    }
    rejectUnknownFields(input, PAYMENT_FIELDS, what);

    const id = requireId(input.id, what);
    const amount = requireMoney(input.amount, 'amount', what);
    if (!isValidDate(input.date)) {
        throw invalid(`${what}: "date" is required and must be a real date in YYYY-MM-DD format`);
    }
    let note = '';
    if (input.note !== undefined && input.note !== null) {
        if (typeof input.note !== 'string' || input.note.length > MAX_TEXT) {
            throw invalid(`${what}: "note" must be a string (max ${MAX_TEXT} characters)`);
        }
        note = input.note;
    }
    return { id, amount, date: input.date, note };
}

function parseJson(text, what) {
    if (typeof text !== 'string' || text.trim().length === 0) {
        throw invalid(`${what} is required (a JSON string)`);
    }
    try {
        return JSON.parse(text);
    } catch (err) {
        throw invalid(`${what} is not valid JSON`);
    }
}

module.exports = {
    ChaincodeError,
    CURRENCY,
    isValidDate,
    validateProjectInput,
    validatePaymentInput,
    parseJson,
    requireId,
    totalPaid,
    normalizeProject,
};
