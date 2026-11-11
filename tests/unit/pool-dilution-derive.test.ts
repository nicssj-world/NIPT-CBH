import {describe,it,expect} from 'vitest';
import {deriveDilutionC1} from '../../packages/workbook/dilution';

// Owner 2026-11-11: C1 of the Pooling DNA Library dilution is the Pool Library concentration already entered; above 3.6 ng/µL only.
describe('dilution C1 follows the Pool Library concentration',()=>{
 it('fills C1 (E52) from the concentration when it is above 3.6',()=>{
  expect(deriveDilutionC1({'pool.concentration':3.7})).toEqual({'pool.concentration':3.7,'pool.dilutionC1':3.7});
  expect(deriveDilutionC1({'pool.concentration':12.5,'pool.dilutionC1':1})['pool.dilutionC1']).toBe(12.5); // a separately typed C1 is replaced
 });
 it('leaves C1 empty at or below 3.6, including below 3.0 where dilution cannot help',()=>{
  expect('pool.dilutionC1' in deriveDilutionC1({'pool.concentration':3.6,'pool.dilutionC1':9})).toBe(false);
  expect('pool.dilutionC1' in deriveDilutionC1({'pool.concentration':3.3})).toBe(false);
  expect('pool.dilutionC1' in deriveDilutionC1({'pool.concentration':2.5})).toBe(false);
 });
 it('changes nothing without a concentration, and never changes its input',()=>{
  const input={'pool.dilutionC1':10};
  expect(deriveDilutionC1(input)).toBe(input);
  expect(deriveDilutionC1({'pool.concentration':null,'pool.dilutionC1':10})['pool.dilutionC1']).toBe(10);
  const withConcentration={'pool.concentration':3.9,'pool.dilutionC1':1};
  deriveDilutionC1(withConcentration);expect(withConcentration['pool.dilutionC1']).toBe(1);
 });
});
