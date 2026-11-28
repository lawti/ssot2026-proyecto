import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {createAuthentication, registerAuthApi} from '../dist/backend/auth.js';
import {registerRegistroApi} from '../dist/backend/registro.js';
import {verifyPassword} from '../dist/backend/credentials.js';
import {textoBuscable} from '../dist/frontend/texto.js';

const secret = 'test-only-signing-key-with-at-least-32-bytes';
const password = 'una-contrasena-larga';
const usuario = {usuario: 'Sofia.Lopez', nombre: 'Sofía', apellido: 'López', email: 'sofia@ejemplo.com', telefono: null,
    fecha_nacimiento: '2008-05-14', contrasena: password};
const alumno = {rol: 'alumno', usuario, perfil: {nivel_academico: 'secundario'}};
const docente = {rol: 'docente', usuario: {...usuario, usuario: 'pia.rios'}, perfil: {disponibilidad: null, descripcion: null}};

// `fail` lets a test make one INSERT throw, as the database would; it returns the error code
async function start(t, fail, catalogo = ['Álgebra', 'Física']) {
    const statements = [];
    const catalogQueries = [];
    const sessions = new Map();
    const client = {
        async query(sql, values) {
            statements.push({sql, values});
            const code = fail && sql.startsWith('INSERT') && fail(sql);
            if (code) throw Object.assign(new Error('internal detail'), {code: code === true ? '23505' : code});
            return {rows: [], rowCount: 1};
        },
        release() {},
    };
    let connections = 0;
    const pool = {
        // the session lookup of /api/auth/me reads the account the registration inserted
        async query(sql, values) {
            if (sql.includes('FROM "ssot"."materias"')) {
                // como la base: completo si entra en el límite; si no, las coincidencias hasta el límite
                catalogQueries.push(values);
                const [limite, q] = values;
                const filas = catalogo.length <= limite ? catalogo : catalogo.filter(m => textoBuscable(m).includes(textoBuscable(q))).slice(0, limite);
                return {rows: filas.map(materia => ({materia, total: catalogo.length}))};
            }
            return {rows: sessions.has(values[0]) ? [sessions.get(values[0])] : []};
        },
        async connect() { connections++; return client; },
    };
    const app = express();
    const auth = createAuthentication(pool, secret);
    registerAuthApi(app, pool, auth);
    registerRegistroApi(app, pool, auth);
    const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const row = statement => {
        const names = statement.sql.match(/\(([^)]+)\)/)[1].split(', ').map(name => name.replaceAll('"', ''));
        return Object.fromEntries(names.map((name, i) => [name, statement.values[i]]));
    };
    const insertedAll = table => statements.filter(({sql}) => sql.startsWith(`INSERT INTO "ssot"."${table}"`)).map(row);
    const inserted = table => insertedAll(table)[0];
    return {
        statements, inserted, insertedAll, catalogQueries, connections: () => connections,
        remember: row => sessions.set(row.id, {id: row.id, usuario: row.usuario, rol: row.rol, version_sesion: row.version_sesion}),
        request: (path, method = 'GET', body, token) => fetch(base + path, {method,
            headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
            ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        }),
    };
}

test('the registration form fields come from the SSOT, without what the server assigns', async t => {
    const {request} = await start(t);
    const response = await request('/api/registro');
    assert.equal(response.status, 200);
    const campos = await response.json();
    const names = inputs => inputs.map(input => input.name);
    assert.deepEqual(names(campos.usuario), ['usuario', 'nombre', 'apellido', 'email', 'telefono', 'fecha_nacimiento', 'contrasena']);
    assert.deepEqual(names(campos.alumno), ['nivel_academico']);
    assert.deepEqual(names(campos.docente), ['disponibilidad', 'descripcion']);
    assert.deepEqual(campos.alumno[0].constraints.options, ['inicial', 'primario', 'secundario', 'terciario', 'universitario', 'posgrado', 'otro']);
    assert.equal(campos.usuario.at(-1).type, 'password');
});

test('an alumno registers with the user and the subtype row in one transaction, and gets a session and codes', async t => {
    const {request, statements, inserted, remember} = await start(t);
    const response = await request('/api/registro', 'POST', alumno);
    assert.equal(response.status, 201);
    assert.deepEqual(statements.map(({sql}) => sql.split(' (')[0]),
        ['BEGIN', 'INSERT INTO "ssot"."usuarios"', 'INSERT INTO "ssot"."alumnos"', 'COMMIT']);
    const cuenta = inserted('usuarios');
    assert.equal(cuenta.usuario, 'sofia.lopez');
    assert.equal(cuenta.rol, 'alumno');
    assert.equal(await verifyPassword(password, cuenta.contrasena_hash), true);
    assert.ok(!statements.some(({values}) => values?.includes(password)));
    assert.deepEqual(inserted('alumnos'), {id: cuenta.id, rol: 'alumno', nivel_academico: 'secundario'});
    const body = await response.json();
    assert.deepEqual(body.user, {id: cuenta.id, usuario: 'sofia.lopez', rol: 'alumno'});
    assert.equal(body.codes.length, 8);
    assert.equal(JSON.parse(cuenta.recuperacion_hashes).length, 8);
    remember(cuenta);
    const me = await request('/api/auth/me', 'GET', undefined, body.token);
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), body.user);
});

