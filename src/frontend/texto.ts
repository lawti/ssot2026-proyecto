/* Las búsquedas ignoran mayúsculas y acentos ("alg" encuentra "Álgebra"): NFD separa cada letra
   de su tilde y se descartan las tildes. Es lo mismo que textoBuscable de backend/entity-query.ts
   hace en SQL, así que filtrar en el navegador o en el servidor da el mismo resultado. */
export const textoBuscable = (texto: string): string => texto.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
