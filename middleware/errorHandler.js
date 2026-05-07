/**
 * Middleware de tratamento de erros global.
 * Captura erros propagados via next(err) ou lançados em handlers async.
 * Deve ser montado DEPOIS de todas as rotas.
 */
function errorHandler(err, req, res, next) {
    const status = err.status || err.statusCode || 500;
    const isProd = process.env.NODE_ENV === 'production';

    console.error(`[ERROR ${req.method} ${req.originalUrl}]`, err);

    if (res.headersSent) return next(err);

    res.status(status).json({
        error: err.message || 'Erro interno do servidor',
        ...(err.details ? { details: err.details } : {}),
        ...(isProd ? {} : { stack: err.stack })
    });
}

/**
 * Safety nets ao nível do processo.
 * Estratégia: log detalhado + process.exit(1) para que o Railway reinicie o processo,
 * em vez de manter um Node em estado potencialmente corrompido.
 */
function installProcessHandlers() {
    process.on('unhandledRejection', (reason, promise) => {
        console.error('[unhandledRejection]', reason);
        console.error('Promise:', promise);
        process.exit(1);
    });

    process.on('uncaughtException', (err) => {
        console.error('[uncaughtException]', err);
        process.exit(1);
    });
}

module.exports = { errorHandler, installProcessHandlers };
