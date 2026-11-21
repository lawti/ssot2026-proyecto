import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {registerEntityApi} from '../dist/backend/api.js';
import {myEntities, entityLabels} from '../dist/backend/system.js';
import {browsing} from '../dist/backend/browsing.js';
import {entityResult} from './helpers/entity-result.mjs';
import {createAuthentication} from '../dist/backend/auth.js';
import {appTypeBehaviours} from '../dist/backend/value-types.js';

const tokens = new Map();
const fetch = (url, options = {}) => globalThis.fetch(url, {...options,
    headers: {...options.headers, Authorization: `Bearer ${tokens.get(new URL(url).origin)}`},
});

async function startApi(t, query) {
    const app = express();
    const user = {id: 'admin', usuario: 'admin', rol: 'administrador', version_sesion: 'test-version'};
    const auth = createAuthentication({query: async () => ({rows: [user]})}, 'test-only-secret-with-at-least-32-bytes');
    registerEntityApi(app, typeof query === 'function' ? {query, connect: async () => { throw new Error('Unexpected transaction'); }} : query, auth);
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const base = `http://127.0.0.1:${server.address().port}`;
    tokens.set(base, (await auth.issueToken(user)).token);
    t.after(() => tokens.delete(base));
    return base;
}

test('entity discovery comes from the SSOT and needs no database query', async t => {
    const base = await startApi(t, () => { throw new Error('Unexpected database query'); });
    const response = await fetch(`${base}/api/entities`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), Object.keys(myEntities).map(name => ({name, label: entityLabels[name]})));
    for (const name of ['unknown', 'constructor', 'materias;DROP TABLE ssot.materias']) {
        const invalid = await fetch(`${base}/api/entities/${encodeURIComponent(name)}`);
        assert.equal(invalid.status, 404);
        assert.deepEqual(await invalid.json(), {error: 'Entidad desconocida'});
    }
});


const regla = {clase: 'c1', fecha_inicio: '2026-03-02', hora_inicio: '18:00', hora_fin: '19:30', intervalo: 1, repeticiones: 4};
const reglaKey = row => Object.fromEntries(myEntities.reglas_horarias.pk.map(name => [name, row[name]]));

test('entity data preserves JSON value types and exposes only display metadata', async t => {
    let sql;
    const base = await startApi(t, async query => {
        sql = query;
        return entityResult([{...regla, repeticiones: null, private_extra: 'omit'}]);
    });
    const response = await fetch(`${base}/api/entities/reglas_horarias`);
    assert.equal(response.status, 200);
    const body = await response.json();
    const {columns, inputs, ...rest} = body;
    assert.deepEqual(rest, {
        name: 'reglas_horarias',
        label: 'Reglas horarias', browsing, window: {kind: 'complete'}, versions: ['1'],
        pk: ['clase', 'fecha_inicio', 'hora_inicio'],
        foreignKeys: [{name: 'clase', entity: 'clases', fields: {clase: 'id'}, displayFields: ['id', 'materia', 'ubicacion']}],
        rows: [{...regla, repeticiones: null}],
    });
    assert.deepEqual(columns.map(({name, type, nullable, writable}) => ({name, type, nullable, writable})), [
        {name: 'clase', type: 'text', nullable: false, writable: true},
        {name: 'fecha_inicio', type: 'fecha', nullable: false, writable: true},
        {name: 'hora_inicio', type: 'hora', nullable: false, writable: true},
        {name: 'hora_fin', type: 'hora', nullable: false, writable: true},
        {name: 'intervalo', type: 'posInteger', nullable: false, writable: true},
        {name: 'repeticiones', type: 'posInteger', nullable: true, writable: true},
    ]);
    assert.deepEqual(Object.keys(columns[0]), ['name', 'label', 'type', 'nullable', 'writable', 'constraints']);
    assert.deepEqual(inputs.map(input => input.name), columns.map(column => column.name));
    assert.deepEqual(Object.keys(inputs[0]), ['name', 'label', 'type', 'nullable', 'constraints', 'optionalOnUpdate']);
    // app metadata that is not display metadata stays in the backend
    assert.doesNotMatch(JSON.stringify(body), /requeridoPorReferido|validators|private_extra/);
    assert.match(sql, /SELECT "clase", "fecha_inicio", "hora_inicio", "hora_fin", "intervalo", "repeticiones"/);
    assert.match(sql, /FROM "ssot"\."reglas_horarias"/);
    assert.match(sql, /ORDER BY "clase" COLLATE "C" asc NULLS LAST, "fecha_inicio" asc NULLS LAST, "hora_inicio" asc NULLS LAST/);
});

