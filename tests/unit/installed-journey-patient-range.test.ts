import {expect,it} from 'vitest';
import {INSTALLED_JOURNEY_SCAN_INTERVAL_SECONDS,nextInstalledJourneyPatientStart} from '../../tools/operational/journey-patient-range';

it('leaves enough time for the installed worker to finish each inbound scan',()=>{
 expect(INSTALLED_JOURNEY_SCAN_INTERVAL_SECONDS).toBeGreaterThanOrEqual(30);
});

it('selects the first unused 45-patient block for a repeat installed journey',()=>{
 expect(nextInstalledJourneyPatientStart([])).toBe(7701);
 expect(nextInstalledJourneyPatientStart([7701,7745])).toBe(7801);
 expect(nextInstalledJourneyPatientStart([],Array.from({length:45},(_,i)=>7701+i))).toBe(7801);
 expect(nextInstalledJourneyPatientStart([7807])).toBe(7701);
 expect(nextInstalledJourneyPatientStart([7702,7802])).toBe(7901);
});
