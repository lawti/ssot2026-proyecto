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

// abierta ⇔ fecha_cierre es null: no se guarda aparte para que no puedan contradecirse
const solicitud = defineRecord(myTypes, {
    id: {type: 'text', nullable: false, writable: false as const, visible: false as const, onCreate: 'uuid' as const},
    materia: {type: 'text', label: 'Materia solicitada', nullable: false, isName: true},
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
    // una sola solicitud por materia: los demás docentes se suman como solicitantes
    uks: {materia_unica: ['materia']},
    validators: ['cierrePosterior'],
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

// simétrica: cada par se guarda una sola vez, ordenado (ver amistadOrdenada)
const amistad = defineRecord(myTypes, {
    alumno_a: {...extractPk(alumnos).id, label: 'Alumno'},
    alumno_b: {...extractPk(alumnos).id, label: 'Amigo'},
});

// DocenteDictaMateria: el docente sabe/ofrece la materia
const dictado = defineRecord(myTypes, {
    docente: {...extractPk(docentes).id, label: 'Docente'},
    ...extractPk(materias),
});

const solicitante = defineRecord(myTypes, {
    solicitud: {...extractPk(solicitudes).id, ...comoReferencia, label: 'Solicitud'},
    docente: {...extractPk(docentes).id, label: 'Docente'},
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
    validators: ['amistadOrdenada'],
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
   El horario es un patrón semanal: los días están en clase_dias y las ocurrencias se derivan
   (cada día elegido de cada una de las `repeticiones` semanas desde fecha_inicio). */

const clase = defineRecord(myTypes, {
    id: {type: 'text', nullable: false, writable: false as const, visible: false as const, onCreate: 'uuid' as const},
    ...extractPk(dictados),
    presencial: {type: 'boolean', label: 'Presencial', nullable: false},
    ubicacion: {type: 'text', label: 'Ubicación', nullable: false, isName: true,
        description: 'dirección si es presencial, URL si es virtual'},
    estado: {type: 'estadoClase', label: 'Estado', nullable: false},
    fecha_inicio: {type: 'fecha', label: 'Fecha de inicio', nullable: false},
    hora_inicio: {type: 'hora', label: 'Hora de inicio', nullable: false},
    hora_fin: {type: 'hora', label: 'Hora de fin', nullable: false},
    repeticiones: {type: 'posInteger', label: 'Semanas', nullable: false},
});

const ctx4 = withRecords(ctx3, {clase})

const clases = defineEntity(ctx4, {
    name: 'clases',
    record: 'clase',
    pk: ['id'],
    fks: {dictado: {entity: 'dictados', fields: dictados.pk}},
    validators: ['ubicacionSegunModalidad', 'horaFinPosterior'],
});

/* NIVEL 5 */

const clase_dia = defineRecord(myTypes, {
    clase: {...extractPk(clases).id, ...comoReferencia, label: 'Clase'},
    dia: {type: 'diaSemana', label: 'Día', nullable: false},
});

const participante = defineRecord(myTypes, {
    clase: {...extractPk(clases).id, ...comoReferencia, label: 'Clase'},
    alumno: {...extractPk(alumnos).id, label: 'Alumno'},
});

const ctx5 = withRecords(ctx4, {clase_dia, participante})

const clase_dias = defineEntity(ctx5, {
    name: 'clase_dias',
    record: 'clase_dia',
    pk: ['clase', 'dia'],
    fks: {clase: {entity: 'clases', fields: {clase: 'id'}}},
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

// la última etapa es el sistema entero
export const myContext = ctx5
export const myRecords = ctx5

export const myEntities = defineEntities({
    usuarios, materias, solicitudes, alumnos, docentes,
    amistades, dictados, solicitantes, clases, clase_dias, participantes,
})

// Presentation is app-owned metadata; browsers receive it through the API.
export const entityLabels = {
    usuarios: 'Usuarios', materias: 'Materias', solicitudes: 'Solicitudes de materia',
    alumnos: 'Alumnos', docentes: 'Docentes', amistades: 'Amistades',
    dictados: 'Materias que ofrece cada docente', solicitantes: 'Solicitantes',
    clases: 'Clases', clase_dias: 'Días de cada clase', participantes: 'Participantes',
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
    diaSemana: sqlTypes.text,
    estadoClase: sqlTypes.text,
    fecha: sqlTypes.date,
    hora: sqlTypes.time,
    instante: sqlTypes.timestampWithTimeZone,
    disponibilidad: sqlTypes.text,
    password: sqlTypes.text,
} satisfies SqlTypeMapping<typeof ssot>;
