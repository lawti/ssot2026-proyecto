/* Plataforma que conecta docentes particulares con alumnos.

   Este archivo describe: no declara comportamiento. Los tipos y su lectura/escritura están en
   value-types.ts y las reglas en validators.ts; acá solo se las nombra. Cada etapa withRecords
   es un nivel de profundidad del modelo: un record que hereda la pk de una entidad no puede
   existir antes que ella. */

import { defineTypes, type CoreFieldDef, completeCoreField, defineRecord,
    withRecords, defineEntity, defineEntities, extractPk, captureSystemSnapshot,
    sqlTypes, type SqlTypeMapping,
    type HumanProvider,
    withValidators
} from 'system-definition'
import { humanBehaviours } from "system-definition/examples";
import {appTypeDefs, appTypeBehaviours, inputConstraints} from './value-types.js';
import {validadores} from './validators.js';
export {migrationAuthoring} from './migration-authoring.js';

const myHumanBehaviours: HumanProvider<typeof appTypeDefs> = {...humanBehaviours};

type MyFieldDef = CoreFieldDef<typeof appTypeDefs> & {
    isName?: boolean
    label?: string
    description?: string
    maxLength?: number
    readable?: boolean
    visible?: boolean
    writable?: boolean
    inputName?: string
    inputType?: keyof typeof appTypeDefs
    transform?: 'username' | 'password' | null
    onCreate?: 'uuid' | 'now' | 'empty-array' | null
    onUpdate?: 'uuid' | null
    onPasswordChange?: 'empty-array' | null
    // en un campo de fk: toda fila referida tiene que tener al menos una fila de esta entidad
    requeridoPorReferido?: boolean
}

const myTypes = defineTypes({
    types: appTypeDefs,
    behaviours: appTypeBehaviours,
    human: myHumanBehaviours,
    completeField: (fieldDef: MyFieldDef, name: string) => ({
        ...completeCoreField(fieldDef, name),
        isName     : fieldDef.isName ?? false,
        label      : fieldDef.label ?? name.replace(/_/g,' '),
        description: fieldDef.description ?? '',
        maxLength  : fieldDef.maxLength ?? 100,
        readable   : fieldDef.readable ?? true,
        visible    : fieldDef.visible ?? true,
        writable   : fieldDef.writable ?? true,
        inputName  : fieldDef.inputName ?? name,
        inputType  : fieldDef.inputType ?? fieldDef.type,
        inputConstraints: inputConstraints[fieldDef.inputType ?? fieldDef.type],
        transform  : fieldDef.transform ?? null,
        onCreate   : fieldDef.onCreate ?? null,
        onUpdate   : fieldDef.onUpdate ?? null,
        onPasswordChange: fieldDef.onPasswordChange ?? null,
        requeridoPorReferido: fieldDef.requeridoPorReferido ?? false,
    }),
})

// las reglas entran al contexto antes que las entidades, porque son las entidades las que las nombran
const myTypesConReglas = withValidators(myTypes, validadores)

/* Las pks propias que son uuid se generan al crear y nadie las escribe. Cuando otra entidad las
   hereda con extractPk pasan a ser una referencia: se eligen, se ven, y no se generan. */
const comoReferencia = {writable: true as const, visible: true as const, onCreate: null};

/* NIVEL 1: lo que no depende de nada */

const usuario = defineRecord(myTypes, {
    id: {type: 'text', nullable: false, writable: false as const, visible: false as const, onCreate: 'uuid' as const},
    usuario: {type: 'text', label: 'Usuario', nullable: false, transform: 'username' as const},
    nombre: {type: 'text', label: 'Nombre', nullable: false, isName: true},
    apellido: {type: 'text', label: 'Apellido', nullable: false, isName: true},
    email: {type: 'text', label: 'Email'},
    telefono: {type: 'text', label: 'Teléfono'},
    fecha_nacimiento: {type: 'fecha', label: 'Fecha de nacimiento'},
    rol: {type: 'rol', label: 'Rol', nullable: false,
        description: 'alumno y docente requieren además su fila en alumnos o docentes'},
    contrasena_hash: {type: 'text', nullable: false, label: 'Contraseña', readable: false as const,
        inputName: 'contrasena' as const, inputType: 'password' as const, transform: 'password' as const},
    recuperacion_hashes: {type: 'text', nullable: false, readable: false as const, writable: false as const,
        onCreate: 'empty-array' as const, onPasswordChange: 'empty-array' as const},
    version_sesion: {type: 'text', nullable: false, readable: false as const, writable: false as const,
        onCreate: 'uuid' as const, onUpdate: 'uuid' as const},
});

