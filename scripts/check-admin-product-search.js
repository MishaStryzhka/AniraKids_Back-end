const assert=require('node:assert/strict');
const {validateListProductsAdminQuery}=require('../build/v2/schemas/admin-catalogue.schema');
const {CatalogueAdminService}=require('../build/v2/services/catalogue-admin.service');
const {ProductV2Model}=require('../build/v2/models');
async function main(){
 assert(validateListProductsAdminQuery({q:['x']}).errorMessage);
 assert(validateListProductsAdminQuery({q:'x'.repeat(101)}).errorMessage);
 assert.equal(validateListProductsAdminQuery({q:'  DET030  '}).value.q,'DET030');
 assert.equal(validateListProductsAdminQuery({q:'   '}).value.q,undefined);
 const oldFind=ProductV2Model.find,oldCount=ProductV2Model.countDocuments;
 let findFilter,countFilter,skip,limit;
 ProductV2Model.find=filter=>{findFilter=filter;return {sort(){return this},skip(v){skip=v;return this},limit(v){limit=v;return this},lean(){return this},exec:async()=>[{name:'Šaty DET030'}]};};
 ProductV2Model.countDocuments=filter=>{countFilter=filter;return {exec:async()=>45};};
 try{
  const service=new CatalogueAdminService();
  const result=await service.listProducts({q:'det030',status:'active',page:2,limit:20});
  assert.deepEqual(findFilter,countFilter);
  assert.equal(findFilter.status,'active');
  assert(new RegExp(findFilter.$or[0].name.$regex,'i').test('Šaty DET030'));
  assert(new RegExp(findFilter.$or[1].slug.$regex,'i').test('saty-det030'));
  assert.equal(skip,20);assert.equal(limit,20);
  assert.deepEqual(result.pagination,{page:2,limit:20,total:45,pages:3});
  await service.listProducts({q:'.* [a] (x) $',page:1,limit:20});
  const re=new RegExp(findFilter.$or[0].name.$regex,'i');
  assert(re.test('Šaty .* [a] (x) $'));assert(!re.test('anything'));
  await service.listProducts({page:1,limit:20});
  assert.equal(findFilter.$or,undefined);
 }finally{ProductV2Model.find=oldFind;ProductV2Model.countDocuments=oldCount;}
 console.log('Admin product search validation, literal matching and pagination PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