test('empty entities still return their columns', async t => {
    const base = await startApi(t, async () => entityResult([]));
    const response = await fetch(`${base}/api/entities/clases`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.name, 'clases');
    assert.deepEqual(body.rows, []);
    // the generated id is hidden; the inherited dictado key is shown
    assert.deepEqual(body.columns.map(column => column.name), ['docente', 'materia', 'presencial', 'ubicacion', 'estado']);
    assert.equal(body.columns[2].type, 'boolean');
});

test('database errors and rows inconsistent with the SSOT return a JSON error', async t => {
    const clase = {id: 'c1', docente: 'd1', materia: 'Álgebra', presencial: true, ubicacion: 'Aula 3', estado: 'pendiente'};
    const rows = [
        {...clase, presencial: 'true'},
        {...clase, id: null},
        {id: 'c1', ubicacion: 'Missing required fields'},
    ];
    const base = await startApi(t, async () => {
        if (rows.length) return entityResult([rows.shift()]);
        throw new Error('Internal database details');
    });
    for (let index = 0; index < 4; index++) {
        const response = await fetch(`${base}/api/entities/clases`);
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {error: 'No se pudieron procesar los datos.'});
    }
});

const send = (base, name, method, body) => fetch(`${base}/api/entities/${name}`, {
    method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
});

test('positive integers and enums validate parsed values without coercion', () => {
    const positive = appTypeBehaviours.posInteger;
    for (const value of [1, 2026]) {
        assert.equal(positive.check(value), true);
        assert.deepEqual(positive.deserialize(positive.serialize(value)), {ok: true, value});
    }
    for (const value of [0, -1, 1.5, NaN, Infinity, '1', true, null]) assert.equal(positive.check(value), false);
    for (const text of ['0', '-1', '1.5', '', 'Infinity', '9'.repeat(400)]) assert.equal(positive.deserialize(text).ok, false);
    for (const [type, values, invalid] of [
        ['estadoSolicitud', ['abierta', 'rechazada'], ['Abierta', 'cerrada', '']],
        ['estadoAmistad', ['pendiente', 'bloqueada'], ['Bloqueada', 'bloqueado', '']],
        ['estadoClase', ['pendiente', 'cancelada'], ['Pendiente', 'borrador', '']],
    ]) {
        const behaviour = appTypeBehaviours[type];
        for (const value of values) {
            assert.equal(behaviour.check(value), true);
            assert.deepEqual(behaviour.deserialize(behaviour.serialize(value)), {ok: true, value});
        }
        for (const invalidText of invalid) {
            assert.equal(behaviour.check(invalidText), false);
            assert.equal(behaviour.deserialize(invalidText).ok, false);
        }
        assert.equal(behaviour.check(1), false);
    }
});

test('schedule rule metadata supplies the positive minimum and enum choices to editors', async t => {
    const base = await startApi(t, async () => entityResult([]));
    const response = await fetch(`${base}/api/entities/reglas_horarias`);
    assert.equal(response.status, 200);
    const {inputs} = await response.json();
    const input = name => inputs.find(column => column.name === name);
    assert.equal(input('intervalo').type, 'posInteger');
    assert.equal(input('intervalo').constraints.minimum, 1);
    assert.equal(input('intervalo').nullable, false);
    assert.equal(input('repeticiones').type, 'posInteger');
    assert.equal(input('repeticiones').nullable, true);
    assert.equal(input('dia'), undefined, 'the weekday comes from fecha_inicio');
});