// catálogo descriptivo, administrado por el admin: sirve para categorizar y buscar docentes
const materia = defineRecord(myTypes, {
    // nullable:false acá y no solo por ser pk: quien la herede con extractPk (dictados → clases)
    // tiene que recibirla obligatoria
    materia: {type: 'text', label: 'Materia', nullable: false, isName: true},
});

/* Un administrador la acepta (crea la materia y se la agrega a quienes la pidieron) o la rechaza.
   Se cierra sola como retirada cuando se retira el último solicitante activo.
   abierta ⇔ sin fecha_cierre: redundancia lineal, la controla cierreSegunEstado. */
const solicitud = defineRecord(myTypes, {
    id: {type: 'text', nullable: false, writable: false as const, visible: false as const, onCreate: 'uuid' as const},
    materia: {type: 'text', label: 'Materia solicitada', nullable: false, isName: true},
    estado: {type: 'estadoSolicitud', label: 'Estado', nullable: false},
    creada: {type: 'instante', label: 'Creada', nullable: false, writable: false as const, onCreate: 'now' as const},
    fecha_cierre: {type: 'instante', label: 'Fecha de cierre', description: 'vacía mientras la solicitud está abierta'},
});

const ctx1 = withRecords(myTypesConReglas, {usuario, materia, solicitud})

// Required by authentication, including the narrowly scoped anonymous login/recovery operations.
export const authenticationEntity = 'usuarios';
const usuarios = defineEntity(ctx1, {
    name: authenticationEntity,
    record: 'usuario',
    pk: ['id'],
    // id_rol es el destino de las fks de los subtipos: lo que hace disjunta a la jerarquía
    uks: {usuario_unico: ['usuario'], email_unico: ['email'], id_rol: ['id', 'rol']},
});

const materias = defineEntity(ctx1, {
    name: 'materias',
    record: 'materia',
    pk: ['materia'],
});

const solicitudes = defineEntity(ctx1, {
    name: 'solicitudes',
    record: 'solicitud',
    pk: ['id'],
    /* Sin uk sobre materia, para conservar las rechazadas: que haya a lo sumo una abierta por
       materia (los demás docentes se suman como solicitantes) es una regla entre filas, de la app. */
    validators: ['cierrePosterior', 'cierreSegunEstado'],
});

/* NIVEL 2: los subtipos de usuario */

const alumno = defineRecord(myTypes, {
    id: {...extractPk(usuarios).id, ...comoReferencia, label: 'Usuario'},
    rol: {...usuario.rol, description: 'siempre alumno'},
    nivel_academico: {type: 'nivelAcademico', label: 'Nivel académico'},
});

const docente = defineRecord(myTypes, {
    id: {...extractPk(usuarios).id, ...comoReferencia, label: 'Usuario'},
    rol: {...usuario.rol, description: 'siempre docente'},
    disponibilidad: {type: 'disponibilidad', label: 'Disponibilidad', maxLength: 336,
        description: "un '0'/'1' por media hora de la semana, desde el lunes 00:00"},
    descripcion: {type: 'text', label: 'Descripción', maxLength: 500},
});

const ctx2 = withRecords(ctx1, {alumno, docente})

const alumnos = defineEntity(ctx2, {
    name: 'alumnos',
    record: 'alumno',
    pk: ['id'],
    fks: {usuario: {entity: 'usuarios', fields: ['id', 'rol']}},
    validators: ['rolAlumno'],
});

const docentes = defineEntity(ctx2, {
    name: 'docentes',
    record: 'docente',
    pk: ['id'],
    fks: {usuario: {entity: 'usuarios', fields: ['id', 'rol']}},
    validators: ['rolDocente'],
});

/* NIVEL 3: relaciones entre subtipos y catálogos */

/* Simétrica: cada par se guarda una sola vez, ordenado (ver amistadOrdenada), sin importar quién
   la envió. Empieza como solicitud: el destinatario es el otro integrante, y solo él la acepta,
   la rechaza o la bloquea. Bloqueada, no se puede volver a enviar. */
const amistad = defineRecord(myTypes, {
    alumno_a: {...extractPk(alumnos).id, label: 'Alumno'},
    alumno_b: {...extractPk(alumnos).id, label: 'Amigo'},
    // sin fk propia: enviadaPorIntegrante exige que sea uno del par, y esos ya tienen la suya
    enviada_por: {...extractPk(alumnos).id, label: 'Enviada por'},
    estado: {type: 'estadoAmistad', label: 'Estado', nullable: false},
    creada: {type: 'instante', label: 'Creada', nullable: false, writable: false as const, onCreate: 'now' as const},
});

