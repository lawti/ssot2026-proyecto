/* Datos de ejemplo para ver el sistema andando. Las claves de usuarios, clases y solicitudes son
   uuid que genera el servidor, así que un archivo .tab no las puede nombrar: acá cada fila se crea
   con la misma preparación que usa la API y se toma el id que se generó para las filas que la
   referencian. Las filas están tipadas con los inputs de creación de cada entidad, así que un
   cambio en el SSOT que las deje inválidas no compila. */

import type {Pool} from 'pg';
import {completeEntity, type EntityInfo} from 'system-definition';
import {myContext, myEntities} from './system.js';
import {slotsPorSemana} from './value-types.js';
import {insertPreparedRow, prepareEntityWrite} from './entity-write.js';
import type {EntityCreate, EntityName} from './api-contract.js';

const contrasena = 'ejemplo-contrasena';

// lunes = 0; las horas son de inicio inclusive y de fin exclusiva, en medias horas
function disponibilidad(franjas: readonly {dias: readonly number[]; desde: number; hasta: number}[]): string {
    const bits = Array<string>(slotsPorSemana).fill('0');
    for (const {dias, desde, hasta} of franjas) {
        for (const dia of dias) for (let slot = desde * 2; slot < hasta * 2; slot++) bits[dia * 48 + slot] = '1';
    }
    return bits.join('');
}

const persona = (usuario: string, nombre: string, apellido: string, rol: 'alumno' | 'docente') => ({
    usuario, nombre, apellido, rol, contrasena,
    email: `${usuario}@ejemplo.com`, telefono: null, fecha_nacimiento: null,
} satisfies EntityCreate<'usuarios'>);

export async function loadExamples(pool: Pool): Promise<number> {
    const entities = new Map<string, EntityInfo<typeof myContext>>(Object.values(myEntities)
        .map(definition => [definition.name, completeEntity(myContext, definition)]));
    const client = await pool.connect();
    let inserted = 0;
    // devuelve la fila tal como se guardó, con lo que generó el servidor (ids, instantes)
    const create = async <E extends EntityName>(name: E, row: EntityCreate<E>): Promise<Record<string, unknown>> => {
        const entity = entities.get(name)!;
        const prepared = await prepareEntityWrite(entity, row, 'create');
        await insertPreparedRow(client, entity, prepared);
        inserted++;
        return prepared;
    };
    const id = (row: Record<string, unknown>) => String(row['id']);
    try {
        await client.query('BEGIN');

        const pia = id(await create('usuarios', persona('pia.rios', 'Pía', 'Ríos', 'docente')));
        const martin = id(await create('usuarios', persona('martin.gomez', 'Martín', 'Gómez', 'docente')));
        const laura = id(await create('usuarios', persona('laura.fernandez', 'Laura', 'Fernández', 'docente')));
        const sofia = id(await create('usuarios', persona('sofia.lopez', 'Sofía', 'López', 'alumno')));
        const tomas = id(await create('usuarios', persona('tomas.perez', 'Tomás', 'Pérez', 'alumno')));
        const valentina = id(await create('usuarios', persona('valentina.diaz', 'Valentina', 'Díaz', 'alumno')));
        const juan = id(await create('usuarios', persona('juan.martinez', 'Juan', 'Martínez', 'alumno')));

        const semana = [0, 1, 2, 3, 4];
        await create('docentes', {id: pia, rol: 'docente', descripcion: 'Profesora de matemática y física, 10 años de experiencia.',
            disponibilidad: disponibilidad([{dias: semana, desde: 16, hasta: 21}])});
        await create('docentes', {id: martin, rol: 'docente', descripcion: 'Profesor de inglés, preparo exámenes internacionales.',
            disponibilidad: disponibilidad([{dias: [1, 3], desde: 14, hasta: 20}, {dias: [5], desde: 9, hasta: 13}])});
        await create('docentes', {id: laura, rol: 'docente', descripcion: 'Química y álgebra para secundario y CBC.',
            disponibilidad: disponibilidad([{dias: semana, desde: 9, hasta: 12}])});
        await create('alumnos', {id: sofia, rol: 'alumno', nivel_academico: 'secundario'});
        await create('alumnos', {id: tomas, rol: 'alumno', nivel_academico: 'secundario'});
        await create('alumnos', {id: valentina, rol: 'alumno', nivel_academico: 'universitario'});
        await create('alumnos', {id: juan, rol: 'alumno', nivel_academico: 'terciario'});

        for (const materia of ['Álgebra', 'Física', 'Inglés', 'Química']) await create('materias', {materia});
        for (const [docente, materia] of [[pia, 'Álgebra'], [pia, 'Física'], [martin, 'Inglés'], [laura, 'Química'], [laura, 'Álgebra']] as const) {
            await create('dictados', {docente, materia});
        }

        // amistades: el par se guarda ordenado, sin importar quién la envió
        const amistad = async (de: string, para: string, estado: EntityCreate<'amistades'>['estado']) => {
            const [alumno_a, alumno_b] = [de, para].sort();
            await create('amistades', {alumno_a: alumno_a!, alumno_b: alumno_b!, enviada_por: de, estado});
        };
        await amistad(sofia, tomas, 'aceptada');
        await amistad(juan, valentina, 'pendiente');
        await amistad(tomas, valentina, 'rechazada');
        await amistad(juan, sofia, 'bloqueada');

        const ahora = new Date().toISOString();
        const astronomia = id(await create('solicitudes', {materia: 'Astronomía', estado: 'abierta', fecha_cierre: null}));
        await create('solicitantes', {solicitud: astronomia, docente: pia, estado: 'activo'});
        await create('solicitantes', {solicitud: astronomia, docente: laura, estado: 'retirado'});
        const programacion = id(await create('solicitudes', {materia: 'Programación', estado: 'rechazada', fecha_cierre: ahora}));
        await create('solicitantes', {solicitud: programacion, docente: martin, estado: 'activo'});

        // Álgebra con Pía, presencial, lunes y jueves durante 8 semanas
        const algebra = id(await create('clases', {docente: pia, materia: 'Álgebra', presencial: true,
            ubicacion: 'Av. Corrientes 1234, CABA', estado: 'aceptada'}));
        for (const fecha_inicio of ['2026-11-23', '2026-11-26']) {
            await create('reglas_horarias', {clase: algebra, fecha_inicio, hora_inicio: '18:00', hora_fin: '19:30', intervalo: 1, repeticiones: 8});
        }
        await create('participantes', {clase: algebra, alumno: sofia, estado: 'aceptado'});
        await create('participantes', {clase: algebra, alumno: tomas, estado: 'aceptado'});
        await create('participantes', {clase: algebra, alumno: juan, estado: 'baja'});
        await create('cancelaciones', {clase: algebra, fecha_inicio: '2026-11-23', hora_inicio: '18:00', fecha: '2026-12-07',
            motivo: 'Feriado', cancelada_por: pia});

        // Inglés con Martín, virtual, martes semana por medio y sin fin; todavía no la aceptó
        const ingles = id(await create('clases', {docente: martin, materia: 'Inglés', presencial: false,
            ubicacion: 'https://meet.ejemplo.com/ingles', estado: 'pendiente'}));
        await create('reglas_horarias', {clase: ingles, fecha_inicio: '2026-11-24', hora_inicio: '17:00', hora_fin: '18:00', intervalo: 2, repeticiones: null});
        await create('participantes', {clase: ingles, alumno: valentina, estado: 'aceptado'});
        await create('participantes', {clase: ingles, alumno: sofia, estado: 'pendiente'});

        await client.query('COMMIT');
        return inserted;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
