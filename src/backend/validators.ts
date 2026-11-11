/* Las reglas del sistema. Cada una declara la forma de fila que necesita, no la entidad a la
   que pertenece; system.ts las nombra desde cada entidad. Solo pueden ver una fila: las reglas
   entre filas o entre tablas (superposición de clases, disponibilidad del docente) van en la app. */

import {problem, type Problem} from 'system-definition';

type Rol = 'alumno' | 'docente' | 'administrador';

/* La jerarquía usuario → alumno | docente es disjunta: la fk (id, rol) → usuarios(id, rol)
   ata la fila de subtipo al rol del usuario, y estas reglas fijan cuál es ese rol. */
function rolFijo(esperado: Rol) {
    return (fila: {rol: Rol | null}): readonly Problem[] =>
        fila.rol === null || fila.rol === esperado ? [] : [problem('rol', `rol.debeSer.${esperado}`, 'regular')];
}
export const rolAlumno = rolFijo('alumno');
export const rolDocente = rolFijo('docente');

/* La amistad es simétrica: se guarda una sola vez, con el par ordenado. Eso descarta a la vez
   el duplicado (B,A) y la amistad consigo mismo. */
export const amistadOrdenada = (fila: {alumno_a: string | null, alumno_b: string | null}): readonly Problem[] =>
    fila.alumno_a === null || fila.alumno_b === null || fila.alumno_a < fila.alumno_b
        ? [] : [problem('alumno_b', 'amistad.parOrdenado', 'regular')];

const FORMA_DE_URL = /^https?:\/\/\S+$/;

/* Un solo campo ubicación cuya lectura depende de la modalidad: dirección si es presencial,
   URL si es virtual. */
export const ubicacionSegunModalidad = (fila: {presencial: boolean | null, ubicacion: string | null}): readonly Problem[] =>
    fila.presencial === false && fila.ubicacion !== null && !FORMA_DE_URL.test(fila.ubicacion)
        ? [problem('ubicacion', 'ubicacion.virtualRequiereUrl', 'regular')] : [];

// Las horas son HH:MM con ceros a la izquierda, así que se comparan como texto.
export const horaFinPosterior = (fila: {hora_inicio: string | null, hora_fin: string | null}): readonly Problem[] =>
    fila.hora_inicio === null || fila.hora_fin === null || fila.hora_fin > fila.hora_inicio
        ? [] : [problem('hora_fin', 'hora.finPosteriorAlInicio', 'regular')];

// Los instantes son ISO en UTC con ancho fijo, así que también se comparan como texto.
export const cierrePosterior = (fila: {creada: string | null, fecha_cierre: string | null}): readonly Problem[] =>
    fila.creada === null || fila.fecha_cierre === null || fila.fecha_cierre >= fila.creada
        ? [] : [problem('fecha_cierre', 'solicitud.cierreAnteriorACreacion', 'regular')];

export const validadores = {rolAlumno, rolDocente, amistadOrdenada, ubicacionSegunModalidad, horaFinPosterior, cierrePosterior};
