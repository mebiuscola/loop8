import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveModel,migrateModelSettings} from '../lib/model-routing.mjs';

const acp=(id,thinking)=>({id,name:id,provider:'antigravity-acp',model:'gemini-fixture',...(thinking?{acpThinking:thinking}:{})});

test('whole-deck check follows courseware recognition until it has its own model',()=>{
 const settings={modelRoutingVersion:2,modelProfiles:[acp('deep','high'),acp('quick','low')],defaultProfileId:'deep',modelRoutes:{pptRecognition:'deep'}};
 assert.equal(resolveModel(settings,'deckReview').profileId,'deep');
 const own={...settings,modelRoutes:{pptRecognition:'deep',deckReview:'quick'}};
 const picked=resolveModel(own,'deckReview');
 assert.equal(picked.profileId,'quick');
 assert.equal(picked.acpThinking,'low');
 assert.equal(resolveModel(own,'pptRecognition').profileId,'deep');
});

test('migrating old settings leaves the whole-deck check following recognition',()=>{
 const migrated=migrateModelSettings({modelRoutingVersion:2,modelProfiles:[acp('deep','high')],defaultProfileId:'deep',modelRoutes:{}});
 assert.equal(migrated.modelRoutes.deckReview||'','');
 assert.equal(resolveModel(migrated,'deckReview').profileId,'deep');
});
