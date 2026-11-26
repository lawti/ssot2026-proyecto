import type {EntityInfo} from 'system-definition';
import type {myContext} from './system.js';

export function allowedFields(entity: EntityInfo<typeof myContext>, operation: 'read' | 'write'): EntityInfo<typeof myContext>['fields'] {
    return Object.fromEntries(Object.entries(entity.fields).filter(([, field]) => operation === 'read' ? field.readable : field.writable));
}

// Lo que un formulario de alta o edición tiene que pedir: los campos escribibles, bajo su nombre de input.
// `omit` saca los que fija el servidor en ese uso (por nombre de campo).
export function entityInputs(entity: EntityInfo<typeof myContext>, omit: readonly string[] = []) {
    return Object.values(allowedFields(entity, 'write')).filter(field => !omit.includes(field.name))
        .map(({inputName: name, inputType: type, inputConstraints: constraints, label, nullable, transform}) => ({
            name, label, type, nullable, constraints, optionalOnUpdate: transform === 'password',
        }));
}