test('a docente can register without availability or description yet', async t => {
    const {request, inserted} = await start(t);
    const response = await request('/api/registro', 'POST', docente);
    assert.equal(response.status, 201);
    assert.deepEqual(inserted('docentes'), {id: inserted('usuarios').id, rol: 'docente', disponibilidad: null, descripcion: null});
    assert.equal(inserted('alumnos'), undefined);
});

test('the subject catalog is public and comes complete while it fits the client limit', async t => {
    const {request} = await start(t);
    const response = await request('/api/registro/materias');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {materias: ['Álgebra', 'Física'], completo: true});
});

test('a large subject catalog is searched on the server, like the spreadsheet', async t => {
    const catalogo = Array.from({length: 250}, (_, i) => `Materia ${String(i).padStart(3, '0')}`);
    const {request, catalogQueries} = await start(t, undefined, catalogo);
    const sinBuscar = await (await request('/api/registro/materias')).json();
    assert.equal(sinBuscar.completo, false);
    assert.equal(sinBuscar.materias.length, 200);
    assert.deepEqual(await (await request('/api/registro/materias?q=%20materia%2012')).json(),
        {materias: [...Array.from({length: 10}, (_, i) => `Materia 12${i}`)], completo: false});
    assert.deepEqual(catalogQueries.at(-1), [200, 'materia 12']);
    for (const q of ['?q=a&q=b', `?q=${'x'.repeat(65)}`]) assert.equal((await request(`/api/registro/materias${q}`)).status, 400);
});

test('a docente can register with the subjects they teach, in the same transaction', async t => {
    const {request, statements, inserted, insertedAll} = await start(t);
    const response = await request('/api/registro', 'POST', {...docente, materias: ['Álgebra', 'Física']});
    assert.equal(response.status, 201);
    assert.deepEqual(statements.map(({sql}) => sql.split(' (')[0]), ['BEGIN', 'INSERT INTO "ssot"."usuarios"',
        'INSERT INTO "ssot"."docentes"', 'INSERT INTO "ssot"."dictados"', 'INSERT INTO "ssot"."dictados"', 'COMMIT']);
    const id = inserted('usuarios').id;
    assert.deepEqual(insertedAll('dictados'), [{docente: id, materia: 'Álgebra'}, {docente: id, materia: 'Física'}]);
});

test('a subject that is not in the catalog is reported and rolls back', async t => {
    const {request, statements} = await start(t, sql => sql.includes('"dictados"') && '23503');
    const response = await request('/api/registro', 'POST', {...docente, materias: ['Astrología']});
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {error: 'Alguna de las materias elegidas no existe.'});
    assert.equal(statements.at(-1).sql, 'ROLLBACK');
});

test('invalid registrations fail before opening a connection', async t => {
    const {request, connections} = await start(t);
    for (const body of [
        {...alumno, rol: 'administrador'},
        {...alumno, rol: undefined},
        {usuario, perfil: alumno.perfil},
        {...alumno, extra: true},
        {...alumno, usuario: {...usuario, rol: 'administrador'}},
        {...alumno, usuario: {...usuario, contrasena_hash: 'x'}},
        {...alumno, usuario: {...usuario, nombre: undefined}},
        {...alumno, usuario: {...usuario, contrasena: 'corta'}},
        {...alumno, usuario: 'sofia'},
        {...alumno, perfil: {...alumno.perfil, id: 'otro-id'}},
        {...alumno, perfil: {...alumno.perfil, rol: 'alumno'}},
        {...alumno, perfil: {nivel_academico: 'doctorado'}},
        {...alumno, perfil: docente.perfil},
        {...alumno, materias: ['Álgebra']},
        {...docente, materias: 'Álgebra'},
        {...docente, materias: ['Álgebra', 'Álgebra']},
        {...docente, materias: [1]},
        {...docente, materias: Array.from({length: 31}, (_, i) => `Materia ${i}`)},
    ]) {
        const response = await request('/api/registro', 'POST', body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(typeof (await response.json()).error, 'string');
    }
    assert.equal(connections(), 0);
});

test('a taken username or email is reported without database details and rolls back', async t => {
    const {request, statements} = await start(t, sql => sql.includes('"alumnos"'));
    const response = await request('/api/registro', 'POST', alumno);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {error: 'Ese usuario o email ya está registrado.'});
    assert.equal(statements.at(-1).sql, 'ROLLBACK');
    assert.ok(!statements.some(({sql}) => sql === 'COMMIT'));
});
