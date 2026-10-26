// Diagnostic: writes a one-sample tube label sheet to a file for geometry measurement (label-geometry.mjs).
import {writeFileSync} from 'node:fs';
import {buildTubeLabelsHtml} from '../../packages/lab/labels';
writeFileSync(process.argv[2],buildTubeLabelsHtml([{ln:'0000000001',lnHalos:process.argv[3]??'26B261012001',patientName:null}]));
