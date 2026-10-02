// Minimal client for the projects API. Node.js 18+ (built-in fetch), no dependencies.
//   node docs/examples/client.js [base-url]          runs a short demo
// or:  const { ProjectsClient } = require('./client');
'use strict';

class ProjectsClient {
    constructor(baseUrl = 'http://localhost:4000', org = 'platform') {
        this.baseUrl = baseUrl;
        this.org = org; // 'platform' can read and write, 'admin' can only read
    }

    async #request(method, path, body) {
        const res = await fetch(this.baseUrl + path, {
            method,
            headers: { 'X-Org': this.org, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json();
        if (!res.ok) {
            const err = new Error(data.error || `HTTP ${res.status}`);
            err.status = res.status;   // 400, 403, 404, 409, 503 ...
            err.code = data.code;      // INVALID_INPUT, FORBIDDEN, NOT_FOUND, ALREADY_EXISTS, ...
            throw err;
        }
        return data;
    }

    createProject(project)        { return this.#request('POST', '/projects', project); }
    getProject(id)                { return this.#request('GET', `/projects/${encodeURIComponent(id)}`); }
    updateProject(id, project)    { return this.#request('PUT', `/projects/${encodeURIComponent(id)}`, project); }
    addPayment(id, payment)       { return this.#request('POST', `/projects/${encodeURIComponent(id)}/payments`, payment); }
    getHistory(id)                { return this.#request('GET', `/projects/${encodeURIComponent(id)}/history`); }
    health()                      { return this.#request('GET', '/health'); }
}

module.exports = { ProjectsClient };

if (require.main === module) {
    (async () => {
        const api = new ProjectsClient(process.argv[2] || 'http://localhost:4000');
        const id = `PRJ-DEMO-JS-${Math.floor(Date.now() / 1000)}`;

        await api.createProject({ id, owner: 'Layla', contractor: 'Nour Builders', agreedPrice: 10000,
            milestone: [{ description: 'Site survey', startDate: '2026-10-05', finishDate: null, clientApproved: true }] });
        await api.addPayment(id, { id: 'PAY-1', amount: 2500, date: '2026-10-06', note: 'deposit' });
        const project = await api.getProject(id);
        console.log(`${project.id}: paid ${project.totalPaid} of ${project.agreedPrice}, remaining ${project.remaining}, client agreed to: ${project.milestone.map((t) => t.clientApproved)}`);

        const history = await api.getHistory(id);
        console.log(`versions on the ledger: ${history.length}`);

        try {
            await api.createProject({ id, owner: 'x', contractor: 'y', agreedPrice: 1 });
        } catch (e) {
            console.log(`duplicate id -> HTTP ${e.status} ${e.code}: ${e.message}`);
        }
        try {
            await new ProjectsClient(api.baseUrl, 'admin').addPayment(id, { id: 'PAY-2', amount: 1, date: '2026-10-07' });
        } catch (e) {
            console.log(`admin write -> HTTP ${e.status} ${e.code}`);
        }
    })().catch((e) => { console.error(e); process.exit(1); });
}
