/* Alta pública de alumnos y docentes: el usuario y su fila de subtipo, en una transacción.
   Los campos que se piden son los inputs de creación del SSOT, menos los que fija el servidor
   (`rol`, y el `id` que el subtipo hereda del usuario). Las filas se preparan igual que en la
   planilla, y la cuenta nace con sus códigos de recuperación, como la del administrador inicial. */

import express, {type Express} from 'express';
import type {Pool} from 'pg';
import {completeEntity, isPlainObject} from 'system-definition';
import {authenticationEntity, myContext, myEntities} from './system.js';
import {ApiFailure, apiErrorHandler, readObject} from './api-errors.js';
import {authenticationLimit, type Authentication} from './auth.js';
import {entityInputs} from './column-security.js';
import {insertPreparedRow, prepareEntityWrite} from './entity-write.js';
import {createRecoveryCodes} from './credentials.js';
import type {RegistroCampos, RegistroResponse, RolRegistrable, StoredRow} from './api-contract.js';

const usuarios = completeEntity(myContext, myEntities[authenticationEntity]);
// la jerarquía disjunta: cada rol que se puede registrar, con la entidad de su subtipo
const subtipos = {
    alumno: completeEntity(myContext, myEntities.alumnos),
    docente: completeEntity(myContext, myEntities.docentes),
} satisfies Record<RolRegistrable, unknown>;
const esRolRegistrable = (rol: unknown): rol is RolRegistrable => typeof rol === 'string' && Object.hasOwn(subtipos, rol);
const fijadosPorElServidor = {usuario: ['rol'], perfil: ['id', 'rol']} as const;

function leerParte(value: unknown, parte: keyof typeof fijadosPorElServidor): Record<string, unknown> {
    if (!isPlainObject(value)) throw new ApiFailure(400, 'Se deben enviar exactamente los campos indicados por la API.');
    const fijado = fijadosPorElServidor[parte].find(name => Object.hasOwn(value, name));
    if (fijado) throw new ApiFailure(400, `El campo ${fijado} lo asigna el sistema.`);
    return value;
}

export function registerRegistroApi(app: Express, pool: Pick<Pool, 'connect'>, auth: Authentication): void {
    const router = express.Router();
    router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    router.use(express.json({limit: '8kb'}));
    const campos = {
        usuario: entityInputs(usuarios, fijadosPorElServidor.usuario),
        alumno: entityInputs(subtipos.alumno, fijadosPorElServidor.perfil),
        docente: entityInputs(subtipos.docente, fijadosPorElServidor.perfil),
    } satisfies RegistroCampos;
    router.get('/', (_req, res) => { res.json(campos); });
    router.post('/', authenticationLimit(), async (req, res) => {
        const body = readObject(req.body, ['rol', 'usuario', 'perfil']);
        const rol = body['rol'];
        if (!esRolRegistrable(rol)) throw new ApiFailure(400, 'Elegí si te registrás como alumno o como docente.');
        const subtipo = subtipos[rol];
        // se prepara todo antes de abrir la transacción: un dato inválido no llega a la base
        const usuario = await prepareEntityWrite(usuarios, {...leerParte(body['usuario'], 'usuario'), rol}, 'create');
        const perfil = await prepareEntityWrite(subtipo, {...leerParte(body['perfil'], 'perfil'), id: usuario['id'], rol}, 'create');
        const recovery = createRecoveryCodes();
        Object.assign(usuario, {recuperacion_hashes: recovery.hashes} satisfies Partial<StoredRow<typeof authenticationEntity>>);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await insertPreparedRow(client, usuarios, usuario);
            await insertPreparedRow(client, subtipo, perfil);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            if (error instanceof Error && 'code' in error && error.code === '23505') {
                throw new ApiFailure(409, 'Ese usuario o email ya está registrado.');
            }
            throw error;
        } finally {
            client.release();
        }
        const sesion = usuario as Pick<StoredRow<typeof authenticationEntity>, 'id' | 'usuario' | 'rol' | 'version_sesion'>;
        res.status(201).json({...await auth.issueToken(sesion), codes: recovery.codes} satisfies RegistroResponse);
    });
    router.use(apiErrorHandler);
    app.use('/api/registro', router);
}
