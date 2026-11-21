import type {DeleteDependencyBlocker, EntityColumn, EntityCreate, EntityForeignKey, EntityInput, EntityKey, EntityResponse, EntityRow, EntityQuery} from '../src/backend/api-contract.js';
import {checkDeleteDependencies, createRow, deleteRow, deleteRows, updateRow, loadEntity} from '../src/frontend/api.js';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
export type BackendFitsBrowser = Assert<EntityResponse extends import('../src/backend/browser-contract.js').EntityResponse ? true : false>;
export type RequiredPrimaryKey = Assert<Equal<EntityRow<'materias'>['materia'], string>>;
export type RequiredInheritedKey = Assert<Equal<EntityRow<'dictados'>['docente'], string>>;
export type NullableText = Assert<Equal<EntityRow<'docentes'>['descripcion'], string | null>>;
export type RequiredBoolean = Assert<Equal<EntityRow<'clases'>['presencial'], boolean>>;
export type NullableInteger = Assert<Equal<EntityRow<'reglas_horarias'>['repeticiones'], number | null>>;
export type RequiredInteger = Assert<Equal<EntityRow<'reglas_horarias'>['intervalo'], number>>;
export type ColumnLiteral = Assert<Equal<Extract<EntityColumn<'clases'>, {name: 'presencial'}>['type'], 'boolean'>>;
export type MinimumMetadata = Assert<Equal<keyof EntityColumn<'materias'>, 'name' | 'label' | 'type' | 'nullable' | 'writable' | 'constraints'>>;
export type PrimaryKey = Assert<Equal<keyof EntityKey<'dictados'>, 'docente' | 'materia'>>;
export type ScheduleRulePrimaryKey = Assert<Equal<keyof EntityKey<'reglas_horarias'>, 'clase' | 'fecha_inicio' | 'hora_inicio'>>;
export type FriendshipState = Assert<Equal<EntityRow<'amistades'>['estado'], 'pendiente' | 'aceptada' | 'rechazada' | 'bloqueada'>>;
export type RequestState = Assert<Equal<EntityRow<'solicitudes'>['estado'], 'abierta' | 'aceptada' | 'rechazada' | 'retirada'>>;
export type RequesterState = Assert<Equal<EntityRow<'solicitantes'>['estado'], 'activo' | 'retirado'>>;
export type ParticipantState = Assert<Equal<EntityRow<'participantes'>['estado'], 'pendiente' | 'aceptado' | 'rechazado' | 'baja'>>;
export type CancellationPrimaryKey = Assert<Equal<keyof EntityKey<'cancelaciones'>, 'clase' | 'fecha_inicio' | 'hora_inicio' | 'fecha'>>;
export type CancellationReason = Assert<Equal<EntityRow<'cancelaciones'>['motivo'], string>>;
export type AcademicLevel = Assert<Equal<EntityRow<'alumnos'>['nivel_academico'],
    'inicial' | 'primario' | 'secundario' | 'terciario' | 'universitario' | 'posgrado' | 'otro' | null>>;
// @ts-expect-error Enum values preserve the SSOT's exact spelling.
export const invalidState: EntityRow<'amistades'>['estado'] = 'bloqueado';
// @ts-expect-error A required enum is not nullable.
export const nullState: EntityRow<'amistades'>['estado'] = null;
// @ts-expect-error The weekday is derived from fecha_inicio, not stored.
export type NoStoredDay = EntityRow<'reglas_horarias'>['dia'];
export type EntityAndRowsStayTogether = Assert<Equal<Extract<EntityResponse, {name: 'reglas_horarias'}>['rows'][number], EntityRow<'reglas_horarias'>>>;
export type DependencyKeysStayWithEntity = Assert<Equal<Extract<DeleteDependencyBlocker, {entity: 'materias'}>['keys'][number], EntityKey<'materias'>>>;
export const materiaReference: EntityForeignKey = {name: 'materia', entity: 'materias', fields: {materia: 'materia'}, displayFields: ['materia']};
// @ts-expect-error Reference labels cannot expose private password hashes.
export const secretReference: EntityForeignKey = {name: 'user', entity: 'usuarios', fields: {user: 'id'}, displayFields: ['contrasena_hash']};
// @ts-expect-error Entity names come from the SSOT.
export type UnknownEntity = EntityRow<'users'>;
// @ts-expect-error Fields cannot be taken from another entity.
export type WrongField = EntityRow<'materias'>['repeticiones'];
// @ts-expect-error Storage and validation metadata are not in the browser contract.
export type HiddenMetadata = EntityColumn<'materias'>['validators'];
// @ts-expect-error The entity primary key is required.
export const nullKey: EntityRow<'materias'>['materia'] = null;
// @ts-expect-error Boolean values cannot be strings.
export const stringBoolean: EntityRow<'clases'>['presencial'] = 'true';

