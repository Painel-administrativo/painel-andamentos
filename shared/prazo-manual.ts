import {dataValida} from './calendario';
// Date-only values must never pass through local timezone parsing.
export function dataPrazoManual(valor?:string|null):Date|null {
 return valor&&dataValida(valor)?new Date(`${valor}T00:00:00.000Z`):null;
}
export function fimEfetivo(manual:string|null|undefined,automatico:Date|null):Date|null {
 return dataPrazoManual(manual)??automatico;
}
