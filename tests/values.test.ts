import {describe,it,expect} from 'vitest';
import {convertValue,validateValues} from '../src/server/values';
import type {Field} from '../src/shared/contracts';
const field = (type:Field['type'], extras:Partial<Field>={}):Field => ({id:'c1',source:'Código',label:'Código',type,required:false,readonly:false,options:[],group:'Geral',currency:'BRL',...extras});
describe('fidelidade dos valores',()=>{
 it('preserva zeros de identificadores e distingue vazio, zero e falso',()=>{
  expect(convertValue('001',field('text'),'pt-BR')).toBe('001');
  expect(convertValue(null,field('number'),'pt-BR')).toBeNull();
  expect(convertValue(0,field('number'),'pt-BR')).toBe(0);
  expect(convertValue(false,field('boolean'),'pt-BR')).toBe(false);
 });
 it('interpreta números e datas com localidade explícita',()=>{
  expect(convertValue('1.234,50',field('currency'),'pt-BR')).toBe(1234.5);
  expect(convertValue('03/04/2025',field('date'),'pt-BR')).toBe('2025-04-03');
  expect(convertValue('03/04/2025',field('date'),'en-US')).toBe('2025-03-04');
  expect(()=>convertValue('31/02/2025',field('date'),'pt-BR')).toThrow();
 });
 it('rejeita campos extras, somente leitura e tipo incorreto',()=>{
  expect(()=>validateValues({evil:'x'},[field('text')],{})).toThrow();
  expect(()=>validateValues({c1:'x'},[field('text',{readonly:true})],{c1:'y'})).toThrow();
  expect(()=>validateValues({c1:'5'},[field('number')],{})).toThrow();
 });
});