// The browser accepts names discovered at runtime, including new backend entities.
void createRow('a-new-table', {new_field: 'value'});
void loadEntity('a-new-table', {sort: 'new_field', where: {new_field: 1}});
void updateRow('a-new-table', {key: {new_key: 1}, version: '1', row: {new_field: true}});
// @ts-expect-error Updating still requires the version originally read.
void updateRow('a-new-table', {key: {new_key: 1}, row: {new_field: true}});
// @ts-expect-error Values must belong to the SSOT's supported value types.
void createRow('a-new-table', {new_field: {arbitrary: 'object'}});
// @ts-expect-error Primary keys cannot be null.
void deleteRow('a-new-table', {new_key: null});
void deleteRows('a-new-table', [{new_key: 1}]);
void checkDeleteDependencies('a-new-table', [{new_key: 1}]);
// Backend authoring retains the concrete SSOT constraints.
// @ts-expect-error Query columns belong to the selected entity.
export const wrongSort: EntityQuery<'materias'> = {sort: 'usuario'};
// @ts-expect-error Equality filters preserve SSOT value types.
export const wrongFilter: EntityQuery<'reglas_horarias'> = {where: {intervalo: '1'}};
// @ts-expect-error Bulk keys require every component.
export const incompleteKey: EntityKey<'dictados'> = {materia: 'Álgebra'};

export type PublicUserFields = Assert<Equal<keyof EntityRow<'usuarios'>,
    'id' | 'usuario' | 'nombre' | 'apellido' | 'email' | 'telefono' | 'fecha_nacimiento' | 'rol'>>;
export type PublicUserColumns = Assert<Equal<EntityColumn<'usuarios'>['name'],
    'usuario' | 'nombre' | 'apellido' | 'email' | 'telefono' | 'fecha_nacimiento' | 'rol'>>;
export type WritableUserFields = Assert<Equal<keyof EntityInput<'usuarios'>,
    'usuario' | 'nombre' | 'apellido' | 'email' | 'telefono' | 'fecha_nacimiento' | 'rol' | 'contrasena'>>;
const usuario = {usuario: '20-12345678-9', nombre: 'Pía', apellido: 'Ríos', email: null, telefono: null,
    fecha_nacimiento: null, rol: 'docente'} as const;
// @ts-expect-error Password hashes cannot be read through the public API.
export type HiddenPassword = EntityRow<'usuarios'>['contrasena_hash'];
// @ts-expect-error A password is required when creating a user.
export const missingPassword: EntityCreate<'usuarios'> = usuario;
// @ts-expect-error Recovery hashes cannot be assigned through the public API.
export const privateInput: EntityCreate<'usuarios'> = {...usuario, contrasena: 'a-long-password', recuperacion_hashes: '[]'};
export const validUser: EntityCreate<'usuarios'> = {...usuario, contrasena: 'a-long-password'};
void createRow('usuarios', validUser);
void updateRow('usuarios', {key: {id: 'id'}, version: '1', row: {usuario: 'usuario'}});
// @ts-expect-error Roles are the SSOT's enum values.
export const roleInput: EntityCreate<'usuarios'> = {...usuario, contrasena: 'a-long-password', rol: 'admin'};
