import type {Express} from 'express';

export function registerLandingApi(app: Express): void {
    app.post('/api/landing/message', (req, res) => {
        const {nombre, mensaje} = req.body as {nombre?: string; mensaje?: string};
        if (!mensaje || !mensaje.trim()) {
            res.status(400).json({error: 'El mensaje no puede estar vacío.'});
            return;
        }
        const from = nombre?.trim() || 'Anónimo';
        console.log(`[Landing] Mensaje de "${from}": ${mensaje.trim()}`);
        res.json({ok: true, recibido: {nombre: from, mensaje: mensaje.trim()}});
    });
}

