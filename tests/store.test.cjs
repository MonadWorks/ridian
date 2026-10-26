const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, localDate, validDate, addDays } = require('../lib/store.cjs');
function fixture(t, start = '2026-10-26T12:00:00') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ridian-store-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let time=new Date(start); const store=new Store(dir,()=>time);
  return {store,dir,setTime:value=>time=new Date(value)};
}
test('all four priorities persist, including urgent recurring tasks', t => {
  const { store, dir } = fixture(t);
  const task = store.add({ title: 'Four priorities', priority: 'urgent' });
  for (const priority of ['low', 'normal', 'high', 'urgent']) {
    store.update(task.id, { priority });
    assert.equal(new Store(dir).snapshot().tasks[0].priority, priority);
  }
  store.addStrategy({ title: 'Daily review', priority: 'urgent', schedule: { type: 'interval', everyDays: 1 } });
  assert.equal(store.snapshot().tasks.find(item => item.strategyId).priority, 'urgent');
  assert.throws(() => store.update(task.id, { priority: 'invalid' }));
  assert.equal(store.snapshot().tasks[0].priority, 'urgent');
});
test('tasks persist with priorities and retain original planning date across midnight', t => {
  const {store,dir,setTime}=fixture(t);const task=store.add({title:'复习章节',priority:'high'});
  setTime('2026-10-27T00:01:00');store.update(task.id,{done:true});
  const loaded=new Store(dir).snapshot().tasks[0];assert.equal(loaded.date,'2026-10-26');assert.equal(loaded.completedDate,'2026-10-27');assert.equal(loaded.priority,'high');
  store.update(task.id,{done:false});assert.equal(store.snapshot().tasks[0].completedDate,null);
  assert.ok(fs.existsSync(path.join(dir,'backups','2026-10-27.json')));
});
test('interval strategies catch up once, survive restart, and honor end date',t=>{
  const {store,dir,setTime}=fixture(t);const s=store.addStrategy({title:'复习单词',startDate:'2026-10-20',endDate:'2026-10-27',schedule:{type:'interval',everyDays:3},priority:'high'});
  assert.deepEqual(store.snapshot().tasks.map(t=>t.date),['2026-10-20','2026-10-23','2026-10-26']);
  store.materialize();assert.equal(store.snapshot().tasks.length,3);
  const loaded=new Store(dir,()=>new Date('2026-11-01T12:00:00'));loaded.materialize();assert.equal(loaded.snapshot().tasks.length,3);
  assert.ok(loaded.snapshot().tasks.every(t=>t.strategyId===s.id&&t.priority==='high'));
});
test('weekly and spaced review dates produce only due occurrences',t=>{
  const {store,setTime}=fixture(t);
  store.addStrategy({title:'每周回顾',startDate:'2026-10-19',schedule:{type:'weekly',weekdays:[1,5]}});
  assert.deepEqual(store.snapshot().tasks.map(t=>t.date),['2026-10-19','2026-10-23','2026-10-26']);
  const rule=store.addStrategy({title:'复习第一课',schedule:{type:'dates',dates:['2026-10-26','2026-10-27','2026-10-29','2026-11-02']},metadata:{topic:'第一课',intervals:[1,3,7]}});
  assert.equal(store.snapshot().tasks.filter(t=>t.strategyId===rule.id).length,1);
  setTime('2026-10-29T12:00:00');store.materialize();assert.equal(store.snapshot().tasks.filter(t=>t.strategyId===rule.id).length,3);
  store.updateStrategy(rule.id,{enabled:false});setTime('2026-11-03T12:00:00');store.materialize();assert.equal(store.snapshot().tasks.filter(t=>t.strategyId===rule.id).length,3);
});
test('invalid dates and strategies fail without changing saved tasks',t=>{
  const {store}=fixture(t);assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2024-02-29'),true);assert.equal(addDays('2026-03-08',1),'2026-03-09');
  assert.throws(()=>store.add({title:' ',date:'2026-10-26'}));assert.throws(()=>store.add({title:'ok',priority:'unknown'}));assert.throws(()=>store.addStrategy({title:'bad',schedule:{type:'interval',everyDays:0}}));assert.equal(store.snapshot().tasks.length,0);
});
test('corrupt existing data is preserved and never silently overwritten',t=>{
  const {dir}=fixture(t);const file=path.join(dir,'journal.json');fs.writeFileSync(file,'broken');assert.throws(()=>new Store(dir));assert.equal(fs.readFileSync(file,'utf8'),'broken');
});
