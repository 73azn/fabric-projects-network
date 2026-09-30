'use strict';

const express = require('express');
const { projectsRouter } = require('./projects');
const { HttpError, toHttpError } = require('./errors');

function createApp({ fabric, health }) {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '1mb' }));

    app.get('/', (_req, res) => {
        res.json({
            name: 'projects-api',
            endpoints: [
                'GET  /health',
                'POST /projects',
                'GET  /projects/:id',
                'PUT  /projects/:id',
                'POST /projects/:id/payments',
                'GET  /projects/:id/history',
            ],
            header: 'X-Org: platform | admin (default: platform)',
        });
    });

    app.get('/health', async (_req, res, next) => {
        try {
            const { httpStatus, body } = await health();
            res.status(httpStatus).json(body);
        } catch (err) {
            next(err);
        }
    });

    app.use('/projects', projectsRouter({ fabric }));

    app.use((_req, _res, next) => next(new HttpError(404, 'route not found', 'NOT_FOUND')));

    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => {
        const { status, code, message } = toHttpError(err);
        if (status >= 500) {
            console.error(err);
        }
        if (status === 503) {
            res.set('Retry-After', '5');
        }
        res.status(status).json({ error: message, code });
    });

    return app;
}

module.exports = { createApp };
