import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {createAuthentication, registerAuthApi} from '../dist/backend/auth.js';
import {registerRegistroApi} from '../dist/backend/registro.js';
import {verifyPassword} from '../dist/backend/credentials.js';

const secret = 'test-only-signing-key-with-at-least-32-bytes';
const password = 'una-contrasena-larga';
const usuario = {usuario: 'Sofia.Lopez', nombre: 'Sofía', apellido: 'López', email: 'sofia@ejemplo.com', telefono: null,
    fecha_nacimiento: '2008-05-14', contrasena: password};
const alumno = {rol: 'alumno', usuario, perfil: {nivel_academico: 'secundario'}};
const docente = {rol: 'docente', usuario: {...usuario, usuario: 'pia.rios'}, perfil: {disponibilidad: null, descripcion: null}};

// `fail` lets a test make one INSERT throw, as the database would
async function start(t, fail) {
    const statements = [];
    const sessions = new Map();
    const client = {
        async query(sql, values) {
            statements.push({sql, values});
            if (fail && sql.startsWith('INSERT') && fail(sql)) throw Object.assign(new Error('internal detail'), {code: '23505'});
            return {rows: [], rowCount: 1};
        },
        release() {},
    };
    let connections = 0;
    const pool = {
        // the session lookup of /api/auth/me reads the account the registration inserted
        async query(_sql, [id]) { return {rows: sessions.has(id) ? [sessions.get(id)] : []}; },
        async connect() { connections++; return client; },
    };
    const app = express();
    const auth = createAuthentication(pool, secret);
    registerAuthApi(app, pool, auth);
    registerRegistroApi(app, pool, auth);
    const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const inserted = table => {
        const statement = statements.find(({sql}) => sql.startsWith(`INSERT INTO "ssot"."${table}"`));
        if (!statement) return undefined;
        const names = statement.sql.match(/\(([^)]+)\)/)[1].split(', ').map(name => name.replaceAll('"', ''));
        return Object.fromEntries(names.map((name, i) => [name, statement.values[i]]));
    };
    return {
        statements, inserted, connections: () => connections,
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