// DocenteDictaMateria: el docente sabe/ofrece la materia
const dictado = defineRecord(myTypes, {
    docente: {...extractPk(docentes).id, label: 'Docente'},
    ...extractPk(materias),
});

/* Retirarse no borra la fila: así queda el historial y la solicitud sigue teniendo quien la pidió.
   Mientras esté abierta, un retirado puede volver a activo. */
const solicitante = defineRecord(myTypes, {
    // no hay solicitud sin quien la pida
    solicitud: {...extractPk(solicitudes).id, ...comoReferencia, label: 'Solicitud', requeridoPorReferido: true},
    docente: {...extractPk(docentes).id, label: 'Docente'},
    estado: {type: 'estadoSolicitante', label: 'Estado', nullable: false},
});

const ctx3 = withRecords(ctx2, {amistad, dictado, solicitante})

const amistades = defineEntity(ctx3, {
    name: 'amistades',
    record: 'amistad',
    pk: ['alumno_a', 'alumno_b'],
    fks: {
        alumno_a: {entity: 'alumnos', fields: {alumno_a: 'id'}},
        alumno_b: {entity: 'alumnos', fields: {alumno_b: 'id'}},
    },
    validators: ['amistadOrdenada', 'enviadaPorIntegrante'],
});

const dictados = defineEntity(ctx3, {
    name: 'dictados',
    record: 'dictado',
    pk: ['docente', 'materia'],
    fks: {
        docente: {entity: 'docentes', fields: {docente: 'id'}},
        materia: {entity: 'materias', fields: materias.pk},
    },
});

const solicitantes = defineEntity(ctx3, {
    name: 'solicitantes',
    record: 'solicitante',
    pk: ['solicitud', 'docente'],
    fks: {
        solicitud: {entity: 'solicitudes', fields: {solicitud: 'id'}},
        docente: {entity: 'docentes', fields: {docente: 'id'}},
    },
});

/* NIVEL 4: la clase se da sobre una materia que el docente ofrece.
   Cuándo se reúne lo dicen sus reglas horarias; las ocurrencias se derivan de ellas. */

const clase = defineRecord(myTypes, {
    id: {type: 'text', nullable: false, writable: false as const, visible: false as const, onCreate: 'uuid' as const},
    ...extractPk(dictados),
    presencial: {type: 'boolean', label: 'Presencial', nullable: false},
    ubicacion: {type: 'text', label: 'Ubicación', nullable: false, isName: true,
        description: 'dirección si es presencial, URL si es virtual'},
    // lo maneja el docente: acepta, rechaza o cancela. Una clase confirmada es una aceptada
    estado: {type: 'estadoClase', label: 'Estado', nullable: false},
});

const ctx4 = withRecords(ctx3, {clase})

const clases = defineEntity(ctx4, {
    name: 'clases',
    record: 'clase',
    pk: ['id'],
    fks: {dictado: {entity: 'dictados', fields: dictados.pk}},
    validators: ['ubicacionSegunModalidad'],
});

/* NIVEL 5: una clase no existe sin cuándo ni sin quién */

/* fecha_inicio es el primer día en que se da, y su día de la semana es el de la regla: no se guarda
   aparte para que no puedan contradecirse. Desde ahí se repite cada `intervalo` semanas,
   `repeticiones` veces: con 4 repeticiones e intervalo 2 abarca 8 semanas. Sin repeticiones
   sigue indefinidamente. */
const regla_horaria = defineRecord(myTypes, {
    clase: {...extractPk(clases).id, ...comoReferencia, label: 'Clase', requeridoPorReferido: true},
    fecha_inicio: {type: 'fecha', label: 'Fecha de inicio', nullable: false},
    hora_inicio: {type: 'hora', label: 'Hora de inicio', nullable: false},
    hora_fin: {type: 'hora', label: 'Hora de fin', nullable: false},
    intervalo: {type: 'posInteger', label: 'Cada cuántas semanas', nullable: false,
        description: '1 todas las semanas, 2 semana por medio…'},
    repeticiones: {type: 'posInteger', label: 'Repeticiones', description: 'vacío: sin fin'},
});

/* Quienes piden la clase entran aceptados: el pedido es la clase misma. Quien se suma después
   entra pendiente, y el docente lo acepta o lo rechaza. La baja la da el alumno; la fila queda,
   así que sigue contando para el mínimo de participantes. */
