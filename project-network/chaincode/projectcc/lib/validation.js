/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const { MAX_AMOUNT, hasAtMostTwoDecimals, toHalalas, sumAmounts, formatSar } = require('./money');

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
const MAX_DESCRIPTION = 5000; // typical database text limit

// Task lifecycle of a marketplace-style app: proposed -> accepted -> done -> approved (or rejected)
const TASK_STATUSES = ['proposed', 'accepted', 'done', 'approved', 'rejected'];
const FINISHED_STATUSES = ['done', 'approved'];

// One simple, deterministic check: something@something.tld, no spaces (the authoritative address check is the sender's)
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254; // the usual limit for an e-mail address

// owner / contractor = display names; ownerId / contractorId = the stable ids in the marketplace database;
// ownerEmail / contractorEmail = their e-mail addresses
const PARTY_FIELDS = ['ownerId', 'ownerEmail', 'contractorId', 'contractorEmail'];
const PROJECT_FIELDS = ['id', 'owner', 'ownerId', 'ownerEmail', 'contractor', 'contractorId', 'contractorEmail',
    'agreedPrice', 'currency', 'milestone', 'payments'];
const TASK_FIELDS = ['description', 'startDate', 'finishDate', 'status'];
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

function requireText(value, name, what, max = MAX_TEXT) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw invalid(`${what}: "${name}" is required and must be a non-empty string`);
    }
    if (value.length > max) {
        throw invalid(`${what}: "${name}" is too long (max ${max} characters)`);
    }
    return value;
}

function requireId(value, what, name = 'id') {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
        throw invalid(`${what}: "${name}" is required and must match ${ID_PATTERN} (letters, digits, dot, underscore, dash; max 64)`);
    }
    return value;
}

function requireEmail(value, name, what) {
    if (typeof value !== 'string' || !EMAIL_PATTERN.test(value)) {
        throw invalid(`${what}: "${name}" is required and must be an e-mail address such as name@example.com`);
    }
    if (value.length > MAX_EMAIL) {
        throw invalid(`${what}: "${name}" is too long (max ${MAX_EMAIL} characters)`);
    }
    return value;
}

/** SAR with at most 2 decimals, greater than 0, at most 9,999,999,999.99 (like a numeric(12,2) database column). */
function requireMoney(value, name, what) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw invalid(`${what}: "${name}" is required and must be a number in SAR (at most 2 decimals)`);
    }
    if (value <= 0) {
        throw invalid(`${what}: "${name}" must be greater than 0`);
    }
    if (value > MAX_AMOUNT) {
        throw invalid(`${what}: "${name}" is too large (max ${formatSar(MAX_AMOUNT)} SAR)`);
    }
    if (!hasAtMostTwoDecimals(value)) {
        throw invalid(`${what}: "${name}" must have at most 2 decimals`);
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

/** Task status. Missing means "proposed". */
function optionalStatus(value, name, what) {
    if (value === undefined) {
        return 'proposed';
    }
    if (!TASK_STATUSES.includes(value)) {
        throw invalid(`${what}: "${name}" must be one of ${TASK_STATUSES.join(', ')}`);
    }
    return value;
}

function validateTask(task, index) {
    const what = `milestone[${index}]`;
    if (!isPlainObject(task)) {
        throw invalid(`${what} must be an object`);
    }
    rejectUnknownFields(task, TASK_FIELDS, what);
    const description = requireText(task.description, 'description', what, MAX_DESCRIPTION);
    const startDate = optionalDate(task.startDate, 'startDate', what);
    const finishDate = optionalDate(task.finishDate, 'finishDate', what);
    if (finishDate !== null && startDate === null) {
        throw invalid(`${what}: a task cannot have a finishDate without a startDate`);
    }
    // YYYY-MM-DD strings sort chronologically
    if (finishDate !== null && finishDate < startDate) {
        throw invalid(`${what}: finishDate (${finishDate}) cannot be before startDate (${startDate})`);
    }
    const status = optionalStatus(task.status, 'status', what);
    // a finish date exists exactly when the task is done or approved
    if (FINISHED_STATUSES.includes(status) && finishDate === null) {
        throw invalid(`${what}: status "${status}" needs a finishDate`);
    }
    if (!FINISHED_STATUSES.includes(status) && finishDate !== null) {
        throw invalid(`${what}: finishDate can only be set when the status is ${FINISHED_STATUSES.join(' or ')}`);
    }
    return { description, startDate, finishDate, status };
}

/**
 * Tasks stored by earlier chaincode versions have no "status" (1.1 had only dates; 1.2 had a true/false
 * "clientApproved"). They read as: finishDate set -> done, clientApproved true -> accepted, otherwise proposed.
 * Pure function, used when reading, so every peer returns the same bytes.
 */
function normalizeTask(task) {
    const { clientApproved, ...rest } = task;
    let { status } = rest;
    if (!TASK_STATUSES.includes(status)) {
        status = rest.finishDate ? 'done' : (clientApproved === true ? 'accepted' : 'proposed');
    }
    return { ...rest, status };
}

/**
 * Projects stored before version 1.4 have no owner / contractor ids and e-mails: they read as "" (not recorded)
 * until the project is updated with real values. Pure function, used when reading.
 */
function normalizeProject(project) {
    const parties = {};
    for (const field of PARTY_FIELDS) {
        parties[field] = typeof project[field] === 'string' ? project[field] : '';
    }
    return { ...project, ...parties, milestone: (project.milestone || []).map(normalizeTask) };
}

/** Total of the payments in SAR (exact: summed in halalas). */
function totalPaid(payments) {
    return sumAmounts(payments);
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
    const ownerId = requireId(input.ownerId, what, 'ownerId');
    const ownerEmail = requireEmail(input.ownerEmail, 'ownerEmail', what);
    const contractor = requireText(input.contractor, 'contractor', what);
    const contractorId = requireId(input.contractorId, what, 'contractorId');
    const contractorEmail = requireEmail(input.contractorEmail, 'contractorEmail', what);
    if (ownerId === contractorId) {
        throw invalid(`${what}: the owner and the contractor must be different (ownerId and contractorId are equal)`);
    }
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

    return {
        id, owner, ownerId, ownerEmail, contractor, contractorId, contractorEmail,
        agreedPrice, currency, milestone, payments: input.payments,
    };
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
    TASK_STATUSES,
};
