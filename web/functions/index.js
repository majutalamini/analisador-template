const { onRequest } = require('firebase-functions/v2/https');
const { exportarGoogleDoc } = require('./exportar');

// Chamada pela página em /api/google-doc?id=<ID do documento> (rota definida no firebase.json).
exports.exportarGoogleDoc = onRequest(
  { region: 'southamerica-east1', maxInstances: 5, timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (req.method !== 'GET') {
      res.status(405).json({ erro: 'Método não permitido.' });
      return;
    }
    const r = await exportarGoogleDoc(String(req.query.id || ''));
    res.set('Cache-Control', 'no-store');
    if (r.status !== 200) {
      res.status(r.status).json({ erro: r.erro });
      return;
    }
    res.set('Content-Type', r.tipo);
    res.status(200).send(r.corpo);
  }
);