const participante = defineRecord(myTypes, {
    clase: {...extractPk(clases).id, ...comoReferencia, label: 'Clase', requeridoPorReferido: true},
    alumno: {...extractPk(alumnos).id, label: 'Alumno'},
    estado: {type: 'estadoParticipante', label: 'Estado', nullable: false},
});

const ctx5 = withRecords(ctx4, {regla_horaria, participante})

const reglas_horarias = defineEntity(ctx5, {
    name: 'reglas_horarias',
    record: 'regla_horaria',
    // con fecha_inicio en la pk, dos grupos pueden alternar semanas en el mismo horario
    pk: ['clase', 'fecha_inicio', 'hora_inicio'],
    fks: {clase: {entity: 'clases', fields: {clase: 'id'}}},
    validators: ['horaFinPosterior'],
});

const participantes = defineEntity(ctx5, {
    name: 'participantes',
    record: 'participante',
    pk: ['clase', 'alumno'],
    fks: {
        clase: {entity: 'clases', fields: {clase: 'id'}},
        alumno: {entity: 'alumnos', fields: {alumno: 'id'}},
    },
});

/* NIVEL 6: una repetición puntual que no se da. La cancela el docente o un alumno de la clase,
   con motivo; borrar la fila la descancela. Cancelar la clase entera es su estado. */

const reglaCancelada = extractPk(reglas_horarias);
const cancelacion = defineRecord(myTypes, {
    // la clase de la regla es requeridoPorReferido para las reglas, no para las cancelaciones
    clase: {...reglaCancelada.clase, requeridoPorReferido: false},
    fecha_inicio: reglaCancelada.fecha_inicio,
    hora_inicio: reglaCancelada.hora_inicio,
    fecha: {type: 'fecha', label: 'Fecha cancelada', nullable: false},
    motivo: {type: 'text', label: 'Motivo', nullable: false, maxLength: 200},
    cancelada_por: {...extractPk(usuarios).id, ...comoReferencia, label: 'Cancelada por'},
    creada: {type: 'instante', label: 'Creada', nullable: false, writable: false as const, onCreate: 'now' as const},
});

const ctx6 = withRecords(ctx5, {cancelacion})

const cancelaciones = defineEntity(ctx6, {
    name: 'cancelaciones',
    record: 'cancelacion',
    pk: ['clase', 'fecha_inicio', 'hora_inicio', 'fecha'],
    fks: {
        regla: {entity: 'reglas_horarias', fields: reglas_horarias.pk},
        cancelada_por: {entity: 'usuarios', fields: {cancelada_por: 'id'}},
    },
    validators: ['fechaEsOcurrencia'],
});

// la última etapa es el sistema entero
export const myContext = ctx6
export const myRecords = ctx6

export const myEntities = defineEntities({
    usuarios, materias, solicitudes, alumnos, docentes,
    amistades, dictados, solicitantes, clases, reglas_horarias, participantes, cancelaciones,
})

// Presentation is app-owned metadata; browsers receive it through the API.
export const entityLabels = {
    usuarios: 'Usuarios', materias: 'Materias', solicitudes: 'Solicitudes de materia',
    alumnos: 'Alumnos', docentes: 'Docentes', amistades: 'Amistades',
    dictados: 'Materias que ofrece cada docente', solicitantes: 'Solicitantes',
    clases: 'Clases', reglas_horarias: 'Reglas horarias', participantes: 'Participantes',
    cancelaciones: 'Repeticiones canceladas',
} satisfies Record<keyof typeof myEntities, string>;

const snapshot = captureSystemSnapshot(myContext, {
    systemId: 'ssot2026',
    entities: myEntities,
    records: myContext.records,
});
if (!snapshot.ok) throw new Error(JSON.stringify(snapshot.problems));
export const ssot = snapshot.value;

export const sqlMapping = {
    text: sqlTypes.text,
    integer: sqlTypes.integer,
    posInteger: sqlTypes.integer,
    boolean: sqlTypes.boolean,
    rol: sqlTypes.text,
    nivelAcademico: sqlTypes.text,
    estadoClase: sqlTypes.text,
    estadoSolicitud: sqlTypes.text,
    estadoAmistad: sqlTypes.text,
    estadoSolicitante: sqlTypes.text,
    estadoParticipante: sqlTypes.text,
    fecha: sqlTypes.date,
    hora: sqlTypes.time,
    instante: sqlTypes.timestampWithTimeZone,
    disponibilidad: sqlTypes.text,
    password: sqlTypes.text,
} satisfies SqlTypeMapping<typeof ssot>;