test('friendship and subject request states offer their enum choices to editors', async t => {
    const base = await startApi(t, async () => entityResult([]));
    for (const [name, options] of [
        ['amistades', ['pendiente', 'aceptada', 'rechazada', 'bloqueada']],
        ['solicitudes', ['abierta', 'aceptada', 'rechazada', 'retirada']],
    ]) {
        const {inputs} = await (await fetch(`${base}/api/entities/${name}`)).json();
        const estado = inputs.find(column => column.name === 'estado');
        assert.deepEqual(estado.constraints.options, options);
        assert.equal(estado.nullable, false);
    }
});

test('invalid schedule rule values and keys are rejected before querying on create, update and delete', async t => {
    let calls = 0;
    const base = await startApi(t, async () => { calls++; return {rowCount: 1}; });
    const key = reglaKey(regla);
    for (const [field, values] of [
        ['intervalo', [0, -1, 1.5, '2', null]],
        ['fecha_inicio', ['2026-02-30', '02/03/2026', 1, null]],
        ['repeticiones', [0, -1, 1.5, '4']],
    ]) {
        for (const value of values) {
            const row = {...regla, [field]: value};
            for (const [method, body] of [['POST', row], ['PUT', {key, row, version: '1'}]]) {
                const response = await send(base, 'reglas_horarias', method, body);
                assert.equal(response.status, 400, `${method} ${field}=${value}`);
                assert.ok((await response.json()).problems.some(problem => problem.field === field));
            }
            if (field in key) {
                const invalidKey = {...key, [field]: value};
                assert.equal((await send(base, 'reglas_horarias', 'DELETE', invalidKey)).status, 400);
                assert.equal((await send(base, 'reglas_horarias', 'PUT', {key: invalidKey, row: regla, version: '1'})).status, 400);
            }
        }
    }
    assert.equal(calls, 0);
});

test('valid enums, positive boundary and endless repetitions retain their values', async t => {
    const queries = [];
    const base = await startApi(t, async (sql, values) => { queries.push({sql, values}); return {rowCount: 1}; });
    for (const repeticiones of [4, 1, null]) {
        const row = {...regla, intervalo: 1, repeticiones};
        assert.equal((await send(base, 'reglas_horarias', 'POST', row)).status, 204);
        assert.deepEqual(queries.at(-1).values, Object.values(row));
        const updated = {...row, fecha_inicio: '2026-03-03'};
        assert.equal((await send(base, 'reglas_horarias', 'PUT', {key: reglaKey(row), row: updated, version: '1'})).status, 204);
        assert.deepEqual(queries.at(-1).values, [...Object.values(updated), ...Object.values(reglaKey(row)), '1']);
    }
});

test('CRUD uses parameters and targets the original key when the key is edited', async t => {
    const queries = [];
    const base = await startApi(t, async (sql, values) => { queries.push({sql, values}); return {rowCount: 1}; });
    const materia = "O'Reilly <script>";
    assert.equal((await send(base, 'materias', 'POST', {materia})).status, 204);
    assert.match(queries[0].sql, /^INSERT INTO "ssot"\."materias"/);
    assert.deepEqual(queries[0].values, [materia]);
    assert.ok(!queries[0].sql.includes(materia));
    assert.equal((await send(base, 'materias', 'PUT', {key: {materia}, version: '1', row: {materia: 'Renamed'}})).status, 204);
    assert.match(queries[1].sql, /WHERE "materia" = \$2 AND xmin::text = \$3$/);
    assert.deepEqual(queries[1].values, ['Renamed', materia, '1']);
    assert.equal((await send(base, 'materias', 'DELETE', {materia: 'Renamed'})).status, 204);
    assert.match(queries[2].sql, /^DELETE FROM "ssot"\."materias" WHERE "materia" = \$1$/);
    assert.deepEqual(queries[2].values, ['Renamed']);
    assert.equal((await send(base, 'dictados', 'POST', {docente: '', materia: 'Álgebra'})).status, 204);
    assert.deepEqual(queries[3].values, ['', 'Álgebra']);
});

