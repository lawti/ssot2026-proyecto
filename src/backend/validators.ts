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

/* Los instantes son ISO en UTC con ancho fijo, así que también se comparan como texto.
   `creada` la genera el servidor y no es escribible: en una fila que llega por la API no viene,
   y entonces no hay contra qué comparar (`== null` cubre el ausente y el null). */
export const cierrePosterior = (fila: {creada?: string | null, fecha_cierre: string | null}): readonly Problem[] =>
    fila.creada == null || fila.fecha_cierre === null || fila.fecha_cierre >= fila.creada
        ? [] : [problem('fecha_cierre', 'solicitud.cierreAnteriorACreacion', 'regular')];

// abierta ⇔ sin fecha de cierre
export const cierreSegunEstado = (fila: {estado: 'abierta' | 'aceptada' | 'rechazada' | 'retirada' | null, fecha_cierre: string | null}): readonly Problem[] =>
    fila.estado === null || (fila.estado === 'abierta') === (fila.fecha_cierre === null)
        ? [] : [problem('fecha_cierre', 'solicitud.cierreSegunEstado', 'regular')];

// quien envió la solicitud de amistad es uno de los dos integrantes del par
export const enviadaPorIntegrante = (fila: {alumno_a: string | null, alumno_b: string | null, enviada_por: string | null}): readonly Problem[] =>
    fila.enviada_por === null || fila.enviada_por === fila.alumno_a || fila.enviada_por === fila.alumno_b
        ? [] : [problem('enviada_por', 'amistad.enviadaPorIntegrante', 'regular')];

/* Una cancelación nombra una ocurrencia de su regla: cae el mismo día de la semana que fecha_inicio
   (un múltiplo de 7 días después). Que respete el intervalo y las repeticiones depende de la fila
   de la regla, así que lo controla la app. */
const DIA_MS = 24 * 60 * 60 * 1000;
export const fechaEsOcurrencia = (fila: {fecha_inicio: string | null, fecha: string | null}): readonly Problem[] => {
    if (fila.fecha_inicio === null || fila.fecha === null) return [];
    const dias = (Date.parse(`${fila.fecha}T00:00:00Z`) - Date.parse(`${fila.fecha_inicio}T00:00:00Z`)) / DIA_MS;
    return dias >= 0 && dias % 7 === 0 ? [] : [problem('fecha', 'cancelacion.noEsOcurrencia', 'regular')];
};

export const validadores = {rolAlumno, rolDocente, amistadOrdenada, enviadaPorIntegrante, ubicacionSegunModalidad,
    horaFinPosterior, cierrePosterior, cierreSegunEstado, fechaEsOcurrencia};
