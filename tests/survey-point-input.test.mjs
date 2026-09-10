import test from 'node:test';
import assert from 'node:assert/strict';
import { surveyPointInput } from '../modules/section/surveyPointInput.ts';
import { newSurveyLine, addSurveyStation, removeSurveyStation, surveySettings } from '../modules/section/surveyLine.ts';
import { withSurveySettings } from '../modules/section/surveyStore.ts';
import { newAnnotation } from '../modules/annotations/data.ts';

test('coordinate entry accepts signed decimal degrees and rejects empty, partial and out-of-map coordinates', () => {
  assert.deepEqual(surveyPointInput(' -103.123456 ', '+30.850170'), [-103.123456, 30.85017]);
  assert.deepEqual(surveyPointInput('0', '0'), [0, 0]);
  for (const values of [['','30'],['104',' '],['104x','30'],['NaN','30'],['Infinity','30'],['181','30'],['104','85.1'],['1e2','30'],['103,49','30']])
    assert.throws(() => surveyPointInput(...values));
});

test('deleting a bound survey point removes its sheet data but retains the independent map marker', () => {
  let line=addSurveyStation(newSurveyLine([104,30],[104.01,30]),[104.005,30],'marker-c');
  line={...line,pointData:{'marker-c':{name:'岩性点',note:'保留原标记'}}};
  const settings=surveySettings(line);
  const marker={...newAnnotation('pin',[104.005,30],null,'marker-c'),sectionAnchor:{sectionId:'line-1',distance:line.stations[0].distance}};
  const before={format:'guanyun-backup',version:1,tracks:[],annotations:[marker],favorites:[],sections:[{id:'line-1',name:'L01',settings,updatedAt:1}]};
  const result=withSurveySettings(before,'line-1',surveySettings(removeSurveyStation(line,'marker-c'),settings));
  assert.equal(result.sections[0].settings.survey.stations.length,0);
  assert.equal(result.sections[0].settings.survey.pointData['marker-c'],undefined);
  assert.equal(result.annotations.length,1);
  assert.deepEqual(result.annotations[0].coordinates,marker.coordinates);
  assert.equal(result.annotations[0].sectionAnchor,undefined);
  assert.throws(()=>removeSurveyStation(line,'A'),/基准点/);
  assert.throws(()=>removeSurveyStation(line,'B'),/基准点/);
});