test('invalid shapes, types, keys and SSOT business rules fail before querying', async t => {
    let calls = 0;
    const base = await startApi(t, async () => { calls++; return {rowCount: 1}; });
    const row = regla;
    for (const body of [null, [], {}, {...row, clase: null}, {...row, fecha_inicio: null}, {...row, intervalo: '2'},
        {...row, extra: true}, {...row, hora_fin: '17:00'}]) {
        const response = await send(base, 'reglas_horarias', 'POST', body);
        assert.equal(response.status, 400);
        assert.equal(typeof (await response.json()).error, 'string');
    }
    const key = reglaKey(row);
    for (const invalidKey of [{}, {...key, clase: null}, {clase: 'c1'}, {...key, extra: true}]) {
        assert.equal((await send(base, 'reglas_horarias', 'DELETE', invalidKey)).status, 400);
        assert.equal((await send(base, 'reglas_horarias', 'PUT', {key: invalidKey, row, version: '1'})).status, 400);
    }
    assert.equal((await send(base, 'reglas_horarias', 'PUT', row)).status, 400);
    assert.equal((await fetch(`${base}/api/entities/reglas_horarias`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{'})).status, 400);
    assert.equal(calls, 0);
});

test('missing rows and constraint conflicts have useful, non-sensitive errors', async t => {
    const base = await startApi(t, async sql => {
        if (sql.startsWith('INSERT')) throw Object.assign(new Error('Internal query and credentials'), {code: '23505'});
        return {rowCount: 0};
    });
    assert.equal((await send(base, 'materias', 'PUT', {key: {materia: 'Álgebra'}, version: '1', row: {materia: 'Física'}})).status, 409);
    assert.equal((await send(base, 'materias', 'DELETE', {materia: 'Álgebra'})).status, 404);
    const conflict = await send(base, 'materias', 'POST', {materia: 'Álgebra'});
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), {error: 'Ya existe un registro con esa clave.'});
});

test('referenced key changes explain the dependent entity without exposing database details', async t => {
    let referencingTable = 'dictados';
    const base = await startApi(t, async () => {
        throw Object.assign(new Error('Internal SQL and submitted values'), {
            code: '23503', table: referencingTable, detail: 'Sensitive record contents',
        });
    });
    const update = {key: {materia: 'Álgebra'}, row: {materia: 'Álgebra II'}, version: '1'};
    for (let attempt = 0; attempt < 2; attempt++) {
        const response = await send(base, 'materias', 'PUT', update);
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), {
            error: 'No se puede cambiar la clave porque hay registros en Materias que ofrece cada docente que utilizan esta fila. Tu borrador se conserva; podés corregir la clave o cancelar los cambios.',
        });
    }
    const unchangedKey = await send(base, 'materias', 'PUT', {...update, row: {materia: 'Álgebra'}});
    assert.deepEqual(await unchangedKey.json(), {error: 'El registro tiene una referencia inválida o está siendo utilizado.'});
    // An outgoing or unknown constraint must not be misreported as a dependent row.
    for (referencingTable of ['materias', 'unknown']) {
        const response = await send(base, 'materias', 'PUT', update);
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), {error: 'El registro tiene una referencia inválida o está siendo utilizado.'});
    }
});

