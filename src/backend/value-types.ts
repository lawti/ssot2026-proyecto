import {boxType, commonTypeBehaviours, commonTypeDefs, notParsed, parsed, type TypeBehaviour, type TypeProvider} from 'system-definition';

const rolValues = ['alumno', 'docente', 'administrador'] as const;
const nivelAcademicoValues = ['inicial', 'primario', 'secundario', 'terciario', 'universitario', 'posgrado', 'otro'] as const;
const diaSemanaValues = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const;
const estadoClaseValues = ['pendiente', 'aceptada', 'rechazada', 'cancelada'] as const;

/* Disponibilidad: un carácter '0'/'1' por media hora de la semana, de lunes 00:00 a domingo 23:30.
   El bit i corresponde a dia*48 + hora*2 + (minutos >= 30 ? 1 : 0), con lunes = 0.
   Se guarda como text porque el framework no ofrece bit(n), pero en SQL se castea sin costo
   apreciable: `disponibilidad::bit(336) & mascara = mascara` dice si cubre un horario entero. */
export const slotsPorSemana = 7 * 24 * 2;

export const appTypeDefs = {
    ...commonTypeDefs,
    posInteger: {...commonTypeDefs.integer, minimum: 1},
    rol: {tsType: boxType<typeof rolValues[number]>(), values: rolValues},
    nivelAcademico: {tsType: boxType<typeof nivelAcademicoValues[number]>(), values: nivelAcademicoValues},
    diaSemana: {tsType: boxType<typeof diaSemanaValues[number]>(), values: diaSemanaValues},
    estadoClase: {tsType: boxType<typeof estadoClaseValues[number]>(), values: estadoClaseValues},
    /** Fecha de calendario, serializada como YYYY-MM-DD. */
    fecha: {tsType: boxType<string>()},
    /** Hora del día HH:MM en múltiplos de media hora, alineada con la disponibilidad. */
    hora: {tsType: boxType<string>()},
    /** Instante absoluto, serializado como ISO 8601 en UTC. */
    instante: {tsType: boxType<string>()},
    disponibilidad: {tsType: boxType<string>(), length: slotsPorSemana},
    password: {...commonTypeDefs.text, minLength: 12, maxLength: 128},
};

const posIntegerBehaviour: TypeBehaviour<number> = {
    check: (value): value is number => commonTypeBehaviours.integer.check(value) && value >= appTypeDefs.posInteger.minimum,
    deserialize: text => {
        const result = commonTypeBehaviours.integer.deserialize(text);
        return result.ok && posIntegerBehaviour.check(result.value) ? result : notParsed('type.posInteger');
    },
    serialize: commonTypeBehaviours.integer.serialize,
};

function enumBehaviour<T extends readonly string[]>(values: T, name: string): TypeBehaviour<T[number]> {
    const check = (value: unknown): value is T[number] => typeof value === 'string' && values.includes(value);
    return {
        check,
        deserialize: text => check(text) ? parsed(text) : notParsed(`type.${name}`),
        serialize: value => value,
    };
}

// Un string con forma propia: se lee y se escribe tal cual, y la forma es lo que se verifica.
function shapedTextBehaviour(name: string, valid: (value: string) => boolean): TypeBehaviour<string> {
    const check = (value: unknown): value is string => typeof value === 'string' && valid(value);
    return {
        check,
        deserialize: text => check(text) ? parsed(text) : notParsed(`type.${name}`),
        serialize: value => value,
    };
}

function fechaValida(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const horaValida = (value: string): boolean => /^([01]\d|2[0-3]):(00|30)$/.test(value);

const instanteValido = (value: string): boolean =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(new Date(value).getTime());

const disponibilidadValida = (value: string): boolean =>
    value.length === appTypeDefs.disponibilidad.length && /^[01]*$/.test(value);

export const passwordBehaviour: TypeBehaviour<string> = {
    check: (value): value is string => typeof value === 'string' &&
        value.length >= appTypeDefs.password.minLength && value.length <= appTypeDefs.password.maxLength,
    deserialize: text => passwordBehaviour.check(text) ? parsed(text) : notParsed('type.password'),
    serialize: value => value,
};

export const appTypeBehaviours = {
    ...commonTypeBehaviours,
    posInteger: posIntegerBehaviour,
    rol: enumBehaviour(appTypeDefs.rol.values, 'rol'),
    nivelAcademico: enumBehaviour(appTypeDefs.nivelAcademico.values, 'nivelAcademico'),
    diaSemana: enumBehaviour(appTypeDefs.diaSemana.values, 'diaSemana'),
    estadoClase: enumBehaviour(appTypeDefs.estadoClase.values, 'estadoClase'),
    fecha: shapedTextBehaviour('fecha', fechaValida),
    hora: shapedTextBehaviour('hora', horaValida),
    instante: shapedTextBehaviour('instante', instanteValido),
    disponibilidad: shapedTextBehaviour('disponibilidad', disponibilidadValida),
    password: passwordBehaviour,
} satisfies TypeProvider<typeof appTypeDefs>;

export type InputConstraints = {
    minLength: number | null;
    maxLength: number | null;
    minimum?: number;
    options?: readonly string[];
};

export const inputConstraints = {
    text: {minLength: null, maxLength: null},
    integer: {minLength: null, maxLength: null},
    boolean: {minLength: null, maxLength: null},
    posInteger: {minLength: null, maxLength: null, minimum: appTypeDefs.posInteger.minimum},
    rol: {minLength: null, maxLength: null, options: appTypeDefs.rol.values},
    nivelAcademico: {minLength: null, maxLength: null, options: appTypeDefs.nivelAcademico.values},
    diaSemana: {minLength: null, maxLength: null, options: appTypeDefs.diaSemana.values},
    estadoClase: {minLength: null, maxLength: null, options: appTypeDefs.estadoClase.values},
    fecha: {minLength: 10, maxLength: 10},
    hora: {minLength: 5, maxLength: 5},
    instante: {minLength: 24, maxLength: 24},
    disponibilidad: {minLength: appTypeDefs.disponibilidad.length, maxLength: appTypeDefs.disponibilidad.length},
    password: {minLength: appTypeDefs.password.minLength, maxLength: appTypeDefs.password.maxLength},
} satisfies Record<keyof typeof appTypeDefs, InputConstraints>;
