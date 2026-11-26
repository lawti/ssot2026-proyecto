/* El formulario de alta: los campos los manda el SSOT (GET /api/registro) y se dibujan con el
   mismo editor de valores que usa la planilla. Los datos del usuario son comunes; los del perfil
   dependen del rol elegido, y los del rol no elegido quedan deshabilitados (no se validan ni envían). */

import type {EntityInputColumn, EntityRow, RegistroCampos, RegistroRequest, RolRegistrable} from '../backend/browser-contract.js';
import type {Problem} from 'system-definition';
import {element} from './dom.js';
import {messageOf} from './messages.js';
import {createValueField} from './value-field.js';

type Campo = {column: EntityInputColumn; field: HTMLElement; error: HTMLElement; read: () => EntityRow[string] | undefined};

function crearCampos(columns: readonly EntityInputColumn[], container: HTMLElement): Campo[] {
    return columns.map(column => {
        const editor = createValueField(column);
        const error = element('span');
        error.className = 'field-error';
        editor.field.append(error);
        container.append(editor.field);
        return {column, field: editor.field, error, read: editor.read};
    });
}

const leer = (campos: readonly Campo[]): EntityRow =>
    Object.fromEntries(campos.flatMap(campo => {
        const value = campo.read();
        return value === undefined ? [] : [[campo.column.name, value]];
    }));

export function createRegistroForm(campos: RegistroCampos, form: HTMLFormElement) {
    const roles = form.querySelector<HTMLElement>('#registro-roles')!;
    const datos = form.querySelector<HTMLElement>('#registro-usuario')!;
    const perfiles = form.querySelector<HTMLElement>('#registro-perfil')!;
    roles.replaceChildren();
    datos.replaceChildren();
    perfiles.replaceChildren();

    const usuario = crearCampos(campos.usuario, datos);
    // cada rol registrable trae los campos de su subtipo; no se listan acá
    const porRol = (Object.keys(campos) as (keyof RegistroCampos)[]).filter((rol): rol is RolRegistrable => rol !== 'usuario')
        .map(rol => {
            const radio = element('input');
            radio.type = 'radio';
            radio.name = 'rol';
            radio.value = rol;
            radio.required = true;
            const label = element('label');
            label.append(radio, document.createTextNode(` ${rol[0]!.toUpperCase()}${rol.slice(1)}`));
            roles.append(label);
            const grupo = element('fieldset');
            grupo.hidden = grupo.disabled = true;
            perfiles.append(grupo);
            return {rol, radio, grupo, campos: crearCampos(campos[rol], grupo)};
        });
    const elegido = () => porRol.find(({radio}) => radio.checked);
    roles.onchange = () => {
        for (const {radio, grupo} of porRol) grupo.hidden = grupo.disabled = !radio.checked;
    };
    const todos = () => [...usuario, ...porRol.flatMap(({campos}) => campos)];

    return {
        read: (): RegistroRequest => {
            const actual = elegido()!;
            return {rol: actual.rol, usuario: leer(usuario), perfil: leer(actual.campos)};
        },
        // los nombres de usuario y de perfil no se repiten, así que cada problema tiene un solo lugar
        problems: (problems: readonly Problem[]): boolean => {
            let ubicados = false;
            for (const campo of todos()) {
                campo.error.textContent = problems.filter(problem => problem.field === campo.column.name)
                    .map(problem => messageOf(problem, campo.column.constraints)).join('; ');
                campo.field.classList.toggle('has-error', !!campo.error.textContent);
                ubicados ||= !!campo.error.textContent;
            }
            return ubicados;
        },
    };
}
export type RegistroForm = ReturnType<typeof createRegistroForm>;
