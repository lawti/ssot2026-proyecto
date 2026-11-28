/* Alta pública de alumnos y docentes: el usuario y su fila de subtipo, en una transacción.
   Los campos que se piden son los inputs de creación del SSOT, menos los que fija el servidor
   (`rol`, y el `id` que el subtipo hereda del usuario). Las filas se preparan igual que en la
   planilla, y la cuenta nace con sus códigos de recuperación, como la del administrador inicial.
   El docente puede elegir además, opcionalmente, las materias que ofrece: filas de dictados. */

import express, {type Express} from 'express';
import type {Pool} from 'pg';
import {completeEntity, isPlainObject, type EntityInfo} from 'system-definition';
import {authenticationEntity, myContext, myEntities} from './system.js';
import {ApiFailure, apiErrorHandler, readObject} from './api-errors.js';
import {authenticationLimit, type Authentication} from './auth.js';
import {entityInputs} from './column-security.js';
import {insertPreparedRow, prepareEntityWrite} from './entity-write.js';
import {entitySql} from './entity-sql.js';
import {browsing} from './browsing.js';
import {textoBuscable} from './entity-query.js';
import {createRecoveryCodes} from './credentials.js';
import type {RegistroCampos, RegistroMaterias, RegistroResponse, RolRegistrable, StoredRow} from './api-contract.js';

const usuarios = completeEntity(myContext, myEntities[authenticationEntity]);
// la jerarquía disjunta: cada rol que se puede registrar, con la entidad de su subtipo
const subtipos = {
    alumno: completeEntity(myContext, myEntities.alumnos),
    docente: completeEntity(myContext, myEntities.docentes),
} satisfies Record<RolRegistrable, unknown>;
const esRolRegistrable = (rol: unknown): rol is RolRegistrable => typeof rol === 'string' && Object.hasOwn(subtipos, rol);
// las materias que ofrece un rol al registrarse, con la entidad que las guarda y el campo que lo nombra
const ofertas: Partial<Record<RolRegistrable, {entity: EntityInfo<typeof myContext>; campo: string}>> = {
    docente: {entity: completeEntity(myContext, myEntities.dictados), campo: 'docente'},
};
const maximoMaterias = 30;
const catalogo = entitySql('materias');
const largoBusqueda = 64;

/* El catálogo sigue la regla de la planilla (browsing.ts): si entra en browsing.clientRows filas
   viene completo y el navegador filtra; si no, se busca en el servidor por `q` y vuelven a lo sumo
   esas filas. Una sola sentencia, para que el total y las filas salgan de la misma foto. */
async function buscarMaterias(pool: Pick<Pool, 'query'>, q: unknown): Promise<RegistroMaterias> {
    if (q !== undefined && (typeof q !== 'string' || q.length > largoBusqueda)) throw new ApiFailure(400, 'Búsqueda inválida.');
    const materia = catalogo.column('materia');
    const {rows} = await pool.query<{materia: string; total: number}>(
        `WITH total AS (SELECT count(*)::int AS n FROM ${catalogo.table}) ` +
        `SELECT ${materia} AS materia, (SELECT n FROM total) AS total FROM ${catalogo.table} ` +
        `WHERE (SELECT n FROM total) <= $1 OR strpos(${textoBuscable(materia)}, ${textoBuscable('$2')}) > 0 ` +
        `ORDER BY ${materia} LIMIT $1`, [browsing.clientRows, q?.trim() ?? '']);
    return {materias: rows.map(row => row.materia), completo: (rows[0]?.total ?? 0) <= browsing.clientRows};
}

function leerMaterias(value: unknown, rol: RolRegistrable): string[] {
    if (value === undefined) return [];
    if (!ofertas[rol]) throw new ApiFailure(400, 'Solo los docentes eligen materias al registrarse.');
    if (!Array.isArray(value) || value.some(materia => typeof materia !== 'string') || new Set(value).size !== value.length) {
        throw new ApiFailure(400, 'Las materias se envían como una lista de nombres, sin repetir.');
    }
    if (value.length > maximoMaterias) throw new ApiFailure(400, `Se pueden elegir hasta ${maximoMaterias} materias.`);
    return value;
}
const fijadosPorElServidor = {usuario: ['rol'], perfil: ['id', 'rol']} as const;

function leerParte(value: unknown, parte: keyof typeof fijadosPorElServidor): Record<string, unknown> {
    if (!isPlainObject(value)) throw new ApiFailure(400, 'Se deben enviar exactamente los campos indicados por la API.');
    const fijado = fijadosPorElServidor[parte].find(name => Object.hasOwn(value, name));
    if (fijado) throw new ApiFailure(400, `El campo ${fijado} lo asigna el sistema.`);
    return value;
}

export function registerRegistroApi(app: Express, pool: Pick<Pool, 'connect' | 'query'>, auth: Authentication): void {
    const router = express.Router();
    router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    router.use(express.json({limit: '8kb'}));
    const campos = {
        usuario: entityInputs(usuarios, fijadosPorElServidor.usuario),
        perfiles: {
            alumno: entityInputs(subtipos.alumno, fijadosPorElServidor.perfil),
            docente: entityInputs(subtipos.docente, fijadosPorElServidor.perfil),
        },
        eligenMaterias: Object.keys(ofertas) as RolRegistrable[],
    } satisfies RegistroCampos;
    router.get('/', (_req, res) => { res.json(campos); });
    router.get('/materias', async (req, res) => { res.json(await buscarMaterias(pool, req.query['q'])); });
    router.post('/', authenticationLimit(), async (req, res) => {
        const body = readObject(req.body, ['rol', 'usuario', 'perfil'], ['materias']);
        const rol = body['rol'];
        if (!esRolRegistrable(rol)) throw new ApiFailure(400, 'Elegí si te registrás como alumno o como docente.');
        const subtipo = subtipos[rol];
        const elegidas = leerMaterias(body['materias'], rol);
        // se prepara todo antes de abrir la transacción: un dato inválido no llega a la base
        const usuario = await prepareEntityWrite(usuarios, {...leerParte(body['usuario'], 'usuario'), rol}, 'create');
        const perfil = await prepareEntityWrite(subtipo, {...leerParte(body['perfil'], 'perfil'), id: usuario['id'], rol}, 'create');
        const oferta = ofertas[rol];
        const materias = await Promise.all(elegidas.map(materia => prepareEntityWrite(oferta!.entity, {[oferta!.campo]: usuario['id'], materia}, 'create')));
        const recovery = createRecoveryCodes();
        Object.assign(usuario, {recuperacion_hashes: recovery.hashes} satisfies Partial<StoredRow<typeof authenticationEntity>>);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await insertPreparedRow(client, usuarios, usuario);
            await insertPreparedRow(client, subtipo, perfil);
            for (const materia of materias) await insertPreparedRow(client, oferta!.entity, materia);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            if (error instanceof Error && 'code' in error && error.code === '23505') {
                throw new ApiFailure(409, 'Ese usuario o email ya está registrado.');
            }
            // la única fk que puede fallar es la de una materia que no está en el catálogo
            if (error instanceof Error && 'code' in error && error.code === '23503') {
                throw new ApiFailure(400, 'Alguna de las materias elegidas no existe.');
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