test('delete dependency checks report simple and composite SSOT foreign keys', async t => {
    const queries = [];
    const base = await startApi(t, async (sql, values) => {
        queries.push({sql, values});
        const clases = sql.includes('FROM "ssot"."clases"');
        return {rows: [{count: clases ? 2 : 1, keys: clases ? [{id: 'c1'}] : [{docente: 'd1', materia: 'Álgebra'}]}]};
    });
    const composite = await fetch(`${base}/api/entities/dictados/delete-check`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({keys: [{docente: 'd1', materia: 'Álgebra'}]}),
    });
    assert.equal(composite.status, 200);
    assert.deepEqual(await composite.json(), {
        blockers: [{entity: 'clases', relationship: 'dictado', count: 2, keys: [{id: 'c1'}]}],
    });
    assert.match(queries[0].sql, /LIMIT 10/);
    assert.match(queries[0].sql, /SELECT DISTINCT dependent\."id" FROM/);
    assert.doesNotMatch(queries[0].sql, /SELECT DISTINCT dependent\.\*/);
    assert.match(queries[0].sql, /dependent\."docente" = target\."docente" AND dependent\."materia" = target\."materia"/);
    assert.deepEqual(queries[0].values, ['d1', 'Álgebra']);

    const simple = await fetch(`${base}/api/entities/materias/delete-check`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({keys: [{materia: 'Álgebra'}]}),
    });
    assert.equal(simple.status, 200);
    assert.deepEqual(await simple.json(), {
        blockers: [{entity: 'dictados', relationship: 'materia', count: 1, keys: [{docente: 'd1', materia: 'Álgebra'}]}],
    });
});

test('bulk delete rejects malformed and duplicate selections before querying', async t => {
    let calls = 0;
    const base = await startApi(t, async () => { calls++; return {rows: []}; });
    for (const keys of [[], [{materia: 1}], [{materia: 'Álgebra'}, {materia: 'Álgebra'}]]) {
        const response = await fetch(`${base}/api/entities/materias/bulk-delete`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({keys}),
        });
        assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
});

test('bulk delete rolls the whole selection back when any row has dependents', async t => {
    const statements = [];
    const client = {
        async query(sql) {
            statements.push(sql);
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return {rowCount: null, rows: []};
            if (sql.includes('FOR UPDATE')) return {rowCount: 2, rows: [{materia: 'Álgebra'}, {materia: 'Física'}]};
            if (sql.startsWith('WITH matching')) return {rows: [{count: 1, keys: [{docente: 'd1', materia: 'Álgebra'}]}]};
            if (sql.startsWith('DELETE')) return {rowCount: 2, rows: []};
            throw new Error('Unexpected query in bulk-delete test');
        },
        release() {},
    };
    const base = await startApi(t, {query: async () => ({rows: []}), connect: async () => client});
    const response = await fetch(`${base}/api/entities/materias/bulk-delete`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({keys: [{materia: 'Álgebra'}, {materia: 'Física'}]}),
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /dictados \(materia\): 1/);
    assert.ok(statements.includes('ROLLBACK'));
    assert.ok(!statements.some(sql => sql.startsWith('DELETE')));
});

test('bulk delete removes all selected rows in one transaction when unreferenced', async t => {
    const statements = [];
    const client = {
        async query(sql) {
            statements.push(sql);
            if (sql === 'BEGIN' || sql === 'COMMIT') return {rowCount: null, rows: []};
            if (sql.includes('FOR UPDATE')) return {rowCount: 2, rows: [{materia: 'Álgebra'}, {materia: 'Física'}]};
            if (sql.startsWith('WITH matching')) return {rows: [{count: 0, keys: []}]};
            if (sql.startsWith('DELETE')) return {rowCount: 2, rows: [{materia: 'Álgebra'}, {materia: 'Física'}]};
            throw new Error('Unexpected query in bulk-delete test');
        },
        release() {},
    };
    const base = await startApi(t, {query: async () => ({rows: []}), connect: async () => client});
    const response = await fetch(`${base}/api/entities/materias/bulk-delete`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({keys: [{materia: 'Álgebra'}, {materia: 'Física'}]}),
    });
    assert.equal(response.status, 204);
    assert.ok(statements.includes('COMMIT'));
    assert.equal(statements.filter(sql => sql.startsWith('DELETE')).length, 1);
    assert.equal(statements.at(-1), 'COMMIT');
});

