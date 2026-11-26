#!/usr/bin/env node
import assert from "node:assert/strict";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const tsPath=new URL("../frontend/src/lib/globeRendering.ts",import.meta.url);
const source=await (await import("node:fs/promises")).readFile(tsPath,"utf8");
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const out=new URL("../.tmp-globe-rendering.mjs",import.meta.url); writeFileSync(out,js);
const m=await import(out.href);
assert.equal(m.detailLevelForAltitude(.5),2); assert.equal(m.detailLevelForAltitude(1),1); assert.equal(m.detailLevelForAltitude(2),0);
for(const tier of m.RENDER_QUALITY_TIERS) for(const d of [0,1,2]){const p=m.globeRenderQualityProfile(tier,d); for(const v of Object.values(p.caps)) assert.ok(v>0); assert.ok(p.satelliteTileMaxLevel<=17)}
assert.ok(m.globeRenderQualityProfile("minimal",2).caps.incidents<m.globeRenderQualityProfile("full",2).caps.incidents);
assert.equal(m.resolveAdaptivePixelRatio(3,.5,"full"),2); assert.equal(m.resolveAdaptivePixelRatio(3,2,"full"),1.25); assert.equal(m.resolveAdaptivePixelRatio(3,.5,"minimal"),1);
const events=Array.from({length:900},(_,i)=>({id:`e${i}`,lat:(i%90)-45,lng:(i*7%360)-180,intensity:(i%100)/100,occurredAt:i}));
const sel=m.selectAdaptiveEvents(events,0,0,2,430); assert.equal(sel.rendered,Math.min(430,sel.viewportCandidates)); assert.equal(sel.total,900); assert.equal(sel.omitted,900-sel.sourceRendered);
const preserve=events[0]; const ps=m.selectAdaptiveEvents(events,170,170,2,10,[preserve]); assert.equal(ps.selected[0],preserve); assert.equal(ps.forcedIncluded,1);
const input={lat:10,lng:20,track:90,speed:500};
const a=m.projectTrackPoints(input,{minSpeed:70,horizonHours:.28,sampleCount:8});
assert.equal(a.length,8); assert.deepEqual(a[0],[10,20,.018]); assert.ok(Number.isFinite(a[7][0]) && a[7][1]>20);
const b=m.projectTrackPoints(input,{minSpeed:70,horizonHours:.28,sampleCount:5}); assert.equal(b.length,5); assert.deepEqual(b[0],a[0]);
assert.equal(m.cachedTrackProjection(input,{minSpeed:70,horizonHours:.28,sampleCount:8}),m.cachedTrackProjection(input,{minSpeed:70,horizonHours:.28,sampleCount:8}));
const groups=m.createBatchedParticleGroups([{item:{x:1},kind:"aircraft",color:"#fff",size:2},{item:{x:2},kind:"aircraft",color:"#fff",size:2},{item:{x:3},kind:"vessel",color:"#00f",size:1}]);
assert.equal(groups.length,2); assert.equal(groups[0].length,2); assert.equal(groups[0].particleColor,"#fff");
const c=new m.FrameBudgetController({initialTier:"full",windowFrames:8,warmupFrames:0});
for(let i=0;i<16;i++) c.sample(30); assert.equal(c.snapshot().tier,"balanced");
const store=m.createGlobeRenderStatusStore(); const status={qualityTier:"full",runtimeQualityTier:"full",detailLevel:2,detailLabel:"local",reducedEffects:false,pixelRatio:2,frameP80Ms:null,frameWindows:0,adaptationLabel:"",batchingLabel:"",accounts:Object.fromEntries(m.RENDER_ACCOUNT_KEYS.map(k=>[k,{total:1,rendered:1,omitted:0}])),renderedTotal:12,omittedTotal:0};
assert.equal(store.publish(status),true); assert.equal(store.publish({...status}),false);
function bench(fn,n){const t=performance.now(); let x=0; for(let i=0;i<n;i++) x+=fn(i).length||0; return [(performance.now()-t)/n,x]}
const [projMs]=bench(()=>m.projectTrackPoints(input,{minSpeed:70,horizonHours:.28,sampleCount:8}),1000);
const [selMs]=bench(()=>m.selectAdaptiveEvents(events,0,0,2,430).selected,500);
console.log(JSON.stringify({ok:true,projectionMs:+projMs.toFixed(4),selectionMs:+selMs.toFixed(4),checks:"quality/caps/pixel/selection/projection/cache/batching/frame-budget/status"}));