test('row rules keep the request state, closing date and friendship sender consistent', async t => {
    let calls = 0;
    const base = await startApi(t, async () => { calls++; return {rowCount: 1}; });
    const solicitud = {materia: 'Astronomía', estado: 'abierta', fecha_cierre: null};
    const cierre = '2026-11-20T12:00:00.000Z';
    for (const row of [{...solicitud, fecha_cierre: cierre}, {...solicitud, estado: 'aceptada'}, {...solicitud, estado: 'rechazada'}]) {
        const response = await send(base, 'solicitudes', 'POST', row);
        assert.equal(response.status, 400, JSON.stringify(row));
        assert.ok((await response.json()).problems.some(problem => problem.messageKey === 'solicitud.cierreSegunEstado'));
    }
    const amistad = {alumno_a: 'a1', alumno_b: 'a2', enviada_por: 'a3', estado: 'pendiente'};
    const response = await send(base, 'amistades', 'POST', amistad);
    assert.equal(response.status, 400);
    assert.ok((await response.json()).problems.some(problem => problem.messageKey === 'amistad.enviadaPorIntegrante'));
    assert.equal(calls, 0);
    for (const [name, row] of [['solicitudes', solicitud], ['solicitudes', {...solicitud, estado: 'aceptada', fecha_cierre: cierre}],
        ['amistades', {...amistad, enviada_por: 'a2'}]]) {
        assert.equal((await send(base, name, 'POST', row)).status, 204, JSON.stringify(row));
    }
});

test('a cancelled repetition names an occurrence of its schedule rule and keeps who cancelled it and why', async t => {
    const queries = [];
    const base = await startApi(t, async (sql, values) => { queries.push({sql, values}); return {...entityResult([]), rowCount: 1}; });
    const response = await fetch(`${base}/api/entities/cancelaciones`);
    const {pk, inputs, foreignKeys} = await response.json();
    assert.deepEqual(pk, ['clase', 'fecha_inicio', 'hora_inicio', 'fecha']);
    assert.deepEqual(inputs.map(input => input.name), ['clase', 'fecha_inicio', 'hora_inicio', 'fecha', 'motivo', 'cancelada_por']);
    assert.deepEqual(foreignKeys.map(({name, entity, fields}) => ({name, entity, fields})), [
        {name: 'regla', entity: 'reglas_horarias', fields: {clase: 'clase', fecha_inicio: 'fecha_inicio', hora_inicio: 'hora_inicio'}},
        {name: 'cancelada_por', entity: 'usuarios', fields: {cancelada_por: 'id'}},
    ]);
    const cancelacion = {clase: 'c1', fecha_inicio: '2026-03-02', hora_inicio: '18:00', fecha: '2026-03-16', motivo: 'Feriado', cancelada_por: 'u1'};
    const before = queries.length;
    for (const fecha of ['2026-02-23', '2026-03-03', '2026-03-15']) {
        const rejected = await send(base, 'cancelaciones', 'POST', {...cancelacion, fecha});
        assert.equal(rejected.status, 400, fecha);
        assert.ok((await rejected.json()).problems.some(problem => problem.messageKey === 'cancelacion.noEsOcurrencia'));
    }
    assert.equal((await send(base, 'cancelaciones', 'POST', {...cancelacion, motivo: null})).status, 400);
    assert.equal(queries.length, before);
    for (const fecha of ['2026-03-02', '2026-03-16']) {
        assert.equal((await send(base, 'cancelaciones', 'POST', {...cancelacion, fecha})).status, 204, fecha);
    }
});

test('withdrawing keeps the requester row, and a request withdrawn by everyone is closed', async t => {
    const base = await startApi(t, async () => ({...entityResult([]), rowCount: 1}));
    const {inputs} = await (await fetch(`${base}/api/entities/solicitantes`)).json();
    assert.deepEqual(inputs.find(input => input.name === 'estado').constraints.options, ['activo', 'retirado']);
    const solicitud = {materia: 'Astronomía', estado: 'retirada', fecha_cierre: null};
    assert.equal((await send(base, 'solicitudes', 'POST', solicitud)).status, 400);
    assert.equal((await send(base, 'solicitudes', 'POST', {...solicitud, fecha_cierre: '2026-11-20T12:00:00.000Z'})).status, 204);
});
